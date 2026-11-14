import { describe, expect, it } from 'vitest';
import { byTime, isFinished, unitFinished } from '../src/core/finished';
import type { ConfirmedRecord } from '../src/core/types';

const rec = (title: string, iso: string | null, time: string | null, confirmedAt: string, status?: string): ConfirmedRecord => ({
  id: title, entityType: 'assignment', key: title, unknownFields: [], evidence: [], confirmedAt, updatedAt: confirmedAt,
  fields: { title, status: status ?? null, dueDate: iso ? { iso, month: 0, day: 0, year: 2026, yearSource: 'explicit', time, timeZone: null, raw: iso } : null },
});

describe('time based order and finished work', () => {
  it('orders by date then time, never by the number in the title', () => {
    const d1 = rec('Discussion 1', '2026-11-01', null, '1');
    const d3 = rec('Discussion 3', '2026-11-05', null, '2');
    const d2 = rec('Discussion 2', '2026-11-13', null, '3');
    expect([d2, d1, d3].sort(byTime).map((r) => r.id)).toEqual(['Discussion 1', 'Discussion 3', 'Discussion 2']);
  });
  it('uses the time of day, then the import order, for the same day', () => {
    const late = rec('B', '2026-11-14', '23:59', '1');
    const early = rec('Z', '2026-11-14', '09:00', '2');
    const none1 = rec('M', '2026-11-14', null, '3');
    const none2 = rec('A', '2026-11-14', null, '4');
    expect([none2, none1, late, early].sort(byTime).map((r) => r.id)).toEqual(['Z', 'B', 'M', 'A']);
  });
  it('finished means submitted or past due, and undated work is not finished', () => {
    expect(isFinished(rec('a', '2026-11-13', null, '1'), '2026-11-14')).toBe(true);
    expect(isFinished(rec('a', '2026-11-14', null, '1'), '2026-11-14')).toBe(false);
    expect(isFinished(rec('a', '2026-12-01', null, '1', 'submitted'), '2026-11-14')).toBe(true);
    expect(isFinished(rec('a', null, null, '1'), '2026-11-14')).toBe(false);
  });
  it('a unit is finished when all its graded work is', () => {
    const past = rec('x', '2026-11-01', null, '1');
    const open = rec('y', '2026-12-01', null, '2');
    expect(unitFinished({ graded: [past] }, '2026-11-14')).toBe(true);
    expect(unitFinished({ graded: [past, open] }, '2026-11-14')).toBe(false);
    expect(unitFinished({ graded: [] }, '2026-11-14')).toBe(false);
  });
});
