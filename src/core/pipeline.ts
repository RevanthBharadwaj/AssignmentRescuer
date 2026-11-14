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
import { CorruptFileError, UnsupportedFormatError, extractText } from './input/extractors';
import { sanitiseImportedText } from './security/untrusted';
import { classify } from './classify/classifier';
import { extractEntities, rubricKey, type ExtractionContext } from './extract/entities';
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
  reason: 'unsupported_format' | 'corrupt_file' | 'empty_input';
  message: string;
}

export interface ImportedSource {
  source: SourceDocument;
  classifications: Classification[];
  records: ExtractedRecord[];
}

export interface ImportResult {
  sources: ImportedSource[];
  /** Inputs whose content was already imported earlier (same hash). */
  duplicateInputs: { inputName: string; existingSourceId: string }[];
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
};

export async function runImport(inputs: ImportInput[], deps: PipelineDeps): Promise<ImportResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const result: ImportResult = { sources: [], duplicateInputs: [], errors: [], proposals: [] };
  const seenHashes = new Map(deps.existingSourceHashes);
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
    const prior = seenHashes.get(hash);
    if (prior) {
      result.duplicateInputs.push({ inputName: name, existingSourceId: prior });
      continue;
    }

    let rawText: string;
    try {
      if (format === 'unknown') throw new UnsupportedFormatError(format, `"${name}" is not a recognised or supported file type.`);
      const ex = extractText(format, bytes);
      rawText = ex.text;
    } catch (e) {
      if (e instanceof UnsupportedFormatError) {
        result.errors.push({ inputName: name, format, reason: 'unsupported_format', message: e.message });
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
    const id = `src_${fnv1a(hash)}${fnv1a(importedAt)}`;
    seenHashes.set(hash, id);
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
    } else {
      records = extractEntities(p.source, p.classifications, ctx).records;
    }
    allRecords.push(...records);
    result.sources.push({ source: p.source, classifications: p.classifications, records });
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
