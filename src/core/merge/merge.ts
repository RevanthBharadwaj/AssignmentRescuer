import type {
  AcademicDate,
  ChangeProposal,
  ConfirmedRecord,
  ExtractedRecord,
  FieldChange,
  FieldValue,
  Provenance,
} from '../types';
import { newId, normaliseKey } from '../util';

/**
 * Duplicate and conflict detection. Nothing here writes data: the output is
 * a list of proposals the student must approve. Conflicting values are
 * never overwritten silently; each proposal lists old and new values.
 */

function isDate(v: FieldValue): v is AcademicDate {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'month' in v && 'day' in v;
}

function isKnown(v: FieldValue): boolean {
  return !(v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === '');
}

/** Compare two field values; a date without a year matches the same month and day. */
export function valuesEqual(a: FieldValue, b: FieldValue): boolean {
  if (isDate(a) && isDate(b)) {
    const sameDay = a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
    const sameTime = a.time === null || b.time === null || a.time === b.time;
    const sameTz = a.timeZone === null || b.timeZone === null || a.timeZone === b.timeZone;
    return sameDay && sameTime && sameTz;
  }
  if (typeof a === 'string' && typeof b === 'string') return normaliseKey(a) === normaliseKey(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Fields that are bookkeeping rather than student facing content. */
const IGNORED_FIELDS = new Set(['instructions', 'citationText', 'excerpt']);

export function diffFields(
  oldFields: Record<string, FieldValue>,
  newFields: Record<string, FieldValue>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, newValue] of Object.entries(newFields)) {
    if (!isKnown(newValue)) continue; // an unknown never erases a known value
    const oldValue = oldFields[field] ?? null;
    if (isKnown(oldValue) && valuesEqual(oldValue, newValue)) continue;
    if (IGNORED_FIELDS.has(field) && isKnown(oldValue)) {
      if (normaliseKey(String(oldValue)) === normaliseKey(String(newValue))) continue;
    }
    changes.push({ field, oldValue, newValue });
  }
  return changes;
}

function tokens(s: string): Set<string> {
  return new Set(normaliseKey(s).split(' ').filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Exact key match first. For assignments and events, fall back to a fuzzy
 * match: same course, similar title and same date. This catches the same
 * assignment typed slightly differently in a syllabus and in Canvas text.
 */
export function findMatch<T extends { entityType: string; key: string; fields: Record<string, FieldValue> }>(
  candidate: ExtractedRecord,
  pool: T[],
): T | null {
  const exact = pool.find((r) => r.entityType === candidate.entityType && r.key === candidate.key);
  if (exact) return exact;
  if (candidate.entityType !== 'assignment' && candidate.entityType !== 'timeline_event') return null;
  const title = String(candidate.fields.title ?? '');
  const course = candidate.fields.courseCode ?? null;
  const date = (candidate.fields.dueDate ?? candidate.fields.date ?? null) as FieldValue;
  for (const r of pool) {
    if (r.entityType !== candidate.entityType) continue;
    if ((r.fields.courseCode ?? null) !== course) continue;
    const rDate = (r.fields.dueDate ?? r.fields.date ?? null) as FieldValue;
    const sim = jaccard(tokens(title), tokens(String(r.fields.title ?? '')));
    if (sim >= 0.75) return r;
    if (sim >= 0.5 && isKnown(date) && isKnown(rDate) && valuesEqual(date, rDate)) return r;
  }
  return null;
}

function mergeCompatible(a: ExtractedRecord, b: ExtractedRecord): ExtractedRecord {
  const fields = { ...a.fields };
  for (const [k, v] of Object.entries(b.fields)) if (!isKnown(fields[k] ?? null) && isKnown(v)) fields[k] = v;
  return {
    ...a,
    fields,
    unknownFields: Object.entries(fields).filter(([, v]) => !isKnown(v)).map(([k]) => k),
    flags: [...new Set([...a.flags, ...b.flags])],
  };
}

export function proposeChanges(
  candidates: ExtractedRecord[],
  confirmed: ConfirmedRecord[],
  now: string = new Date().toISOString(),
): ChangeProposal[] {
  // 1. Group candidates in this import that describe the same thing.
  const groups: { lead: ExtractedRecord; members: ExtractedRecord[] }[] = [];
  for (const c of candidates) {
    const g = groups.find((x) => findMatch(c, [x.lead]) !== null);
    if (g) g.members.push(c);
    else groups.push({ lead: c, members: [c] });
  }

  const proposals: ChangeProposal[] = [];
  for (const g of groups) {
    // 2. Resolve disagreements between sources in the same import.
    let lead = g.members[0];
    const internalChanges: FieldChange[] = [];
    for (const other of g.members.slice(1)) {
      const disagreements = diffFields(lead.fields, other.fields).filter((ch) => isKnown(ch.oldValue));
      if (disagreements.length > 0) internalChanges.push(...disagreements);
      else lead = mergeCompatible(lead, other);
    }
    const alternatives = g.members.filter((m) => m !== g.members[0]);

    if (internalChanges.length > 0) {
      proposals.push({
        id: newId('prop'),
        kind: 'conflict',
        entityType: lead.entityType,
        key: lead.key,
        targetRecordId: null,
        candidate: lead,
        alternatives,
        changes: internalChanges,
        status: 'pending',
        createdAt: now,
      });
      continue;
    }

    // 3. Compare with confirmed records.
    const match = findMatch(lead, confirmed);
    if (!match) {
      proposals.push({
        id: newId('prop'), kind: 'create', entityType: lead.entityType, key: lead.key,
        targetRecordId: null, candidate: lead, alternatives, changes: [], status: 'pending', createdAt: now,
      });
      continue;
    }
    const changes = diffFields(match.fields, lead.fields);
    proposals.push({
      id: newId('prop'),
      kind: changes.length === 0 ? 'duplicate' : 'update',
      entityType: lead.entityType,
      key: match.key,
      targetRecordId: match.id,
      candidate: lead,
      alternatives,
      changes,
      status: 'pending',
      createdAt: now,
    });
  }
  return proposals;
}

export type Resolution = Record<string, 'old' | 'new'>;

/**
 * Apply an approved proposal. Returns the new or updated confirmed record.
 * For conflicts and updates the student picks a value per changed field;
 * the default keeps the newer source's value.
 */
export function applyProposal(
  proposal: ChangeProposal,
  existing: ConfirmedRecord | null,
  resolution: Resolution = {},
  now: string = new Date().toISOString(),
): ConfirmedRecord {
  const confirmedProv = (p: Provenance): Provenance => ({ ...p, confirmationStatus: 'confirmed' });
  const evidence = [proposal.candidate, ...proposal.alternatives].map((r) => confirmedProv(r.provenance));

  const base: Record<string, FieldValue> = existing ? { ...existing.fields } : { ...proposal.candidate.fields };
  if (existing) {
    for (const [k, v] of Object.entries(proposal.candidate.fields)) {
      if (!isKnown(base[k] ?? null) && isKnown(v)) base[k] = v;
    }
  }
  for (const ch of proposal.changes) {
    const choice = resolution[ch.field] ?? 'new';
    base[ch.field] = choice === 'new' ? ch.newValue : ch.oldValue;
  }

  return {
    id: existing?.id ?? newId('rec'),
    entityType: proposal.entityType,
    key: existing?.key ?? proposal.key,
    fields: base,
    unknownFields: Object.entries(base).filter(([, v]) => !isKnown(v)).map(([k]) => k),
    evidence: [...(existing?.evidence ?? []), ...evidence],
    confirmedAt: existing?.confirmedAt ?? now,
    updatedAt: now,
  };
}
