import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { enterServer } from './helpers';

const SERVER_NAME = 'Quán E2E';

interface ServerEvent {
  name: string;
  data: unknown;
}

// Ghế P2-S3 trong street-01 (packages/shared/src/map/street-01.json). Spawn (784, 432) cách ghế này khoảng 132 px.
const SEAT = { id: 'P2-S3', x: 752, y: 304 };
const SEAT_REACH = 48;
// Điểm click cách ghế 26 px về phía dưới: nằm trong tầm ngồi (48 px) và không trùng ghế.
const SEAT_TAP_OFFSET_Y = 26;

// Canvas logic 960x540 (createGame, FIT), camera zoom 1.5 và theo nhân vật (startFollow, không bị kẹp vì spawn ở giữa map).
// Đổi điểm world sang vị trí trong canvas rồi click; WorldScene đặt đích = tọa độ world của điểm đó.
const LOGICAL = { w: 960, h: 540 };
const CAMERA_ZOOM = 1.5;
async function clickWorld(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const canvas = page.locator('.game-host canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const lx = LOGICAL.w / 2 + (to.x - from.x) * CAMERA_ZOOM;
  const ly = LOGICAL.h / 2 + (to.y - from.y) * CAMERA_ZOOM;
  await canvas.click({ position: { x: (lx / LOGICAL.w) * box!.width, y: (ly / LOGICAL.h) * box!.height } });
}

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

// Vào đúng máy chủ 'Quán E2E' (không dùng Quick Join, để cả hai cùng một server). Xử lý RATE_LIMITED trong helpers.ts.
async function enter(page: Page, name: string): Promise<void> {
  await enterServer(page, name, SERVER_NAME);
}

test('B thấy A vào, đi tới ghế, ngồi, đứng, rồi rời', async ({ browser }: { browser: Browser }) => {
  // Bước cuối chờ reconnectGraceSeconds (30 s, §3.9) rồi mới có player:left: cần lâu hơn timeout mặc định 30 s.
  test.setTimeout(120_000);
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
      ?.data as { userId: string; x: number; y: number } | undefined;
  await expect.poll(() => joinedA() !== undefined, { timeout: 15_000 }).toBe(true);
  const userIdA = joinedA()!.userId;
  const interactedA = (state: string) =>
    framesB.received.find((e) => e.name === 'player:interacted' && (e.data as { userId: string; state?: string }).userId === userIdA && (e.data as { state?: string }).state === state)
      ?.data as { seatId?: string } | undefined;

  // A click (click-to-move) tới ô cạnh ghế. Vị trí xuất phát của A lấy từ player:joined mà B nhận được.
  const spawnA = joinedA()!;
  await clickWorld(pageA, spawnA, { x: SEAT.x, y: SEAT.y + SEAT_TAP_OFFSET_Y });

  // Chờ tới khi A đứng yên trong tầm ngồi: vị trí gửi đi không đổi trong 400 ms (server nhận player:move khi có thay đổi).
  const lastSentA = () => framesA.sent.filter((e) => e.name === 'player:move').at(-1)?.data as { x: number; y: number } | undefined;
  const inReach = () => {
    const p = lastSentA();
    return p !== undefined && Math.hypot(p.x - SEAT.x, p.y - SEAT.y) <= SEAT_REACH;
  };
  let lastKey = '';
  let stillSince = Date.now();
  await expect
    .poll(
      () => {
        const p = lastSentA();
        const key = p ? `${p.x},${p.y}` : '';
        if (key !== lastKey) {
          lastKey = key;
          stillSince = Date.now();
        }
        return Date.now() - stillSince >= 400 && inReach();
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);

  // A nhấn E khi đã ở tầm ghế: ngồi xuống ghế gần nhất. Nếu server chưa nhận, thử E lại tối đa 3 lần (không nhấn lại khi đã có SIT).
  for (let i = 0; i < 3 && interactedA('SIT') === undefined; i++) {
    await pageA.keyboard.press('e');
    await expect.poll(() => interactedA('SIT') !== undefined, { timeout: 1_500 }).toBe(true).catch(() => undefined);
  }
  // B nhận player:interacted SIT đúng ghế.
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
