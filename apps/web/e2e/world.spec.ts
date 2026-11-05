import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Từ màn vào tới bản đồ: vào nhanh, canvas hiện, nhân vật đi và gửi player:move đúng nhịp.
test('vào quán, thấy bản đồ và đi được', async ({ page }) => {
  const sentFrames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes('player:move')) sentFrames.push(frame.payload);
    });
  });

  await page.goto('/');
  await page.getByLabel('Tên của bạn').fill(`Khach${Date.now() % 1_000_000}`);
  await page.getByRole('button', { name: 'Vào uống trà đá' }).click();
  await page.getByRole('button', { name: 'Vào nhanh (Quick Join)' }).click();

  await expect(page.locator('.game-host canvas')).toBeVisible();
  // Hết thông báo "đang vào quán": đã joined và nhận vị trí.
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });

  await page.keyboard.down('d');
  await page.waitForTimeout(600);
  await page.keyboard.up('d');
  await page.waitForTimeout(300);

  // Đi 600 ms, gửi tối đa 10 lần/giây; có ít nhất một lần gửi.
  expect(sentFrames.length).toBeGreaterThan(0);
  expect(sentFrames.length).toBeLessThanOrEqual(10);

  await page.screenshot({ path: join(import.meta.dirname, 'screens', 'world.png') });
});
