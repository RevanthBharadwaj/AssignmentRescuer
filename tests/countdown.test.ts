import { describe, expect, it } from 'vitest';
import { DEFAULT_COUNTDOWN, clean, formatRemaining, nextDeadline } from '../src/core/countdown';

describe('countdown', () => {
  it('counts to Saturday 11:59 PM from a Saturday morning', () => {
    const t = nextDeadline(new Date(2026, 10, 14, 12, 0), DEFAULT_COUNTDOWN)!;
    expect([t.getDay(), t.getDate(), t.getHours(), t.getMinutes()]).toEqual([6, 14, 23, 59]);
  });
  it('moves to Wednesday after Saturday 11:59 PM has passed', () => {
    const t = nextDeadline(new Date(2026, 10, 14, 23, 59, 30), DEFAULT_COUNTDOWN)!;
    expect([t.getDay(), t.getDate()]).toEqual([3, 18]);
  });
  it('is null when switched off', () => {
    expect(nextDeadline(new Date(), { ...DEFAULT_COUNTDOWN, enabled: false })).toBeNull();
  });
  it('formats the time left', () => {
    expect(formatRemaining(((26 * 60) + 5) * 60_000)).toBe('1d 2h 05m');
    expect(formatRemaining(((2 * 60) + 3) * 60_000 + 9000)).toBe('2h 03m 09s');
    expect(formatRemaining(75_000)).toBe('1m 15s');
  });
  it('cleans bad settings', () => {
    expect(clean({ days: [9], time: 'x' } as never)).toEqual(DEFAULT_COUNTDOWN);
  });
});
