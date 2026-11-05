import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { BootTasks } from './core/boot-tasks.js';
import { CLOCK, type Clock } from './core/clock.js';
import { GAME_CONFIG, type GameConfig } from './core/game-config.js';
import { PrismaService } from './core/prisma.service.js';
import { assertProductFloors } from './economy/product-floors.js';

export const API_PREFIX = 'api/v1';

// Shared by main.ts and every test that builds the app, so both see the same HTTP rules.
export function configureApp(app: INestApplication): void {
  // One hop (Render's proxy): req.ip is the last X-Forwarded-For entry. Forged entries in front of it are ignored (§3.10.2).
  (app as NestExpressApplication).set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  // Explicit CSP (M1-E6-T2). Phaser needs blob: for workers and textures; style-src keeps 'unsafe-inline' for React and Phaser styles.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'wss:'],
          fontSrc: ["'self'"],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  mountWeb(app as NestExpressApplication);
}

// Serves apps/web/dist from the same origin as /api and /socket.io (§3.10.2). Relative to this file, so it works from any cwd.
function mountWeb(app: NestExpressApplication): void {
  const webDir = path.resolve(process.env.WEB_DIST_DIR || path.resolve(import.meta.dirname, '../../web/dist'));
  const indexHtml = path.join(webDir, 'index.html');
  if (!existsSync(indexHtml)) {
    // Production must not start without its web build. Elsewhere (dev with Vite, API tests) run API only.
    if (process.env.NODE_ENV === 'production') throw new Error(`Web build not found: ${indexHtml}`);
    new Logger('Web').warn(`Web build not found at ${indexHtml}; serving API only. Run pnpm --filter @tdvh/web build.`);
    return;
  }
  app.useStaticAssets(webDir, {
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
    },
  });
  // SPA fallback: only a GET/HEAD page navigation (text/html) for a client route. API, socket.io and file-like paths fall through to Nest (JSON 404).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.headers.accept?.includes('text/html')) return next();
    const p = req.path;
    if (p === '/api' || p.startsWith('/api/') || p === '/socket.io' || p.startsWith('/socket.io/')) return next();
    if (path.posix.extname(p) !== '') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

// IMPLEMENTATION-PLAN.md §3.10.4 (M1-E6-T1). Before listen: init, floors (§3.6.5), boot tasks. Any failure throws,
// so the caller exits with a non-zero code and the port stays closed.
export async function startApp(app: INestApplication, port: number): Promise<void> {
  await app.init(); // not yet accepting connections
  const products = await app.get(PrismaService).product.findMany();
  assertProductFloors(products, app.get<GameConfig>(GAME_CONFIG));
  await app.get(BootTasks).run(app.get<Clock>(CLOCK).now());
  await app.listen(port, '0.0.0.0');
}
