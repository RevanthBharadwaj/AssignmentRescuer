import type { ConfirmedRecord, ExtractedRecord } from './types';
import { normaliseKey } from './util';

/**
 * An announcement is a message about existing work, not a source of new
 * work. When one is imported, the only items kept are dated references to
 * assignments the student already has ("Discussion Question 1 · November
 * 14" in Unit 5 → "Unit 5: Discussion Question 1"); headings, course and
 * semester mentions and anything unmatched are dropped. Matches carry the
 * existing record's key and title, so a different date shows as a change.
 */

export function matchExistingAssignment(
  candidate: ExtractedRecord,
  existing: ConfirmedRecord[],
): ConfirmedRecord | null {
  const course = candidate.fields.courseCode ?? null;
  const pool = existing.filter((r) => r.entityType === 'assignment' && (course === null || r.fields.courseCode === course));
  const exact = pool.find((r) => r.key === candidate.key);
  if (exact) return exact;

  const title = normaliseKey(String(candidate.fields.title ?? ''));
  if (title.length < 3) return null;
  const unit = candidate.fields.unit ? normaliseKey(String(candidate.fields.unit)) : null;

  // "Discussion Question 1" in Unit 5 → "Unit 5: Discussion Question 1".
  if (unit) {
    const composed = `${unit} ${title}`;
    const hit = pool.find((r) => normaliseKey(String(r.fields.title ?? '')) === composed);
    if (hit) return hit;
  }
  const endsWith = pool.filter((r) => {
    const t = normaliseKey(String(r.fields.title ?? ''));
    return t === title || t.endsWith(` ${title}`);
  });
  const sameUnit = unit ? endsWith.filter((r) => normaliseKey(String(r.fields.unit ?? '')) === unit) : endsWith;
  if (sameUnit.length === 1) return sameUnit[0];
  if (!unit && endsWith.length === 1) return endsWith[0];
  return null;
}

export function focusAnnouncement(records: ExtractedRecord[], confirmed: ConfirmedRecord[]): ExtractedRecord[] {
  const out: ExtractedRecord[] = [];
  const used = new Set<string>();
  for (const r of records) {
    if (r.entityType !== 'assignment' && r.entityType !== 'timeline_event') continue;
    const date = r.fields.dueDate ?? r.fields.date ?? null;
    if (!date) continue;
    const match = matchExistingAssignment({ ...r, fields: { ...r.fields, title: r.fields.title } }, confirmed);
    if (!match || used.has(match.id)) continue;
    used.add(match.id);
    out.push({
      ...r,
      entityType: 'assignment',
      key: match.key,
      fields: { title: match.fields.title ?? null, courseCode: match.fields.courseCode ?? null, unit: match.fields.unit ?? null, dueDate: date },
      unknownFields: [],
      flags: r.flags.filter((f) => f === 'missing_year' || f === 'ambiguous_time_zone' || f === 'possible_prompt_injection'),
    });
  }
  return out;
}
