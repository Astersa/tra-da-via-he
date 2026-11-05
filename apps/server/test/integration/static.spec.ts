import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

// Web build is a fixture folder via WEB_DIST_DIR (IMPLEMENTATION-PLAN.md §3.10.2, M1-E6-T2).
describe('static web + SPA fallback', () => {
  let app: INestApplication;
  let baseUrl: string;
  let webDir: string;
  let prevWebDir: string | undefined;

  beforeAll(async () => {
    webDir = mkdtempSync(path.join(tmpdir(), 'tdvh-web-'));
    mkdirSync(path.join(webDir, 'assets'));
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>FIXTURE</title>');
    writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("fixture");');
    prevWebDir = process.env.WEB_DIST_DIR;
    process.env.WEB_DIST_DIR = webDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    if (prevWebDir === undefined) delete process.env.WEB_DIST_DIR;
    else process.env.WEB_DIST_DIR = prevWebDir;
    rmSync(webDir, { recursive: true, force: true });
  });

  const html = { Accept: 'text/html' };

  it('GET / serves index.html with no-cache', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('FIXTURE');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('GET /servers/abc with Accept text/html serves index.html (SPA fallback)', async () => {
    const res = await fetch(`${baseUrl}/servers/abc`, { headers: html });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('FIXTURE');
  });

  it('static asset gets public cache header', async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('GET /assets/khong-co.png is 404 and not HTML', async () => {
    const res = await fetch(`${baseUrl}/assets/khong-co.png`, { headers: html });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('FIXTURE');
  });

  it('GET /api/v1/khong-co is a JSON 404, never index.html', async () => {
    for (const headers of [{}, html]) {
      const res = await fetch(`${baseUrl}/api/v1/khong-co`, { headers });
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).not.toContain('text/html');
      expect(await res.text()).not.toContain('FIXTURE');
    }
  });

  it('GET /api/v1/health returns JSON', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST / does not return index.html', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'POST', headers: html });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('FIXTURE');
  });

  it('socket.io on the same origin reaches the gateway (anonymous socket is refused with UNAUTHENTICATED)', async () => {
    const socket: Socket = io(baseUrl, { transports: ['websocket'], reconnection: false, forceNew: true });
    try {
      const err = await new Promise<Error>((resolve, reject) => {
        socket.once('connect', () => reject(new Error('anonymous socket must not connect')));
        socket.once('connect_error', resolve);
      });
      expect(err.message).toBe('UNAUTHENTICATED');
    } finally {
      socket.disconnect();
    }
  });

  it('no CORS: foreign Origin gets no Access-Control-Allow-Origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responses carry an explicit CSP', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: html });
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' wss:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
