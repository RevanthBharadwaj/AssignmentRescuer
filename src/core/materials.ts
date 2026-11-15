import type { ConfirmedRecord } from './types';
import type { CourseSource } from './courseContent';

/**
 * A course works like a project: it holds every file you added (the textbook chapters, articles, lecture PDFs),
 * and each file can be attached to any number of assignments, each time with its own note about which part
 * matters ("Chapters 1 and 2" for the Unit 2 discussion, "Chapters 5 and 6" for the Unit 5 one).
 */
export interface MaterialLink {
  sourceId: string;
  /** The assignment's key, which stays the same when the course page is imported again. */
  assignmentKey: string;
  /** Free text: chapters, pages, a section. */
  note: string;
}

export interface Attachment { source: CourseSource; note: string }

export function attachmentsFor(assignment: ConfirmedRecord, links: MaterialLink[], sources: CourseSource[]): Attachment[] {
  const out: Attachment[] = [];
  for (const l of links) {
    if (l.assignmentKey !== assignment.key) continue;
    const source = sources.find((s) => s.id === l.sourceId);
    if (source) out.push({ source, note: l.note });
  }
  return out;
}

/** Where a file is used: every assignment it is attached to, with the note for that assignment. */
export function usedIn(sourceId: string, links: MaterialLink[], assignments: ConfirmedRecord[]): { assignment: ConfirmedRecord; note: string }[] {
  const out: { assignment: ConfirmedRecord; note: string }[] = [];
  for (const l of links) {
    if (l.sourceId !== sourceId) continue;
    const assignment = assignments.find((a) => a.key === l.assignmentKey);
    if (assignment) out.push({ assignment, note: l.note });
  }
  return out;
}

/** "pages 10 to 20", "pp. 10-20" or "page 7": the page range in a note, when it gives one. */
export function pageRange(note: string): [number, number] | null {
  const m = /\bpp?(?:ages?|\.)?\s*(\d{1,4})\s*(?:-|–|to|through)\s*(\d{1,4})\b/i.exec(note) ?? /\bpp?(?:ages?|\.)?\s*(\d{1,4})\b/i.exec(note);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return a <= b ? [a, b] : [b, a];
}

/** The text of an attachment: only the pages the note names when the file has page marks, else the whole file. */
export function attachmentText(a: Attachment): string {
  const range = pageRange(a.note);
  const offs = a.source.pageOffsets;
  if (!range || !offs?.length) return a.source.text;
  const from = offs[Math.min(range[0], offs.length) - 1] ?? 0;
  const to = range[1] >= offs.length ? a.source.text.length : offs[range[1]] ?? a.source.text.length;
  return a.source.text.slice(from, to) || a.source.text;
}
