import { findDates, parseTime, resolveYear, addDays } from '../src/core/extract/dates';

describe('date parsing', () => {
  it('parses named month dates with year, time and zone', () => {
    const [m] = findDates('Due Sunday, January 17, 2027 at 11:59 PM ET');
    expect(m.date).toMatchObject({ iso: '2027-01-17', time: '23:59', timeZone: 'ET', yearSource: 'explicit' });
  });

  it('parses abbreviations, ordinals, numeric and ISO forms', () => {
    const ds = findDates('Jan. 5th; 2/14/2027; 2027-03-01 23:59; 3 April 2027');
    expect(ds.map((d) => d.date.iso)).toEqual([null, '2027-02-14', '2027-03-01', '2027-04-03']);
    expect(ds[0].date).toMatchObject({ month: 1, day: 5, year: null, yearSource: 'unknown' });
    expect(ds[2].date.time).toBe('23:59');
  });

  it('marks a missing year as unknown without a semester context', () => {
    const [m] = findDates('Quiz due Oct 3');
    expect(m.date.year).toBeNull();
    expect(m.date.iso).toBeNull();
  });

  it('resolves a missing year from the semester window, including across new year', () => {
    const ctx = { semesterStart: '2026-12-01', semesterEnd: '2027-04-30' };
    expect(findDates('Dec 15', ctx)[0].date).toMatchObject({ iso: '2026-12-15', yearSource: 'semester_context' });
    expect(findDates('Feb 2', ctx)[0].date.iso).toBe('2027-02-02');
    expect(resolveYear(7, 4, ctx)).toBeNull();
  });

  it('rejects impossible dates', () => {
    expect(findDates('February 30, 2027')).toHaveLength(0);
    expect(findDates('13/40/2027')).toHaveLength(0);
  });

  it('handles 12 hour edge cases and words', () => {
    expect(parseTime('12 am')).toBe('00:00');
    expect(parseTime('12:30 p.m.')).toBe('12:30');
    expect(parseTime('noon')).toBe('12:00');
    expect(parseTime('midnight')).toBe('23:59');
    expect(parseTime('13 pm')).toBeNull();
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('records a time without a zone so it can be flagged', () => {
    const [m] = findDates('Final Project due December 9, 2026 at 5:00 PM');
    expect(m.date).toMatchObject({ time: '17:00', timeZone: null });
  });
});
