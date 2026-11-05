import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  enterServer,
  joinServerCard,
  provisionExtraServer,
  query,
  uniqueName,
  watchFrames,
  type Frames,
} from './helpers';

// Exit M1 (IMPLEMENTATION-PLAN.md §4.5, card M1-E5-T7). Tên server và quán khớp scripts/e2e.mjs.
const SERVER_NAME = 'Quán E2E';
// Mỗi lần vào cần một guest; /auth/guest chỉ cho 5 lần đầu rồi 1 lần mỗi 12 s, nên một test có thể chờ tới vài chục giây.
const TEST_TIMEOUT_MS = 120_000;
const SCREENS = fileURLToPath(new URL('./screens', import.meta.url));
const GUEST_WARNING = 'Tài khoản khách lưu trên trình duyệt này. Xóa cookie là mất nhân vật và Xu.';

interface UserRow {
  id: string;
  kind: string;
  username: string | null;
  displayName: string;
  avatarId: string;
}
interface SessionRow {
  status: string;
  endReason: string | null;
  serverId: string;
}

async function userByName(displayName: string): Promise<UserRow> {
  const rows = await query<UserRow>(
    `SELECT u.id, u.kind, u.username, p."displayName", p."avatarId"
       FROM "PlayerProfile" p JOIN "User" u ON u.id = p."userId"
      WHERE p."displayName" = $1`,
    [displayName],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function sessionsOf(userId: string): Promise<SessionRow[]> {
  return query<SessionRow>(
    `SELECT status, "endReason", "serverId" FROM "ServerSession" WHERE "userId" = $1 ORDER BY "startedAt"`,
    [userId],
  );
}

// player:joined của một tên hiển thị: mọi lần xuất hiện (để thấy lần vào lại).
function joinedEvents(frames: Frames, displayName: string): { userId: string; avatarId: string }[] {
  return frames.received
    .filter((e) => e.name === 'player:joined' && (e.data as { displayName: string }).displayName === displayName)
    .map((e) => e.data as { userId: string; avatarId: string });
}

// Số khung hình world:join mà trang đã gửi.
const joinsSent = (frames: Frames) => frames.sent.filter((e) => e.name === 'world:join').length;

test('DB: mỗi máy chủ ACTIVE có đúng 3 quán DEFAULT', async () => {
  const rows = await query<{ slug: string; shops: number }>(
    `SELECT g.slug, count(s.id)::int AS shops
       FROM "GameServer" g
       LEFT JOIN "Shop" s ON s."serverId" = g.id AND s.type = 'DEFAULT'
      WHERE g.status = 'ACTIVE'
      GROUP BY g.slug`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.shops, `quán DEFAULT của ${r.slug}`).toBe(3);
});

test('hai trình duyệt: chọn nhân vật, vào cùng máy chủ, B thấy A với đúng nhân vật', async ({ browser }: { browser: Browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const framesB = watchFrames(pageB);
  const nameA = uniqueName('An');
  const nameB = uniqueName('Binh');

  // Chọn nhân vật khác nhau: avatar_02 cho A, avatar_03 cho B.
  await enterServer(pageB, nameB, SERVER_NAME, 2);
  await enterServer(pageA, nameA, SERVER_NAME, 1);

  // B thấy A đúng tên và nhân vật đã chọn; A thấy B (cùng server).
  await expect.poll(() => joinedEvents(framesB, nameA).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(joinedEvents(framesB, nameA)[0]!.avatarId).toBe('avatar_02');
  const userA = await userByName(nameA);
  const userB = await userByName(nameB);
  expect(userB.avatarId).toBe('avatar_03');
  expect(userA.kind).toBe('GUEST');

  await expect(pageA.locator('.game-host canvas')).toBeVisible();
  await expect(pageB.locator('.game-host canvas')).toBeVisible();

  await pageA.context().close();
  await pageB.context().close();
});

test('F5 giữ phiên và trở lại đúng máy chủ', async ({ page }: { page: Page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const frames = watchFrames(page);
  const name = uniqueName('Tung');
  await enterServer(page, name, SERVER_NAME);
  const user = await userByName(name);
  const before = await sessionsOf(user.id);
  expect(before.filter((s) => s.status === 'ACTIVE')).toHaveLength(1);

  await page.reload();
  // Sau F5 không bấm gì: đã đăng nhập bằng cookie làm mới và có bản lưu máy chủ trong sessionStorage nên vào lại quán ngay.
  await expect(page.locator('.game-host canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Chọn máy chủ', { exact: true })).toHaveCount(0);

  // Vào lại trong grace thì tiếp tục đúng phiên cũ: không tạo phiên mới, cùng hàng ServerSession.
  const after = await sessionsOf(user.id);
  expect(after).toEqual(before);
  expect(joinsSent(frames)).toBeGreaterThanOrEqual(2);
});

test('tab thứ hai chiếm phiên; tab một hiện "Chơi ở tab này" và lấy lại được', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const tab1 = await ctx.newPage();
  const name = uniqueName('Hai');
  await enterServer(tab1, name, SERVER_NAME);
  const user = await userByName(name);
  const before = await sessionsOf(user.id);

  const tab2 = await ctx.newPage();
  await tab2.goto('/');
  await expect(tab2.getByText('Chọn máy chủ', { exact: true })).toBeVisible();
  await joinServerCard(tab2, SERVER_NAME);

  // Tab một bị chiếm: thông báo và nút lấy lại; không tự nối lại.
  await expect(tab1.getByRole('status')).toContainText('Tài khoản đang chơi ở tab khác.');
  await expect(tab1.getByRole('button', { name: 'Chơi ở tab này' })).toBeVisible();
  // Cùng máy chủ: tab hai dùng chung phiên (không tạo phiên mới), chỉ socket của tab một bị thay.
  expect(await sessionsOf(user.id)).toEqual(before);

  // Tab một lấy lại: tab hai bị chiếm.
  await tab1.getByRole('button', { name: 'Chơi ở tab này' }).click();
  await expect(tab1.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(tab2.getByRole('status')).toContainText('Tài khoản đang chơi ở tab khác.');

  await ctx.close();
});

test('nâng cấp tài khoản giữ socket; đăng xuất rồi đăng nhập lại có cùng tên và nhân vật', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const framesA = watchFrames(pageA);
  const framesB = watchFrames(pageB);
  // Lỗi JS chưa bắt trong trang (ví dụ lỗi khi đăng xuất rồi vào lại) làm kẹt màn: phải không có.
  const pageErrors: string[] = [];
  pageA.on('pageerror', (e) => pageErrors.push(e.message));
  pageB.on('pageerror', (e) => pageErrors.push(e.message));
  const name = uniqueName('Nang');
  const username = `u${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`.slice(0, 20);
  const password = 'matkhau-e2e-2026';

  await enterServer(pageB, uniqueName('Quan'), SERVER_NAME);
  await enterServer(pageA, name, SERVER_NAME, 3);
  await expect.poll(() => joinedEvents(framesB, name).length, { timeout: 15_000 }).toBeGreaterThan(0);

  // HUD của khách: cảnh báo và nút tạo tài khoản.
  const hud = pageA.getByRole('region', { name: 'Tài khoản' });
  await expect(hud).toContainText(GUEST_WARNING);
  const socketsBefore = framesA.sockets;
  const joinsBefore = joinsSent(framesA);

  await hud.getByRole('button', { name: 'Tạo tài khoản' }).click();
  const dialog = pageA.getByRole('dialog');
  await dialog.getByLabel('Tên đăng nhập').fill(username);
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await dialog.getByLabel('Nhập lại mật khẩu').fill(password);
  await dialog.getByRole('button', { name: 'Tạo tài khoản' }).click();

  // Nâng cấp xong: hộp thoại đóng, HUD không còn cảnh báo khách, socket vẫn là socket cũ và không gửi world:join lại.
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(hud).toHaveCount(0);
  await expect(pageA.getByText(GUEST_WARNING)).toHaveCount(0);
  expect(framesA.sockets).toBe(socketsBefore);
  expect(joinsSent(framesA)).toBe(joinsBefore);
  await expect(pageA.locator('.game-host canvas')).toBeVisible();

  const registered = await userByName(name);
  expect(registered.kind).toBe('REGISTERED');
  expect(registered.username).toBe(username);

  // Đăng xuất (tài khoản đã có thì không cần xác nhận lại), về màn vào.
  const sessionsBeforeLogout = await sessionsOf(registered.id);
  await pageA.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(pageA.getByRole('button', { name: 'Đã có tài khoản? Đăng nhập' })).toBeVisible({ timeout: 15_000 });

  // Đăng nhập lại bằng username: cùng tên hiển thị, vào đúng máy chủ với cùng nhân vật.
  await pageA.getByRole('button', { name: 'Đã có tài khoản? Đăng nhập' }).click();
  await pageA.getByLabel('Tên đăng nhập').fill(username);
  await pageA.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await pageA.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(pageA.getByText(`Xin chào, ${name}!`)).toBeVisible({ timeout: 15_000 });
  await joinServerCard(pageA, SERVER_NAME);

  // Cùng tài khoản, cùng nhân vật (avatar_04 là lựa chọn index 3), cùng phiên: vào lại trong grace thì tiếp tục phiên cũ.
  const again = await userByName(name);
  expect(again.id).toBe(registered.id);
  expect(again.avatarId).toBe('avatar_04');
  expect(await sessionsOf(registered.id)).toEqual(sessionsBeforeLogout);
  expect(joinedEvents(framesB, name)[0]!.avatarId).toBe('avatar_04');

  // Ảnh cuối của phiên này: desktop, rồi 390px (đổi viewport, cùng phiên).
  await pageA.screenshot({ path: join(SCREENS, 'm1-exit-desktop.png') });
  await pageA.setViewportSize({ width: 390, height: 844 });
  await expect(pageA.locator('.game-host canvas')).toBeVisible();
  await pageA.screenshot({ path: join(SCREENS, 'm1-exit-390.png') });

  expect(pageErrors).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('chuyển máy chủ (socket): người ở lại thấy người đi biến mất, không còn phiên cũ', async ({ browser, request }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const baseURL = testInfo.project.use.baseURL as string;
  // Máy chủ thứ hai, để có đích chuyển. Đặt tên sau máy chủ chính để thẻ đầu danh sách vẫn là máy chủ chính.
  const suffix = `${Date.now() % 1_000_000}`;
  provisionExtraServer(`e2e-switch-${suffix}`, 'Quán E2E Hai');
  const servers = await query<{ id: string; slug: string }>(
    `SELECT id, slug FROM "GameServer" WHERE status = 'ACTIVE' AND slug LIKE 'e2e-%' ORDER BY "createdAt"`,
  );
  const source = servers.find((s) => s.slug === 'e2e-main');
  const target = servers.find((s) => s.slug === `e2e-switch-${suffix}`);
  expect(source).toBeDefined();
  expect(target).toBeDefined();

  const ctx = await browser.newContext();
  const pageB = await ctx.newPage();
  const framesB = watchFrames(pageB);
  await enterServer(pageB, uniqueName('Ostay'), SERVER_NAME);

  // Người đi: socket trực tiếp với token khách, không qua trang (không có UI chuyển máy chủ trong client).
  const movingName = uniqueName('Gone');
  // Cùng giới hạn /auth/guest theo IP như enterServer: 429 thì chờ nhịp rồi thử lại.
  let accessToken = '';
  for (let attempt = 0; attempt < 6 && accessToken === ''; attempt++) {
    const guest = await request.post('/api/v1/auth/guest', { data: { displayName: movingName, avatarId: 'avatar_01' } });
    if (guest.ok()) {
      accessToken = ((await guest.json()) as { accessToken: string }).accessToken;
    } else {
      expect(guest.status()).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 12_500));
    }
  }
  expect(accessToken).not.toBe('');
  const socket: Socket = io(baseURL, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { token: accessToken },
  });
  const call = (event: string, payload: unknown) =>
    new Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>((resolve, reject) => {
      socket.timeout(5_000).emit(event, payload, (err: unknown, res: unknown) =>
        err ? reject(err) : resolve(res as { ok: boolean; data?: unknown; error?: { code: string } }),
      );
    });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

  const joined = await call('world:join', { serverId: source!.id });
  expect(joined.ok).toBe(true);
  const userId = (await userByName(movingName)).id;
  await expect.poll(() => joinedEvents(framesB, movingName).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const switched = await call('server:switch', { targetServerId: target!.id });
  expect(switched.ok).toBe(true);

  // Người ở lại thấy người kia biến mất (player:left đúng userId).
  await expect
    .poll(() => framesB.received.some((e) => e.name === 'player:left' && (e.data as { userId: string }).userId === userId), {
      timeout: 10_000,
    })
    .toBe(true);

  // Trong DB: phiên cũ ENDED SWITCHED trên máy chủ nguồn, phiên mới ACTIVE trên máy chủ đích, không còn phiên ACTIVE cũ.
  const sessions = await sessionsOf(userId);
  const old = sessions.filter((s) => s.serverId === source!.id);
  expect(old.every((s) => s.status === 'ENDED')).toBe(true);
  expect(old.some((s) => s.endReason === 'SWITCHED')).toBe(true);
  expect(sessions.filter((s) => s.status === 'ACTIVE')).toEqual([expect.objectContaining({ serverId: target!.id })]);

  socket.disconnect();
  await ctx.close();
});
