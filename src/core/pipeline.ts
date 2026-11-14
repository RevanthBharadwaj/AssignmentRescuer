import type {
  ChangeProposal,
  Classification,
  ConfirmedRecord,
  EntityType,
  ExtractedRecord,
  FieldValue,
  ImportHints,
  InputFormat,
  SourceDocument,
} from './types';
import { detectFormat } from './input/formatDetection';
import { CorruptFileError, NeedsOcrError, UnsupportedFormatError, extractText } from './input/extractors';
import { sanitiseImportedText } from './security/untrusted';
import { classify } from './classify/classifier';
import { extractEntities, rubricKey, termCodeToSemester, type ExtractionContext } from './extract/entities';
import { looksLikeModuleList, parseModuleList } from './extract/canvas';
import { icsToRecords } from './extract/ics';
import { focusAnnouncement } from './announcements';
import { sourceKind } from './courseContent';
import { approximateTermWindow } from './extract/dates';
import { proposeChanges } from './merge/merge';
import { fnv1a, newId, normaliseCourseCode, normaliseKey, sha256Hex } from './util';

/**
 * Unified import pipeline:
 * format detection → text extraction → sanitising → classification →
 * entity extraction → course/semester association → duplicate and
 * conflict detection → proposals for student review.
 *
 * The pipeline is pure: it returns what it found and never writes.
 */

export type ImportInput =
  | { kind: 'text'; text: string; label?: string; hints?: ImportHints }
  | { kind: 'file'; name: string; bytes: Uint8Array; hints?: ImportHints }
  | { kind: 'manual'; entityType: EntityType; fields: Record<string, FieldValue>; hints?: ImportHints };

export interface ImportError {
  inputName: string;
  format: InputFormat;
  reason: 'unsupported_format' | 'corrupt_file' | 'empty_input' | 'needs_ocr';
  message: string;
}

export interface ImportedSource {
  source: SourceDocument;
  classifications: Classification[];
  records: ExtractedRecord[];
}

export interface ImportResult {
  sources: ImportedSource[];
  /**
   * Inputs whose content was imported before. Content from an earlier
   * import is read again (the course, semester or parser may have changed)
   * and produces proposals as usual; an exact repeat within one import is
   * skipped.
   */
  duplicateInputs: { inputName: string; existingSourceId: string; reprocessed: boolean }[];
  errors: ImportError[];
  proposals: ChangeProposal[];
}

export interface PipelineDeps {
  existingSourceHashes: Map<string, string>; // hash -> source id
  confirmedRecords: ConfirmedRecord[];
  context: ExtractionContext;
  now?: () => string;
}

const MANUAL_KEYS: Record<EntityType, (f: Record<string, FieldValue>) => string> = {
  university: (f) => normaliseKey(String(f.name ?? '')),
  semester: (f) => normaliseKey(String(f.name ?? '')),
  academic_break: (f) => `${normaliseKey(String(f.semester ?? ''))}|${normaliseKey(String(f.name ?? ''))}`,
  course: (f) => normaliseCourseCode(String(f.code ?? '')),
  assignment: (f) => `${f.courseCode ? normaliseCourseCode(String(f.courseCode)) : '-'}|${normaliseKey(String(f.title ?? ''))}`,
  rubric_criterion: (f) => `${f.courseCode ? normaliseCourseCode(String(f.courseCode)) : '-'}|${normaliseKey(String(f.criterion ?? ''))}`,
  timeline_event: (f) => `${f.courseCode ? normaliseCourseCode(String(f.courseCode)) : '-'}|${String(f.kind ?? 'due')}|${normaliseKey(String(f.title ?? ''))}`,
  research_source: (f) => String(f.doi ?? f.title ?? '').toLowerCase(),
  ai_note: (f) => String(f.key ?? f.title ?? ''),
  course_material: (f) => `${f.courseCode ? normaliseCourseCode(String(f.courseCode)) : '-'}|material|${normaliseKey(`${f.unit ?? ''} ${f.title ?? ''}`)}`,
};

