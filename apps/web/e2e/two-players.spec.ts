import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

interface ServerEvent {
  name: string;
  data: unknown;
}

// Ghế P2-S3 trong street-01 (packages/shared/src/map/street-01.json). Spawn (784, 432) cách ghế này khoảng 132 px.
const SEAT = { id: 'P2-S3', x: 752, y: 304 };
const SEAT_REACH = 48;

// Mọi frame socket.io dạng "42[name, data]": event server gửi tới trang (received) hoặc client gửi đi (sent).
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

// Vào đúng máy chủ đầu tiên trong danh sách (không dùng Quick Join, để cả hai cùng một server).
async function enter(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tên của bạn').fill(name);
  await page.getByRole('button', { name: 'Vào uống trà đá' }).click();
  await page.locator('.server-card').first().getByRole('button', { name: 'Vào máy chủ này' }).click();
  await expect(page.locator('.game-host canvas')).toBeVisible();
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
}

test('B thấy A vào, đi tới ghế, ngồi, đứng, rồi rời', async ({ browser }: { browser: Browser }) => {
  const suffix = `${Date.now() % 100_000}${Math.floor(Math.random() * 1000)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const nameA = `An${suffix}`;
  const nameB = `Binh${suffix}`;
  const framesA = watchFrames(pageA);
  const framesB = watchFrames(pageB);

  // B vào trước để A vào sau: B nhận player:joined của A.
  await enter(pageB, nameB);
  await enter(pageA, nameA);

  const joinedA = () =>
    framesB.received.find((e) => e.name === 'player:joined' && (e.data as { displayName: string }).displayName === nameA)
      ?.data as { userId: string } | undefined;
  await expect.poll(() => joinedA() !== undefined, { timeout: 15_000 }).toBe(true);
  const userIdA = joinedA()!.userId;
  const interactedA = (state: string) =>
    framesB.received.find((e) => e.name === 'player:interacted' && (e.data as { userId: string; state?: string }).userId === userIdA && (e.data as { state?: string }).state === state)
      ?.data as { seatId?: string } | undefined;

  // A đi lên bằng phím W tới khi vị trí gửi đi nằm trong tầm ngồi của ghế.
  const lastSentA = () => framesA.sent.filter((e) => e.name === 'player:move').at(-1)?.data as { x: number; y: number } | undefined;
  const inReach = () => {
    const p = lastSentA();
    return p !== undefined && Math.hypot(p.x - SEAT.x, p.y - SEAT.y) <= SEAT_REACH;
  };
  await pageA.keyboard.down('w');
  // Poll cố định 50 ms: cửa sổ tầm ngồi chỉ khoảng 0.4 s khi đi thẳng.
  await expect.poll(inReach, { timeout: 10_000, intervals: [50] }).toBe(true);
  await pageA.keyboard.up('w');

  // A nhấn E: ngồi xuống ghế gần nhất. B nhận player:interacted SIT đúng ghế.
  await pageA.keyboard.press('e');
  await expect.poll(() => interactedA('SIT')?.seatId ?? null, { timeout: 10_000 }).toBe(SEAT.id);
  await expect(pageA.locator('.game-overlay')).toHaveCount(0);
  await pageB.screenshot({ path: join(import.meta.dirname, 'screens', 'two-players.png') });

  // A nhấn E lần nữa: đứng dậy. B nhận STAND, ghế được giải phóng.
  await pageA.keyboard.press('e');
  await expect.poll(() => interactedA('STAND') !== undefined, { timeout: 10_000 }).toBe(true);

  // A rời: server kết thúc phiên sau grace, B nhận player:left đúng userId của A.
  await ctxA.close();
  await expect
    .poll(() => framesB.received.some((e) => e.name === 'player:left' && (e.data as { userId: string }).userId === userIdA), {
      timeout: 40_000,
    })
    .toBe(true);

  await ctxB.close();
});
