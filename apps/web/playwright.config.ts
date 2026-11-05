import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Chạy qua `pnpm e2e` (scripts/e2e.mjs): script chuẩn bị DB test rồi gọi Playwright.
// Không có PLAYWRIGHT_BASE_URL: webServer bật server bản build (port 3000) và Vite (5173), tắt sau khi chạy xong.
// Có PLAYWRIGHT_BASE_URL: không bật gì, chạy thẳng trên URL đó.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../server');
const baseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: baseURL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
  },
  webServer: baseURL
    ? undefined
    : [
        {
          command: 'node --env-file=.env.test dist/main.js',
          cwd: serverDir,
          url: 'http://localhost:3000/api/v1/health',
          reuseExistingServer: false,
          timeout: 60_000,
          env: { PORT: '3000', GAME_GUESTS_PER_IP_PER_DAY: '1000' },
        },
        {
          command: 'pnpm exec vite --host localhost --port 5173 --strictPort',
          cwd: here,
          url: 'http://localhost:5173',
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
