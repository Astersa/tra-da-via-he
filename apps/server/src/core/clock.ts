// STUB (step 1 of M0-E2-T3). Replaced in step 2.
export interface Clock {
  now(): Date;
}

export const CLOCK = 'CLOCK';

export function startOfVnDay(_now: Date): Date {
  throw new Error('not implemented: startOfVnDay');
}

export function vnDayKey(_now: Date): string {
  throw new Error('not implemented: vnDayKey');
}
