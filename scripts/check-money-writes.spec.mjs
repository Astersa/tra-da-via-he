import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findMoneyWriteViolations } from './check-money-writes.mjs';

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-money-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('negative: wallet writes inside apps/server/src/economy are allowed', () => {
  const root = fixture({
    'apps/server/src/economy/ledger.service.ts':
      'await tx.wallet.update({ where: { id }, data: { balance } });\nconst t = "ShopTreasury";\n',
  });
  try {
    assert.deepEqual(findMoneyWriteViolations(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('negative: test, prisma and generated folders are not checked', () => {
  const root = fixture({
    'apps/server/test/integration/seed.spec.ts': 'await db.wallet.update({});\n',
    'apps/server/src/generated/prisma/client.ts': 'export type Wallet = {};\n',
    'apps/server/prisma/seed.ts': 'await tx.shopTreasury.update({});\n',
  });
  try {
    assert.deepEqual(findMoneyWriteViolations(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('negative: unrelated code passes', () => {
  const root = fixture({
    'apps/server/src/orders/orders.service.ts': 'const total = order.amount;\n',
    'apps/web/src/ui/Shop.tsx': 'export const Shop = () => null;\n',
  });
  try {
    assert.deepEqual(findMoneyWriteViolations(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive: .wallet.update in orders/ fails', () => {
  const root = fixture({
    'apps/server/src/orders/sweeper.ts': 'await tx.wallet.update({ where: { id }, data: {} });\n',
  });
  try {
    const v = findMoneyWriteViolations(root);
    assert.deepEqual(v, [
      { file: 'apps/server/src/orders/sweeper.ts', line: 1, token: '.wallet.update' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive: ShopTreasury and walletTransaction.create outside economy fail', () => {
  const root = fixture({
    'apps/server/src/shops/shop.service.ts': 'await tx.shopTreasury.update({});\n',
    'apps/server/src/chat/chat.service.ts': 'await tx.walletTransaction.create({});\n',
  });
  try {
    const tokens = findMoneyWriteViolations(root).map((v) => v.token).sort();
    assert.ok(tokens.includes('.shopTreasury.update'));
    assert.ok(tokens.includes('.walletTransaction.create'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive: the string "Wallet" in web source fails', () => {
  const root = fixture({
    'apps/web/src/store/wallet.ts': 'export const label = "Wallet";\n',
  });
  try {
    const v = findMoneyWriteViolations(root);
    assert.equal(v.length, 1);
    assert.equal(v[0].file, 'apps/web/src/store/wallet.ts');
    assert.equal(v[0].token, 'Wallet');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
