import { getSpawn, isWalkable, street01Map, TILE_SIZE, type TiledMap } from '@tdvh/shared';
import { describe, expect, it } from 'vitest';
import {
  MOVE_SPEED,
  SEND_INTERVAL_MS,
  dirFromVector,
  nextPosition,
  roundPoint,
  shouldSendMove,
  vectorFromKeys,
  vectorTo,
  type Dir,
  type Pos,
  type SentState,
} from './movement';

const NONE = { left: false, right: false, up: false, down: false };
const DIRS: { dir: Dir; v: { x: number; y: number } }[] = [
  { dir: 'right', v: { x: 1, y: 0 } },
  { dir: 'left', v: { x: -1, y: 0 } },
  { dir: 'down', v: { x: 0, y: 1 } },
  { dir: 'up', v: { x: 0, y: -1 } },
];

describe('vectorFromKeys', () => {
  it('không phím thì đứng yên, một phím thì đơn vị, hai phím chéo được chuẩn hóa', () => {
    expect(vectorFromKeys(NONE)).toEqual({ x: 0, y: 0 });
    expect(vectorFromKeys({ ...NONE, right: true })).toEqual({ x: 1, y: 0 });
    const d = 1 / Math.SQRT2;
    const diag = vectorFromKeys({ ...NONE, left: true, up: true });
    expect(diag.x).toBeCloseTo(-d, 10);
    expect(diag.y).toBeCloseTo(-d, 10);
  });

  it('hai phím đối nhau triệt tiêu', () => {
    expect(vectorFromKeys({ ...NONE, left: true, right: true })).toEqual({ x: 0, y: 0 });
  });
});

describe('vectorTo', () => {
  it('trả vector đơn vị tới đích, gần đích thì 0', () => {
    expect(vectorTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toEqual({ x: 0, y: 1 });
    expect(vectorTo({ x: 5, y: 5 }, { x: 6, y: 5 })).toEqual({ x: 0, y: 0 });
  });
});

describe('dirFromVector', () => {
  it('theo trục lớn hơn, giữ hướng cũ khi đứng yên', () => {
    expect(dirFromVector({ x: 1, y: 0.2 }, 'up')).toBe('right');
    expect(dirFromVector({ x: -0.3, y: 1 }, 'left')).toBe('down');
    expect(dirFromVector({ x: 0, y: -1 }, 'right')).toBe('up');
    expect(dirFromVector({ x: 0, y: 0 }, 'left')).toBe('left');
  });
});

describe('roundPoint', () => {
  it('làm tròn về số nguyên', () => {
    expect(roundPoint({ x: 10.4, y: 10.6 })).toEqual({ x: 10, y: 11 });
  });
});

describe('nextPosition', () => {
  const spawn = getSpawn(street01Map);

  it('đứng yên khi vector 0', () => {
    expect(nextPosition(street01Map, spawn, { x: 0, y: 0 }, 1000)).toEqual(spawn);
  });

  it('đi đúng quãng đường theo tốc độ, dt bị cắt ở 100 ms', () => {
    const dir = openDirection(street01Map, spawn);
    const one = nextPosition(street01Map, spawn, dir.v, 100);
    const capped = nextPosition(street01Map, spawn, dir.v, 5000);
    expect(Math.hypot(one.x - spawn.x, one.y - spawn.y)).toBeCloseTo(MOVE_SPEED * 0.1, 6);
    expect(capped).toEqual(one);
  });

  it('không bao giờ đứng ở điểm không đi được, và dừng khi chạm tường', () => {
    const dir = openDirection(street01Map, spawn);
    let pos: Pos = spawn;
    for (let i = 0; i < 2000; i += 1) {
      pos = nextPosition(street01Map, pos, dir.v, 16);
      expect(isWalkable(street01Map, Math.round(pos.x), Math.round(pos.y))).toBe(true);
    }
    expect(nextPosition(street01Map, pos, dir.v, 16)).toEqual(pos);
  });

  it('chặn trục đi vào tường nhưng trục kia vẫn trượt', () => {
    const { pos, v } = wallSlideCase(street01Map);
    const p = nextPosition(street01Map, pos, v, 100);
    expect(p.x).toBe(pos.x);
    expect(p.y).toBeGreaterThan(pos.y);
    expect(isWalkable(street01Map, Math.round(p.x), Math.round(p.y))).toBe(true);
  });
});

describe('shouldSendMove', () => {
  const sent: SentState = { x: 100, y: 100, dir: 'down', at: 1000 };

  it('chưa gửi lần nào thì gửi', () => {
    expect(shouldSendMove(null, { x: 1, y: 1, dir: 'up' }, 0)).toBe(true);
  });

  it('không đổi thì không gửi', () => {
    expect(shouldSendMove(sent, { x: 100, y: 100, dir: 'down' }, 5000)).toBe(false);
  });

  it('đổi nhưng chưa đủ khoảng nghỉ thì chưa gửi, đủ thì gửi', () => {
    const next = { x: 101, y: 100, dir: 'right' as const };
    expect(shouldSendMove(sent, next, 1000 + SEND_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSendMove(sent, next, 1000 + SEND_INTERVAL_MS)).toBe(true);
  });

  it('đi liên tục vẫn không gửi quá 10 lần mỗi giây', () => {
    let last: SentState | null = null;
    let sends = 0;
    for (let t = 0; t <= 1000; t += 16) {
      const pos = { x: 100 + Math.round((t * MOVE_SPEED) / 1000), y: 100, dir: 'right' as const };
      if (shouldSendMove(last, pos, t)) {
        sends += 1;
        last = { ...pos, at: t };
      }
    }
    expect(sends).toBeLessThanOrEqual(11);
    expect(sends).toBeGreaterThan(5);
  });
});

describe('map street-01 dùng cho test di chuyển', () => {
  it('ô ngoài biên không đi được, ô spawn đi được', () => {
    expect(isWalkable(street01Map, -1, -1)).toBe(false);
    const spawn = getSpawn(street01Map);
    expect(isWalkable(street01Map, spawn.x, spawn.y)).toBe(true);
    expect(TILE_SIZE).toBe(32);
  });
});

// Hướng đầu tiên đi thêm được từ điểm xuất phát.
function openDirection(map: TiledMap, from: Pos) {
  for (const d of DIRS) {
    const p = nextPosition(map, from, d.v, 100);
    if (p.x !== from.x || p.y !== from.y) return d;
  }
  throw new Error('điểm xuất phát bị kẹt, kiểm tra map');
}

// Một ô đi được ngay sát mép phải, ô bên phải là tường, ô bên dưới đi được.
function wallSlideCase(map: TiledMap): { pos: Pos; v: { x: number; y: number } } {
  for (let ty = 1; ty < map.height - 1; ty += 1) {
    for (let tx = 1; tx < map.width - 1; tx += 1) {
      const pos = { x: tx * TILE_SIZE + 30, y: ty * TILE_SIZE + 16 };
      if (!isWalkable(map, pos.x, pos.y)) continue;
      // Đúng điểm mà nextPosition thử với dt = 100 ms (bước 16 px).
      if (isWalkable(map, Math.round(pos.x + 16), Math.round(pos.y))) continue;
      if (!isWalkable(map, Math.round(pos.x), Math.round(pos.y + 16))) continue;
      return { pos, v: { x: 1, y: 1 } };
    }
  }
  throw new Error('không tìm thấy mép tường trong map');
}
