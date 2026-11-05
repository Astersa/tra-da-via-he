#!/usr/bin/env node
// Money write guard (IMPLEMENTATION-PLAN.md §3.1).
// Only apps/server/src/economy/ may write Wallet / ShopTreasury balances.
// Fails (exit 1) when a forbidden token appears anywhere else in the scanned
// source. Paths are normalised to "/" so the check works on Windows and Linux.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_TOKENS = [
  '"Wallet"',
  '"ShopTreasury"',
  '.wallet.update',
  '.shopTreasury.update',
  '.walletTransaction.create',
];

// Directories scanned, relative to the repo root.
export const SCAN_ROOTS = ['apps/server/src', 'apps/web/src', 'packages/shared/src'];

// Path segments that are never checked: tests, Prisma files, generated code,
// build output and dependencies. The economy module itself is the allowed owner.
const EXCLUDED_SEGMENTS = new Set(['test', 'prisma', 'generated', 'dist', 'node_modules']);
const ALLOWED_PREFIX = 'apps/server/src/economy/';

const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx)$/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function* walk(dir, rootDir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = toPosix(path.relative(rootDir, full));
    if (rel.split('/').some((seg) => EXCLUDED_SEGMENTS.has(seg))) continue;
    if (statSync(full).isDirectory()) {
      yield* walk(full, rootDir);
    } else if (SOURCE_EXT.test(entry)) {
      yield { rel, full };
    }
  }
}

/**
 * Returns violations as { file, line, token } for every forbidden token found
 * outside the economy module. Empty array means the check passes.
 */
export function findMoneyWriteViolations(rootDir) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absRoot = path.join(rootDir, ...scanRoot.split('/'));
    let exists = true;
    try {
      statSync(absRoot);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    for (const { rel, full } of walk(absRoot, rootDir)) {
      if (rel.startsWith(ALLOWED_PREFIX)) continue;
      const lines = readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => {
        for (const token of FORBIDDEN_TOKENS) {
          if (text.includes(token)) violations.push({ file: rel, line: i + 1, token });
        }
      });
    }
  }
  return violations;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const violations = findMoneyWriteViolations(repoRoot);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: forbidden token "${v.token}" outside apps/server/src/economy/`);
    }
    console.error(`check:money FAILED (${violations.length} violation(s)).`);
    process.exit(1);
  }
  console.log('check:money OK: no money writes outside apps/server/src/economy/.');
}
