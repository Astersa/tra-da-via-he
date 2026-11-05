import { defineConfig } from '@playwright/test';

// Chạy trên web đang chạy sẵn (PLAYWRIGHT_BASE_URL, mặc định Vite dev). Server và DB phải được bật trước.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
  },
});
