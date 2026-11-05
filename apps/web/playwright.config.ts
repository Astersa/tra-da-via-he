import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Chạy qua `pnpm e2e` (scripts/e2e.mjs): script chuẩn bị DB test rồi gọi Playwright.
// Mặc định: webServer bật server bản build (port 3000) và Vite (5173), tắt sau khi chạy xong.
// E2E_SERVE=1 (`pnpm e2e -- --serve`): chỉ bật server bản build, NODE_ENV=production, mở qua port 3000 cùng origin, không Vite (M1-E6-T2).
// Có PLAYWRIGHT_BASE_URL: không bật gì, chạy thẳng trên URL đó.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../server');
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const serve = process.env.E2E_SERVE === '1';

const serverWebServer = {
  command: 'node --env-file=.env.test dist/main.js',
  cwd: serverDir,
  url: 'http://localhost:3000/api/v1/health',
  reuseExistingServer: false,
  timeout: 60_000,
  env: { PORT: '3000', GAME_GUESTS_PER_IP_PER_DAY: '1000', ...(serve ? { NODE_ENV: 'production' } : {}) },
};

const viteWebServer = {
  command: 'pnpm exec vite --host localhost --port 5173 --strictPort',
  cwd: here,
  url: 'http://localhost:5173',
  reuseExistingServer: false,
  timeout: 60_000,
};

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: baseURL ?? (serve ? 'http://localhost:3000' : 'http://localhost:5173'),
    viewport: { width: 1280, height: 720 },
  },
  webServer: baseURL ? undefined : serve ? [serverWebServer] : [serverWebServer, viteWebServer],
});
