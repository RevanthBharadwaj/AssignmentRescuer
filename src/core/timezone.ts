/**
 * Deadlines are set by the school, so "today" and "11:59 PM" mean school time, wherever the student is.
 * A student in Seattle with a Central time school still sees Central time deadlines.
 */

export const DEFAULT_SCHOOL_ZONE = 'America/Chicago';

export const ZONES: { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern (ET)' },
  { id: 'America/Chicago', label: 'Central (CT)' },
  { id: 'America/Denver', label: 'Mountain (MT)' },
  { id: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { id: 'America/Anchorage', label: 'Alaska (AKT)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { id: 'UTC', label: 'UTC' },
];

export function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export interface ZoneNow {
  /** YYYY-MM-DD in that zone. */
  date: string;
  /** HH:MM, 24 hour, in that zone. */
  time: string;
  /** 0 = Sunday. */
  weekday: number;
  /** A Date whose local fields show the zone's wall clock, for math with the countdown and reminder code. */
  wall: Date;
}

export function zoneNow(tz: string, now: Date = new Date()): ZoneNow {
  const zone = validZone(tz) ? tz : DEFAULT_SCHOOL_ZONE;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = new Date(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'), now.getMilliseconds());
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${g('year')}-${pad(g('month'))}-${pad(g('day'))}`, time: `${pad(g('hour'))}:${pad(g('minute'))}`, weekday: wall.getDay(), wall };
}

/** "CST" or "CDT" for the zone right now. */
export function zoneLabel(tz: string, now: Date = new Date()): string {
  const zone = validZone(tz) ? tz : DEFAULT_SCHOOL_ZONE;
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

/** Whether this device's clock is in a different zone than the school's right now. */
export function deviceDiffers(tz: string, now: Date = new Date()): boolean {
  const here = new Intl.DateTimeFormat('en-US', { timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value;
  const there = new Intl.DateTimeFormat('en-US', { timeZone: validZone(tz) ? tz : DEFAULT_SCHOOL_ZONE, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value;
  return here !== there;
}
