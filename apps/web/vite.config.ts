import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['src/**/*.spec.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'dom', include: ['src/**/*.spec.tsx'], environment: 'jsdom' },
      },
    ],
  },
});
