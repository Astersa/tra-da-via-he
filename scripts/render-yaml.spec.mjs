import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IMPLEMENTATION-PLAN.md §3.10.3 (M1-E6-T3). Regex checks on the file text; no YAML library is added.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(path.join(root, 'render.yaml'), 'utf8');

// Top-level sections. `databases:` and `services:` are the only ones the Blueprint uses.
const dbSection = text.slice(text.indexOf('\ndatabases:') + 1, text.indexOf('\nservices:'));
const webSection = text.slice(text.indexOf('\nservices:') + 1);

// The envVars entry whose key is `key`, up to the next entry or the end of the file.
function envEntry(key) {
  const parts = webSection.split(/\n\s+- key: /);
  const hit = parts.find((p) => p.startsWith(`${key}\n`));
  assert.ok(hit, `envVars entry ${key} is missing`);
  return hit;
}

test('render.yaml: database is free, Singapore, PostgreSQL 17', () => {
  assert.match(dbSection, /\n\s+plan: free\n/);
  assert.match(dbSection, /\n\s+region: singapore\n/);
  assert.match(dbSection, /\n\s+postgresMajorVersion: "17"\n/);
});

test('render.yaml: web service is free, Singapore, node runtime, health path', () => {
  assert.match(webSection, /\n\s+type: web\n/);
  assert.match(webSection, /\n\s+runtime: node\n/);
  assert.match(webSection, /\n\s+plan: free\n/);
  assert.match(webSection, /\n\s+region: singapore\n/);
  assert.match(webSection, /\n\s+healthCheckPath: \/api\/v1\/health\n/);
});

test('render.yaml: start command migrates then execs node dist/main.js', () => {
  const start = /\n\s+startCommand: (.+)\n/.exec(webSection)?.[1] ?? '';
  assert.match(start, /prisma migrate deploy/);
  assert.match(start, /exec node dist\/main\.js$/);
  assert.ok(start.indexOf('prisma migrate deploy') < start.indexOf('exec node dist/main.js'));
});

test('render.yaml: build installs with frozen lockfile and devDependencies', () => {
  const build = /\n\s+buildCommand: (.+)\n/.exec(webSection)?.[1] ?? '';
  assert.match(build, /NODE_ENV=development pnpm install --frozen-lockfile/);
  assert.match(build, /pnpm -r build/);
  assert.match(build, /node -v/);
  assert.match(build, /pnpm -v/);
});

test('render.yaml: secrets are generated, not written in the file', () => {
  for (const key of ['JWT_SECRET', 'METRICS_TOKEN']) {
    const entry = envEntry(key);
    assert.match(entry, /\n\s+generateValue: true\n/, `${key} must use generateValue`);
    assert.doesNotMatch(entry, /\n\s+value:/, `${key} must not have a literal value`);
  }
});

test('render.yaml: DATABASE_URL comes from the database, NODE_ENV is production', () => {
  const db = envEntry('DATABASE_URL');
  assert.match(db, /fromDatabase:\n\s+name: tdvh-db\n\s+property: connectionString/);
  assert.match(envEntry('NODE_ENV'), /\n\s+value: production\n/);
});

test('render.yaml: no rootDir, no preDeployCommand', () => {
  assert.doesNotMatch(text, /^\s*rootDir:/m);
  assert.doesNotMatch(text, /preDeployCommand/);
});
