import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

export const API_PREFIX = 'api/v1';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
}

// M1-E6-T1 red phase: placeholder so the spec compiles and fails on behaviour, not on import.
export async function startApp(_app: INestApplication, _port: number): Promise<void> {
  throw new Error('startApp not implemented (M1-E6-T1)');
}
