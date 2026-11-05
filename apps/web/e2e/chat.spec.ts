import { expect, test, type Browser, type Page } from '@playwright/test';

interface ServerEvent {
  name: string;
  data: unknown;
}

// Mọi frame socket.io dạng "42[name, data]" mà trang gửi đi (sent) hoặc nhận về (received).
function watchFrames(page: Page): { received: ServerEvent[]; sent: ServerEvent[] } {
  const received: ServerEvent[] = [];
  const sent: ServerEvent[] = [];
  const parse = (payload: string | Buffer): ServerEvent | null => {
    const m = /^42(\[.*)$/s.exec(String(payload));
    if (!m) return null;
    const [name, data] = JSON.parse(m[1]!) as [string, unknown];
    return { name, data };
  };
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      const e = parse(f.payload);
      if (e) received.push(e);
    });
    ws.on('framesent', (f) => {
      const e = parse(f.payload);
      if (e) sent.push(e);
    });
  });
  return { received, sent };
}

// Vào máy chủ đầu tiên trong danh sách, cùng quy ước với two-players.spec.ts.
async function enter(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tên của bạn').fill(name);
  await page.getByRole('button', { name: 'Vào uống trà đá' }).click();
  await page.locator('.server-card').first().getByRole('button', { name: 'Vào máy chủ này' }).click();
  await expect(page.locator('.game-host canvas')).toBeVisible();
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
}

test('A chat, B thấy trong panel; gõ trong ô chat không đi, không ngồi', async ({ browser }: { browser: Browser }) => {
  const suffix = `${Date.now() % 100_000}${Math.floor(Math.random() * 1000)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const framesA = watchFrames(pageA);

  await enter(pageB, `Binh${suffix}`);
  await enter(pageA, `An${suffix}`);

  const inputA = pageA.getByLabel('Nhập tin nhắn');
  const logB = pageB.getByRole('log', { name: 'Tin nhắn' });

  // Gõ các phím điều khiển trong ô chat: không được đi hay ngồi. Nội dung có <script> để kiểm tra hiển thị chữ.
  // Thêm hậu tố ngẫu nhiên: server giữ lịch sử chat, lần chạy trước không được khớp nhầm.
  const text = `wasd e <script>alert(1)</script> trà đá ${suffix}`;
  await inputA.click();
  await pageA.keyboard.type(text, { delay: 20 });
  await expect(inputA).toHaveValue(text);
  await pageA.keyboard.press('Enter');

  // B nhận đúng nội dung trong panel, dạng chữ, không có phần tử script.
  await expect(logB.getByText(text)).toBeVisible({ timeout: 10_000 });
  await expect(logB.locator('script')).toHaveCount(0);

  // Sau khi gửi, ô nhập vẫn có focus và đã xóa nội dung.
  await expect(inputA).toHaveValue('');
  await expect(inputA).toBeFocused();

  // Không có player:move hay player:sit nào được gửi từ A.
  expect(framesA.sent.filter((e) => e.name === 'player:move')).toHaveLength(0);
  expect(framesA.sent.filter((e) => e.name === 'player:sit')).toHaveLength(0);

  await ctxA.close();
  await ctxB.close();
});

test.describe('điện thoại 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tin dài không làm tràn ngang và panel không che kín game', async ({ page }) => {
    const suffix = `${Date.now() % 100_000}${Math.floor(Math.random() * 1000)}`;
    await enter(page, `Mobi${suffix}`);

    const long = 'x'.repeat(200);
    await page.getByLabel('Nhập tin nhắn').fill(long);
    await page.getByRole('button', { name: 'Gửi' }).click();
    await expect(page.getByRole('log', { name: 'Tin nhắn' }).getByText(long)).toBeVisible({ timeout: 10_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.locator('.chat-panel').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844 * 0.4);
  });
});
