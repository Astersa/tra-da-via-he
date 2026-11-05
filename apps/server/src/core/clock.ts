export interface Clock {
  now(): Date;
}

export const CLOCK = 'CLOCK';

export const systemClock: Clock = { now: () => new Date() };

// Vietnam is a fixed UTC+7 with no daylight saving, so plain arithmetic is exact.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Instant of 00:00 Vietnam time on the VN day that contains `now`.
export function startOfVnDay(now: Date): Date {
  const shifted = now.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}

// Vietnam calendar day as yyyy-mm-dd.
export function vnDayKey(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}
