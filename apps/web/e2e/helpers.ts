import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

// Dùng chung cho m1-exit.spec.ts. Không import từ server src: chỉ đọc DB qua pg và chạy script provision của server.
const here = path.dirname(fileURLToPath(import.meta.url));
export const serverDir = path.resolve(here, '../../server');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const tsxCli = path.join(serverDir, 'node_modules/tsx/dist/cli.mjs');

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}
const PgClient = serverRequire('pg').Client as new (cfg: { connectionString: string }) => PgClient;

export interface ServerEvent {
  name: string;
  data: unknown;
}

export interface Frames {
  received: ServerEvent[];
  sent: ServerEvent[];
  sockets: number;
}

// DATABASE_URL: từ môi trường (scripts/e2e.mjs đặt sẵn), nếu không thì đọc .env.test.
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = readFileSync(path.join(serverDir, '.env.test'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL không có trong môi trường và .env.test');
  return line.slice('DATABASE_URL='.length);
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new PgClient({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

// Mọi frame socket.io dạng "42[name, data]" của trang, gửi đi (sent) hoặc nhận về (received), và số socket đã mở.
export function watchFrames(page: Page): Frames {
  const frames: Frames = { received: [], sent: [], sockets: 0 };
  const parse = (payload: string | Buffer): ServerEvent | null => {
    // 42[...] hoặc 42N[...] khi frame có ack id (emit có callback).
    const m = /^42\d*(\[.*)$/s.exec(String(payload));
    if (!m) return null;
    const [name, data] = JSON.parse(m[1]!) as [string, unknown];
    return { name, data };
  };
  page.on('websocket', (ws) => {
    frames.sockets += 1;
    ws.on('framereceived', (f) => {
      const e = parse(f.payload);
      if (e) frames.received.push(e);
    });
    ws.on('framesent', (f) => {
      const e = parse(f.payload);
      if (e) frames.sent.push(e);
    });
  });
  return frames;
}

// Tên ngẫu nhiên: displayNameKey là unique và DB giữ qua các lần chạy (tối đa 20 ký tự).
export function uniqueName(prefix: string): string {
  return `${prefix}${Date.now() % 100_000}${Math.floor(Math.random() * 1000)}`;
}

// Vào màn chơi: chọn nhân vật (thứ tự 0..3), đặt tên, chọn máy chủ có tên serverName.
// /auth/guest giới hạn theo IP: 5 lần đầu, sau đó 1 lần mỗi 12 s (IpRateLimit(5, 5/60)). Gặp RATE_LIMITED thì chờ đúng nhịp rồi thử lại.
const RATE_LIMITED_TEXT = 'Bạn thao tác quá nhanh';
export async function enterServer(page: Page, name: string, serverName: string, avatarIndex = 0): Promise<void> {
  await page.goto('/');
  await page.locator('label.avatar-choice').nth(avatarIndex).click();
  await page.getByLabel('Tên của bạn').fill(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByRole('button', { name: 'Vào uống trà đá' }).click();
    const picked = page.getByText('Chọn máy chủ', { exact: true });
    const limited = page.getByRole('alert').filter({ hasText: RATE_LIMITED_TEXT });
    await expect(picked.or(limited)).toBeVisible({ timeout: 15_000 });
    if (await picked.isVisible()) break;
    await page.waitForTimeout(12_500);
  }
  await joinServerCard(page, serverName);
}

// Ở màn chọn máy chủ: bấm "Vào máy chủ này" của thẻ có tên serverName, rồi chờ màn chơi hiện xong.
export async function joinServerCard(page: Page, serverName: string): Promise<void> {
  const card = page.locator('article.server-card').filter({
    has: page.getByRole('heading', { name: serverName, exact: true }),
  });
  await card.getByRole('button', { name: 'Vào máy chủ này' }).click();
  await expect(page.locator('.game-host canvas')).toBeVisible();
  await expect(page.locator('.game-overlay')).toHaveCount(0, { timeout: 15_000 });
}

// Tạo thêm một máy chủ ACTIVE (provision đầy đủ 3 quán) để kiểm tra chuyển server. Chạy cùng DATABASE_URL của test.
export function provisionExtraServer(slug: string, name: string): void {
  execFileSync(process.execPath, [tsxCli, 'scripts/provision-server.ts', `--slug=${slug}`, `--name=${name}`], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdio: 'pipe',
  });
}
