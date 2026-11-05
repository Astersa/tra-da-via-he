// Hằng số spritesheet avatar, dùng chung cho người chơi mình và người khác (thuần, không import Phaser).
import type { Dir } from './movement';

export const DEFAULT_AVATAR = 'avatar_01';
export const AVATAR_COLUMNS = 4;
// Hàng của spritesheet avatar: xuống, trái, phải, lên (scripts/gen-placeholder-art.ts).
export const ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
// Cột đi bộ; cột 0 là đứng yên. Cột 3 là ngồi.
export const WALK_COLUMNS = [0, 1, 0, 2];
export const SIT_COLUMN = 3;
export const WALK_FRAME_MS = 150;

export function frameFor(dir: Dir, column: number): number {
  return ROW[dir] * AVATAR_COLUMNS + column;
}
