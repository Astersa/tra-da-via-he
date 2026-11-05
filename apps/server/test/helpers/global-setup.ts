import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../../', import.meta.url));

// Runs once before the test run. Applies pending migrations to the test DB only,
// same command as `db:migrate:test`, so `pnpm verify` does not fail on an unmigrated DB.
export default function setup(): void {
  process.loadEnvFile(fileURLToPath(new URL('../../.env.test', import.meta.url)));
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost:5433\/tdvh_test$/.test(url)) {
    throw new Error(`Refusing to migrate: DATABASE_URL is not the test DB (port 5433): ${url}`);
  }
  const res = spawnSync(
    process.execPath,
    ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { cwd: serverDir, env: process.env, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`prisma migrate deploy failed (is \`pnpm test:db:up\` running?)\n${res.stdout}${res.stderr}`);
  }
}
