// Nội suy và trạng thái người chơi khác (thuần, không import Phaser, test bằng vitest node).
import type { Seat } from '@tdvh/shared';

export interface Pos {
  x: number;
  y: number;
}

/** Thời gian của mỗi đoạn nội suy (ms). */
export const INTERP_MS = 100;
/** Số mục tiêu tối đa chờ trong hàng đợi. Vượt thì bỏ mục cũ nhất để không trễ dồn. */
export const MAX_QUEUE = 3;
/** Khoảng cách tối đa để ngồi vào ghế (§3.4.2, khớp với server). */
export const SEAT_REACH = 48;
/** Số ký tự tối đa của nhãn tên. */
export const NAME_MAX_CHARS = 16;
/** Độ mờ khi người chơi mất kết nối (connected: false). */
export const DISCONNECTED_ALPHA = 0.4;

/** Một đoạn nội suy đang chạy từ `from` tới `to`, cộng hàng đợi các mục tiêu sau đó. */
export interface Track {
  from: Pos;
  to: Pos;
  startedAt: number;
  queue: readonly Pos[];
}

/** Nội suy tuyến tính theo k trong [0, 1]. */
export function interpolate(from: Pos, to: Pos, k: number): Pos {
  const t = Math.min(1, Math.max(0, k));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function createTrack(p: Pos, now: number): Track {
  // startedAt lùi một đoạn để track mới coi như đã đứng yên, mục tiêu đầu tiên bắt đầu ngay.
  return { from: p, to: p, startedAt: now - INTERP_MS, queue: [] };
}

/** Chuyển các đoạn đã hết thời gian sang đoạn kế tiếp trong hàng đợi. */
export function advance(track: Track, now: number): Track {
  let t = track;
  while (t.queue.length > 0 && now - t.startedAt >= INTERP_MS) {
    const [next, ...rest] = t.queue;
    t = { from: t.to, to: next!, startedAt: t.startedAt + INTERP_MS, queue: rest };
  }
  return t;
}

/** Vị trí hiển thị tại thời điểm now. */
export function positionAt(track: Track, now: number): Pos {
  const t = advance(track, now);
  return interpolate(t.from, t.to, (now - t.startedAt) / INTERP_MS);
}

/**
 * Thêm vị trí mới (đã là bản mới nhất của server; seq cũ đã bị store bỏ).
 * Đoạn đang chạy xong thì bắt đầu đoạn mới ngay; còn không thì xếp hàng.
 */
export function pushTarget(track: Track, target: Pos, now: number): Track {
  const t = advance(track, now);
  const last = t.queue.length > 0 ? t.queue[t.queue.length - 1]! : t.to;
  if (last.x === target.x && last.y === target.y) return t;
  if (t.queue.length === 0 && now - t.startedAt >= INTERP_MS) {
    return { from: t.to, to: target, startedAt: now, queue: [] };
  }
  const queue = [...t.queue, target];
  while (queue.length > MAX_QUEUE) queue.shift();
  return { ...t, queue };
}

/** So sánh hai tập id: cái nào cần thêm, cái nào cần xóa. */
export function diffIds(
  current: Iterable<string>,
  next: Iterable<string>,
): { added: string[]; removed: string[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  return {
    added: [...nxt].filter((id) => !cur.has(id)),
    removed: [...cur].filter((id) => !nxt.has(id)),
  };
}

/** Tên hiển thị rút gọn, đếm theo ký tự Unicode để không cắt giữa dấu tiếng Việt. */
export function shortName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length === 0) return '?';
  if (chars.length <= NAME_MAX_CHARS) return chars.join('');
  return `${chars.slice(0, NAME_MAX_CHARS - 1).join('')}…`;
}

/** Ghế còn trống gần nhất trong tầm ngồi, hoặc null. */
export function nearestFreeSeat(seats: readonly Seat[], pos: Pos, taken: Record<string, string>): Seat | null {
  let best: Seat | null = null;
  let bestD = Infinity;
  for (const s of seats) {
    if (taken[s.id] !== undefined) continue;
    const d = Math.hypot(s.x - pos.x, s.y - pos.y);
    if (d <= SEAT_REACH && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Gợi ý phím E cho người chơi mình: đang ngồi thì "Đứng", gần ghế trống thì "Ngồi". */
export function seatPrompt(
  self: { seatId: string | null; x: number; y: number } | null,
  pos: Pos,
  seats: readonly Seat[],
  taken: Record<string, string>,
): string | null {
  if (!self) return null;
  if (self.seatId) return 'E: Đứng';
  return nearestFreeSeat(seats, pos, taken) ? 'E: Ngồi' : null;
}
