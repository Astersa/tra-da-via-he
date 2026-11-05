import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

interface ServerEvent {
  name: string;
  data: unknown;
}

// Ghi lại các event server gửi tới trang (frame socket.io dạng '42[name, data]').
// Canvas không cho đọc sprite, nên E2E dựa vào các event mà store dùng để dựng người chơi khác.
function watchEvents(page: Page): ServerEvent[] {
  const received: ServerEvent[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const m = /^42(\[.*)$/s.exec(String(frame.payload));
      if (!m) return;
      const [name, data] = JSON.parse(m[1]!) as [string, unknown];
      received.push({ name, data });
    });
  });
  return received;
}

async function enter(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tên của bạn').fill(name);
  await page.getByRole('button', { name: 'Vào uống trà đá' }).click();
  await page.getByRole('button', { name: 'Vào nhanh (Quick Join)' }).click();
  await expect(page.locator('.game-host canvas')).toBeVisible();
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
}

// Hai context riêng để cookie và phiên tách biệt. Tên ngẫu nhiên để không trùng displayNameKey.
async function openPair(browser: Browser) {
  const suffix = `${Date.now() % 100_000}${Math.floor(Math.random() * 1000)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  return { ctxA, ctxB, pageA, pageB, nameA: `An${suffix}`, nameB: `Binh${suffix}` };
}

test('tab B thấy A xuất hiện, thấy A di chuyển, A rời thì biến mất', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB, nameA, nameB } = await openPair(browser);
  const recvB = watchEvents(pageB);

  // B vào trước để A vào sau: B nhận player:joined của A (A vào sau thì B mới có event này).
  await enter(pageB, nameB);
  await enter(pageA, nameA);

  const joinedA = () =>
    recvB.find((e) => e.name === 'player:joined' && (e.data as { displayName: string }).displayName === nameA)?.data as
      | { userId: string }
      | undefined;
  await expect.poll(() => joinedA() !== undefined, { timeout: 15_000 }).toBe(true);
  const userIdA = joinedA()!.userId;

  const movesOfA = () =>
    recvB
      .filter((e) => e.name === 'player:moved')
      .flatMap((e) => (e.data as { moves: { userId: string; x: number }[] }).moves)
      .filter((m) => m.userId === userIdA);

  // A đi sang phải; B nhận vị trí của A đổi (x có hơn một giá trị).
  await pageA.keyboard.down('d');
  await expect.poll(() => new Set(movesOfA().map((m) => m.x)).size, { timeout: 10_000 }).toBeGreaterThan(1);
  await pageA.keyboard.up('d');
  await pageB.screenshot({ path: join(import.meta.dirname, 'screens', 'two-players.png') });

  // A rời: server kết thúc phiên sau grace, B nhận player:left đúng userId của A.
  await ctxA.close();
  await expect
    .poll(() => recvB.some((e) => e.name === 'player:left' && (e.data as { userId: string }).userId === userIdA), {
      timeout: 40_000,
    })
    .toBe(true);

  await ctxB.close();
});
