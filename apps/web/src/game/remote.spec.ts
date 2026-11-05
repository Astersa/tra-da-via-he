import { describe, expect, it } from 'vitest';
import { getSeats, street01Map } from '@tdvh/shared';
import {
  INTERP_MS,
  MAX_QUEUE,
  NAME_MAX_CHARS,
  advance,
  createTrack,
  diffIds,
  interpolate,
  nearestFreeSeat,
  positionAt,
  pushTarget,
  seatPrompt,
  shortName,
  type Track,
} from './remote';

describe('interpolate', () => {
  it('tuyến tính và kẹp k trong [0, 1]', () => {
    expect(interpolate({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)).toEqual({ x: 50, y: 25 });
    expect(interpolate({ x: 0, y: 0 }, { x: 100, y: 0 }, -1)).toEqual({ x: 0, y: 0 });
    expect(interpolate({ x: 0, y: 0 }, { x: 100, y: 0 }, 3)).toEqual({ x: 100, y: 0 });
  });
});

describe('track', () => {
  it('đứng yên ở vị trí ban đầu', () => {
    const t = createTrack({ x: 10, y: 20 }, 0);
    expect(positionAt(t, 500)).toEqual({ x: 10, y: 20 });
  });

  it('một mục tiêu đi tới trong 100 ms, giữa đường là nội suy', () => {
    let t: Track = createTrack({ x: 0, y: 0 }, 0);
    t = pushTarget(t, { x: 100, y: 0 }, 1000);
    expect(positionAt(t, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(t, 1000 + INTERP_MS / 2).x).toBeCloseTo(50);
    expect(positionAt(t, 1000 + INTERP_MS)).toEqual({ x: 100, y: 0 });
    expect(positionAt(t, 5000)).toEqual({ x: 100, y: 0 });
  });

  it('mục tiêu đến khi đang chạy được xếp hàng, không nhảy', () => {
    let t = createTrack({ x: 0, y: 0 }, 0);
    t = pushTarget(t, { x: 100, y: 0 }, 0);
    t = pushTarget(t, { x: 200, y: 0 }, 50);
    expect(positionAt(t, 50).x).toBeCloseTo(50);
    expect(positionAt(t, 100).x).toBeCloseTo(100);
    expect(positionAt(t, 200).x).toBeCloseTo(200);
  });

  it('lặp đúng mục tiêu cuối thì không thêm vào hàng đợi', () => {
    let t = createTrack({ x: 0, y: 0 }, 0);
    t = pushTarget(t, { x: 100, y: 0 }, 0);
    const again = pushTarget(t, { x: 100, y: 0 }, 10);
    expect(again.queue).toHaveLength(0);
    expect(again.to).toEqual({ x: 100, y: 0 });
  });

  it('hàng đợi bị cắt, giữ mục mới nhất, không trễ dồn', () => {
    let t = createTrack({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 10; i++) t = pushTarget(t, { x: i * 10, y: 0 }, 0);
    expect(t.queue.length).toBeLessThanOrEqual(MAX_QUEUE);
    expect(t.queue[t.queue.length - 1]).toEqual({ x: 100, y: 0 });
    expect(positionAt(t, 10_000)).toEqual({ x: 100, y: 0 });
  });

  it('advance chuyển đoạn đã hết thời gian', () => {
    let t = createTrack({ x: 0, y: 0 }, 0);
    t = pushTarget(t, { x: 10, y: 0 }, 0);
    t = pushTarget(t, { x: 20, y: 0 }, 0);
    const a = advance(t, INTERP_MS);
    expect(a.from).toEqual({ x: 10, y: 0 });
    expect(a.queue).toHaveLength(0);
  });
});

describe('diffIds', () => {
  it('tìm id cần thêm và cần xóa', () => {
    expect(diffIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(diffIds([], ['a'])).toEqual({ added: ['a'], removed: [] });
    expect(diffIds(['a'], [])).toEqual({ added: [], removed: ['a'] });
  });
});

describe('shortName', () => {
  it('giữ nguyên tên ngắn, cắt tên dài theo ký tự Unicode', () => {
    expect(shortName('  Nguyễn Văn An  ')).toBe('Nguyễn Văn An');
    const long = 'Ấ'.repeat(NAME_MAX_CHARS + 5);
    const out = shortName(long);
    expect(Array.from(out)).toHaveLength(NAME_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
    expect(shortName('   ')).toBe('?');
  });
});

describe('ghế', () => {
  const seats = getSeats(street01Map);
  const first = seats[0]!;

  it('bỏ qua ghế đã có người, chọn ghế trống trong tầm 48 px', () => {
    const near = { x: first.x, y: first.y };
    expect(nearestFreeSeat(seats, near, {})?.id).toBe(first.id);
    expect(nearestFreeSeat(seats, near, { [first.id]: 'someone' })?.id).not.toBe(first.id);
    expect(nearestFreeSeat(seats, { x: first.x + 200, y: first.y + 200 }, {})).toBeNull();
  });

  it('gợi ý E: Ngồi / E: Đứng', () => {
    const near = { x: first.x, y: first.y };
    expect(seatPrompt({ seatId: null, x: near.x, y: near.y }, near, seats, {})).toBe('E: Ngồi');
    expect(seatPrompt({ seatId: first.id, x: near.x, y: near.y }, near, seats, {})).toBe('E: Đứng');
    expect(seatPrompt({ seatId: null, x: 0, y: 0 }, { x: 0, y: 0 }, [], {})).toBeNull();
    expect(seatPrompt(null, near, seats, {})).toBeNull();
  });
});
