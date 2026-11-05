import { startOfVnDay, vnDayKey } from './clock.js';

// Vietnam is fixed UTC+7 (no DST): 17:00Z is midnight in Ho Chi Minh City.
describe('VN day boundary (UTC+7)', () => {
  it('16:59:59Z is still the previous instant of 2026-11-05 VN day', () => {
    const now = new Date('2026-11-05T16:59:59Z');
    expect(vnDayKey(now)).toBe('2026-11-05');
    expect(startOfVnDay(now).toISOString()).toBe('2026-11-04T17:00:00.000Z');
  });

  it('17:00:00Z starts 2026-11-06 VN day', () => {
    const now = new Date('2026-11-05T17:00:00Z');
    expect(vnDayKey(now)).toBe('2026-11-06');
    expect(startOfVnDay(now).toISOString()).toBe('2026-11-05T17:00:00.000Z');
  });

  it('the two instants around the boundary fall on different VN days', () => {
    expect(vnDayKey(new Date('2026-11-05T16:59:59Z'))).not.toBe(vnDayKey(new Date('2026-11-05T17:00:00Z')));
  });

  it('a 1 ms step across the boundary changes the day key', () => {
    expect(vnDayKey(new Date('2026-11-04T16:59:59.999Z'))).toBe('2026-11-04');
    expect(vnDayKey(new Date('2026-11-04T17:00:00.000Z'))).toBe('2026-11-05');
  });
});
