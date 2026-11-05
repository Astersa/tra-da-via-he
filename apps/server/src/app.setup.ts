import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
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
