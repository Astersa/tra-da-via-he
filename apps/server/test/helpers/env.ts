import { fileURLToPath } from 'node:url';

// Vitest setupFiles: test values only (see .env.test). Never a production DB.
process.loadEnvFile(fileURLToPath(new URL('../../.env.test', import.meta.url)));
