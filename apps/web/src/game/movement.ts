// Logic di chuyển thuần (không import Phaser, test được bằng vitest node).
import { isWalkable, type TiledMap } from '@tdvh/shared';

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Pos {
  x: number;
  y: number;
}
export interface Vec {
  x: number;
  y: number;
}

/** Tốc độ đi, pixel mỗi giây. Ô 32 px nên mỗi khung hình không vượt quá một ô. */
export const MOVE_SPEED = 160;
/** Khoảng cách tối thiểu giữa hai lần gửi player:move: 10 lần/giây, dưới giới hạn server 20 / 12. */
export const SEND_INTERVAL_MS = 100;
/** Dưới ngưỡng này coi như đã tới đích (click-to-move). */
export const ARRIVE_EPS = 2;
/** Khung hình quá dài (tab nền, lag) bị cắt để không nhảy xuyên tường. */
const MAX_DT_MS = 100;

export interface SentState extends Pos {
  dir: Dir;
  /** Thời điểm gửi gần nhất (ms). -Infinity nghĩa là chưa có giới hạn nhịp. */
  at: number;
}

/** Vector hướng từ phím, đã chuẩn hóa (đi chéo không nhanh hơn). */
export function vectorFromKeys(k: { left: boolean; right: boolean; up: boolean; down: boolean }): Vec {
  const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const y = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

/** Vector đơn vị từ `from` tới `to`; gần đích thì trả vector 0. */
export function vectorTo(from: Pos, to: Pos): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_EPS) return { x: 0, y: 0 };
  return { x: dx / dist, y: dy / dist };
}

/** Hướng nhìn theo trục lớn hơn; vector 0 giữ hướng cũ. */
export function dirFromVector(v: Vec, fallback: Dir): Dir {
  if (v.x === 0 && v.y === 0) return fallback;
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x < 0 ? 'left' : 'right';
  return v.y < 0 ? 'up' : 'down';
}

/** Tọa độ gửi lên server là số nguyên (schema player:move dùng int). */
export function roundPoint(p: Pos): Pos {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * Bước đi trong một khung hình. Tách hai trục: mỗi trục chỉ nhận bước nếu điểm
 * đích (đã làm tròn, đúng thứ sẽ gửi đi) không phải tường. Nhờ vậy đi sát tường
 * thì trượt theo, không xuyên qua.
 */
export function nextPosition(map: TiledMap, pos: Pos, v: Vec, dtMs: number): Pos {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS) / 1000;
  const step = MOVE_SPEED * dt;
  let { x, y } = pos;
  if (v.x !== 0) {
    const nx = x + v.x * step;
    if (isWalkable(map, Math.round(nx), Math.round(y))) x = nx;
  }
  if (v.y !== 0) {
    const ny = y + v.y * step;
    if (isWalkable(map, Math.round(x), Math.round(ny))) y = ny;
  }
  return { x, y };
}

/**
 * Có gửi player:move không. Chỉ gửi khi trạng thái làm tròn khác lần gửi trước
 * và đã đủ SEND_INTERVAL_MS. Thay đổi trong khoảng nghỉ được gửi ở khung hình sau đó.
 */
export function shouldSendMove(last: SentState | null, next: Pos & { dir: Dir }, now: number): boolean {
  if (last === null) return true;
  if (last.x === next.x && last.y === next.y && last.dir === next.dir) return false;
  return now - last.at >= SEND_INTERVAL_MS;
}
