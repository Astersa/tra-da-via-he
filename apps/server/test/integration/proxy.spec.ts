import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { resetDb } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md §3.10.2, M1-E6-T1. Real HTTP, real PostgreSQL, no mocks.
// trust proxy = 1: req.ip is the last X-Forwarded-For entry, so a forged entry in front of it is ignored.

const GUEST_PER_DAY = '2';
let app: INestApplication | undefined;
let url = '';
let savedPerDay: string | undefined;

async function start(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
}

beforeEach(async () => {
  await resetDb();
  savedPerDay = process.env.GAME_GUESTS_PER_IP_PER_DAY;
  process.env.GAME_GUESTS_PER_IP_PER_DAY = GUEST_PER_DAY;
  await start();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (savedPerDay === undefined) delete process.env.GAME_GUESTS_PER_IP_PER_DAY;
  else process.env.GAME_GUESTS_PER_IP_PER_DAY = savedPerDay;
});

// Empty body fails validation after the guard, so only the rate limit decides RATE_LIMITED.
async function login(xff: string): Promise<string | undefined> {
  const res = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: '{}',
  });
  if (res.status === 200) return undefined;
  const body = (await res.json()) as { error?: { code: string } };
  return body.error?.code;
}

async function guest(xff: string, displayName: string): Promise<string | undefined> {
  const res = await fetch(`${url}/api/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ displayName, avatarId: 'avatar_01' }),
  });
  if (res.ok) return undefined;
  const body = (await res.json()) as { error?: { code: string } };
  return body.error?.code;
}

describe('trust proxy = 1 (IP rate limit)', () => {
  it('limits /auth/login per the client IP from X-Forwarded-For', async () => {
    // login capacity is 10 per IP.
    for (let i = 0; i < 10; i++) expect(await login('1.1.1.1')).not.toBe('RATE_LIMITED');
    expect(await login('1.1.1.1')).toBe('RATE_LIMITED');
    expect(await login('2.2.2.2')).not.toBe('RATE_LIMITED');
  });

  it('ignores a forged entry in front of the real one', async () => {
    // Prefixes change, the last entry (1.1.1.1) is the client IP: one shared bucket.
    for (let i = 0; i < 5; i++) {
      expect(await login('9.9.9.9, 1.1.1.1')).not.toBe('RATE_LIMITED');
      expect(await login('8.8.8.8, 1.1.1.1')).not.toBe('RATE_LIMITED');
    }
    expect(await login('1.1.1.1')).toBe('RATE_LIMITED');
    expect(await login('7.7.7.7, 1.1.1.1')).toBe('RATE_LIMITED');
  });

  it('counts the daily guest limit per client IP from X-Forwarded-For', async () => {
    expect(await guest('9.9.9.9, 5.5.5.5', 'Khach1')).toBeUndefined();
    expect(await guest('8.8.8.8, 5.5.5.5', 'Khach2')).toBeUndefined();
    expect(await guest('7.7.7.7, 5.5.5.5', 'Khach3')).toBe('RATE_LIMITED');
    expect(await guest('9.9.9.9, 6.6.6.6', 'Khach4')).toBeUndefined();
  });
});