export async function runImport(inputs: ImportInput[], deps: PipelineDeps): Promise<ImportResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const result: ImportResult = { sources: [], duplicateInputs: [], errors: [], proposals: [] };
  const batchHashes = new Map<string, string>();
  const encoder = new TextEncoder();

  // Extract semester context first so dates without a year can resolve
  // against a semester found anywhere in this batch.
  const ctx: ExtractionContext = { ...deps.context };

  const pending: { source: SourceDocument; manual?: { entityType: EntityType; fields: Record<string, FieldValue> } }[] = [];

  for (const input of inputs) {
    const importedAt = now();
    if (input.kind === 'manual') {
      const text = JSON.stringify({ entityType: input.entityType, fields: input.fields });
      const bytes = encoder.encode(text);
      pending.push({
        source: {
          id: newId('src'), sourceType: 'manual_entry', format: 'manual', originalName: 'Manual entry',
          importedAt, contentHash: await sha256Hex(bytes), text, byteSize: bytes.length,
          hints: input.hints ?? {}, securityFlags: [],
        },
        manual: { entityType: input.entityType, fields: input.fields },
      });
      continue;
    }

    const name = input.kind === 'file' ? input.name : input.label ?? 'Pasted text';
    const bytes = input.kind === 'file' ? input.bytes : encoder.encode(input.text);
    const format: InputFormat = input.kind === 'text' ? 'plain_text' : detectFormat(input.name, bytes);

    if (bytes.length === 0 || (input.kind === 'text' && input.text.trim() === '')) {
      result.errors.push({ inputName: name, format, reason: 'empty_input', message: 'Nothing to import: the input is empty.' });
      continue;
    }

    const hash = await sha256Hex(bytes);
    const inThisBatch = batchHashes.has(hash);
    const earlier = deps.existingSourceHashes.get(hash) ?? null;
    if (inThisBatch) {
      result.duplicateInputs.push({ inputName: name, existingSourceId: batchHashes.get(hash) as string, reprocessed: false });
      continue;
    }

    let rawText: string;
    let pageOffsets: number[] | null = null;
    try {
      if (format === 'unknown') throw new UnsupportedFormatError(format, `"${name}" is not a recognised or supported file type.`);
      const ex = await extractText(format, bytes);
      rawText = ex.text;
      pageOffsets = ex.pageOffsets;
    } catch (e) {
      if (e instanceof UnsupportedFormatError) {
        result.errors.push({ inputName: name, format, reason: 'unsupported_format', message: e.message });
        continue;
      }
      if (e instanceof NeedsOcrError) {
        result.errors.push({ inputName: name, format, reason: 'needs_ocr', message: `"${name}": ${e.message}` });
        continue;
      }
      if (e instanceof CorruptFileError) {
        result.errors.push({ inputName: name, format, reason: 'corrupt_file', message: `"${name}" could not be read: ${e.message}` });
        continue;
      }
      throw e;
    }

    const { text, flags } = sanitiseImportedText(rawText);
    if (text.trim() === '') {
      result.errors.push({ inputName: name, format, reason: 'empty_input', message: `"${name}" contains no readable text.` });
      continue;
    }
    const id = earlier ?? `src_${fnv1a(hash)}${fnv1a(importedAt)}`;
    batchHashes.set(hash, id);
    if (earlier) result.duplicateInputs.push({ inputName: name, existingSourceId: earlier, reprocessed: true });
    pending.push({
      source: {
        id,
        sourceType: input.kind === 'file' ? 'file' : 'pasted_text',
        format,
        originalName: name,
        importedAt,
        contentHash: hash,
        text,
        byteSize: bytes.length,
        hints: input.hints ?? {},
        securityFlags: flags,
        pageOffsets,
      },
    });
  }

  // Pass A: find a semester window anywhere in the batch.
  const classified = pending.map((p) => ({ ...p, classifications: p.manual ? [] : classify(p.source.text) }));
  if (!ctx.semesterStart || !ctx.semesterEnd) {
    for (const p of classified) {
      if (p.manual) {
        if (p.manual.entityType === 'semester') {
          const s = p.manual.fields.startDate as { iso?: string } | null;
          const e = p.manual.fields.endDate as { iso?: string } | null;
          ctx.semesterStart ??= s?.iso ?? null;
          ctx.semesterEnd ??= e?.iso ?? null;
        }
        continue;
      }
      const { semesterWindow } = extractEntities(p.source, p.classifications, {});
      ctx.semesterStart ??= semesterWindow.start;
      ctx.semesterEnd ??= semesterWindow.end;
      if (ctx.semesterStart && ctx.semesterEnd) break;
    }
  }

  // Still no dates: a term name ("Fall 2026", "2026FA") places month and day.
  if (!ctx.semesterStart || !ctx.semesterEnd) {
    const named = ctx.semesterName
      ?? classified.map((p) => p.source.hints.semester ?? termCodeToSemester(p.source.text.slice(0, 2000))).find(Boolean)
      ?? null;
    const approx = approximateTermWindow(named);
    if (approx) Object.assign(ctx, approx);
  }

  // Pass B: full extraction with the shared context.
  const allRecords: ExtractedRecord[] = [];
  for (const p of classified) {
    let records: ExtractedRecord[];
    if (p.manual) {
      const key = MANUAL_KEYS[p.manual.entityType](p.manual.fields);
      const fields = { ...p.manual.fields };
      if (typeof fields.courseCode === 'string') fields.courseCode = normaliseCourseCode(fields.courseCode);
      if (p.manual.entityType === 'course' && typeof fields.code === 'string') fields.code = normaliseCourseCode(fields.code);
      records = [{
        id: `rec_${fnv1a(`${p.source.id}|${key}`)}`,
        entityType: p.manual.entityType,
        key,
        fields,
        unknownFields: Object.entries(fields).filter(([, v]) => v === null).map(([k]) => k),
        flags: [],
        provenance: {
          sourceId: p.source.id, sourceType: 'manual_entry', originalName: 'Manual entry', importedAt: p.source.importedAt,
          page: null, imageRegion: null, textLocation: null, excerpt: 'Entered by the student',
          extractionMethod: 'manual_entry', verificationStatus: 'verified', confirmationStatus: 'pending',
        },
      }];
    } else if (p.source.format === 'ics' || /^\s*BEGIN:VCALENDAR/.test(p.source.text)) {
      records = icsToRecords(p.source, {
        timeZone: ctx.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        knownCourses: ctx.knownCourses ?? [],
        onlyCourse: p.source.hints.course ?? null,
      });
    } else if (looksLikeModuleList(p.source.text)) {
      const hinted = p.source.hints.course ?? ctx.defaultCourseCode ?? null;
      records = parseModuleList(p.source, ctx, hinted ? normaliseCourseCode(hinted) : null);
    } else {
      records = extractEntities(p.source, p.classifications, ctx).records;
    }
    allRecords.push(...records);
    result.sources.push({ source: p.source, classifications: p.classifications, records });
  }

  // Announcements only update work the student already has.
  // Work found in the other material of this same import counts as existing too.
  const isAnn = (s: (typeof result.sources)[number]) => s.source.sourceType !== 'manual_entry' && sourceKind({ ...s.source, classifications: s.classifications }) === 'announcement';
  const known: ConfirmedRecord[] = [
    ...deps.confirmedRecords,
    ...result.sources.filter((s) => !isAnn(s)).flatMap((s) => s.records).map((r) => ({
      id: `pending_${r.key}`, entityType: r.entityType, key: r.key, fields: r.fields, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '',
    }) as ConfirmedRecord),
  ];
  for (const s of result.sources) {
    if (isAnn(s)) s.records = focusAnnouncement(s.records, known);
  }
  allRecords.splice(0, allRecords.length, ...result.sources.flatMap((s) => s.records));

  // Remember which course the student added each item to, so the item is
  // reviewed there even when its text names a different course.
  for (const s of result.sources) {
    const into = s.source.hints.course ? normaliseCourseCode(s.source.hints.course) : null;
    if (into) for (const r of s.records) r.provenance.importedInto = into;
  }
  linkRubricsToAssignments(allRecords, deps.confirmedRecords);
  result.proposals = proposeChanges(allRecords, deps.confirmedRecords, now());
  return result;
}

