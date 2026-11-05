#!/usr/bin/env node
// E2E runner (IMPLEMENTATION-PLAN.md §4.5 M1-E5-T7). Prepares a clean test DB, then runs Playwright.
// Playwright's webServer (apps/web/playwright.config.ts) starts the built server and Vite, and stops them when the run ends.
// With PLAYWRIGHT_BASE_URL set, nothing is prepared or started: the tests run against that URL as-is.
// Extra arguments go to `playwright test`, e.g. `pnpm e2e -- prod-serve`.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'apps/server');
const tsxCli = path.join(serverDir, 'node_modules/tsx/dist/cli.mjs');
const prismaCli = path.join(serverDir, 'node_modules/prisma/build/index.js');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const { Client } = serverRequire('pg');

const EXPECTED_DB_URL = 'postgresql://tdvh:tdvh_test@localhost:5433/tdvh_test';
const PROVISION_ARGS = ['--slug=e2e-main', '--name=Quán E2E'];

function fail(msg) {
  console.error(`e2e: ${msg}`);
  process.exit(1);
}

// Runs a command and stops the script on failure. pnpm is a .cmd on Windows, so shell mode is used there.
function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'pnpm' });
  if (res.status !== 0) fail(`${path.basename(cmd)} ${args.join(' ')} failed (exit ${res.status})`);
}

// .env.test must point at the test DB; the same URL is used by the server, seed, provision and this script.
function loadTestEnv() {
  const env = {};
  for (const line of readFileSync(path.join(serverDir, '.env.test'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  if (env.DATABASE_URL !== EXPECTED_DB_URL) fail(`.env.test DATABASE_URL is not the test DB: ${env.DATABASE_URL}`);
  return env;
}

async function truncateAll(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  // pnpm e2e -- <bộ lọc>: bỏ dấu '--' mà pnpm chuyển tiếp.
  const passthrough = process.argv.slice(2).filter((a) => a !== '--');

  if (process.env.PLAYWRIGHT_BASE_URL) {
    console.log(`e2e: PLAYWRIGHT_BASE_URL=${process.env.PLAYWRIGHT_BASE_URL}, skipping DB prep and servers`);
    run('pnpm', ['--filter', '@tdvh/web', 'exec', 'playwright', 'test', ...passthrough], root);
    return;
  }

  const testEnv = loadTestEnv();
  // Test DB must be up (`pnpm test:db:up`); migrate deploy applies pending migrations.
  run(process.execPath, ['--env-file=.env.test', prismaCli, 'migrate', 'deploy'], serverDir);
  // Clean DB: TRUNCATE (the append-only triggers block row DELETE), keeping the migration history.
  await truncateAll(testEnv.DATABASE_URL);

  const env = { ...process.env, DATABASE_URL: testEnv.DATABASE_URL };
  const tsxRun = (script, args = []) =>
    run(process.execPath, ['--env-file=.env.test', tsxCli, script, ...args], serverDir);
  tsxRun('prisma/seed.ts');
  tsxRun('scripts/provision-server.ts', PROVISION_ARGS);

  // The built server (dist/main.js) is started by Playwright's webServer, so build first.
  run('pnpm', ['--filter', '@tdvh/shared', 'build'], root);
  run('pnpm', ['--filter', '@tdvh/server', 'build'], root);

  // Playwright loads apps/web/playwright.config.ts, which starts the server and Vite (and stops them afterwards).
  const res = spawnSync('pnpm', ['--filter', '@tdvh/web', 'exec', 'playwright', 'test', ...passthrough], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = res.status ?? 1;
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