function titleTokens(s: string): Set<string> {
  const stop = new Set(['the', 'a', 'an', 'on', 'of', 'in', 'for', 'and', 'to', 'assignment', 'rubric', 'grading']);
  return new Set(normaliseKey(s).split(' ').filter((t) => t.length > 1 && !stop.has(t)));
}

/**
 * Attach rubric criteria to the assignment they grade, using the rubric
 * heading ("Grading Rubric: Literature Review") and assignment titles from
 * this import or from confirmed records. Only an unambiguous match links.
 */
export function linkRubricsToAssignments(records: ExtractedRecord[], confirmed: ConfirmedRecord[]): void {
  const assignments = [
    ...records.filter((r) => r.entityType === 'assignment'),
    ...confirmed.filter((r) => r.entityType === 'assignment'),
  ];
  for (const r of records) {
    if (r.entityType !== 'rubric_criterion' || r.fields.assignmentKey) continue;
    const heading = r.fields.assignmentTitle;
    if (typeof heading !== 'string' || !heading) continue;
    const ht = titleTokens(heading);
    const matches = assignments.filter((a) => {
      const at = titleTokens(String(a.fields.title ?? ''));
      if (ht.size === 0) return false;
      let hit = 0;
      for (const t of ht) if (at.has(t)) hit++;
      return hit === ht.size;
    });
    const unique = [...new Map(matches.map((m) => [m.key, m])).values()];
    if (unique.length !== 1) continue;
    const a = unique[0];
    const course = (a.fields.courseCode as string | null) ?? (r.fields.courseCode as string | null);
    r.fields.assignmentKey = a.key;
    r.fields.courseCode = course;
    r.key = rubricKey(course, String(a.fields.title), String(r.fields.criterion));
    r.flags = r.flags.filter((f) => f !== 'course_unassigned');
    r.unknownFields = r.unknownFields.filter((f) => f !== 'assignmentKey' && (f !== 'courseCode' || !course));
  }
}
