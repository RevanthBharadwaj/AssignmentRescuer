import type { Classification, ConfirmedRecord, SourceDocument } from './types';
import { looksLikeModuleList } from './extract/canvas';
import { findDates } from './extract/dates';
import { normaliseCourseCode, normaliseKey } from './util';
import { attachmentsFor, type MaterialLink } from './materials';

/**
 * Course content model: what kind of material each imported source is,
 * how a syllabus divides into sections and policies, and which pieces of
 * course material give context to a given assignment. Deterministic, so
 * every piece of context can be traced to its source.
 */

export const MATERIAL_KINDS = ['syllabus', 'announcement', 'modules', 'instructions', 'rubric', 'policy', 'reading', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  syllabus: 'Syllabus',
  announcement: 'Announcement',
  modules: 'Modules page',
  instructions: 'Assignment instructions',
  rubric: 'Rubric',
  policy: 'Course policies and rules',
  reading: 'Reading or lecture',
  other: 'Other',
};

export type CourseSource = SourceDocument & { classifications: Classification[] };

/** The student's choice wins; otherwise infer from the text. */
export function sourceKind(source: CourseSource): MaterialKind {
  const chosen = source.hints.material as MaterialKind | undefined;
  if (chosen && MATERIAL_KINDS.includes(chosen)) return chosen;
  if (looksLikeModuleList(source.text)) return 'modules';
  const labels = new Map(source.classifications.map((c) => [c.label, c.score]));
  const top = source.classifications[0]?.label;
  if (labels.has('syllabus')) return 'syllabus';
  if (top === 'announcement') return 'announcement';
  if (top === 'grading_rubric') return 'rubric';
  if (top && ['assignment_instructions', 'discussion_question', 'peer_reply_instructions', 'project_requirements'].includes(top)) return 'instructions';
  if (top && ['lecture_material', 'textbook_content', 'research_article', 'reading_schedule'].includes(top)) return 'reading';
  if (top && ['course_timeline', 'semester_information', 'course_information', 'academic_deadline'].includes(top)) return 'syllabus';
  return 'other';
}

/** Sources that belong to a course: added to it, or the origin of its records. */
export function sourcesForCourse(code: string, sources: CourseSource[], records: ConfirmedRecord[]): CourseSource[] {
  const fromRecords = new Set(
    records.filter((r) => r.fields.courseCode === code || r.key === code).flatMap((r) => r.evidence.map((e) => e.sourceId)),
  );
  return sources.filter((s) => (s.hints.course && normaliseCourseCode(s.hints.course) === code) || fromRecords.has(s.id));
}

/* ---------- sections ---------- */

export interface Section {
  heading: string;
  body: string;
  /** 1 based line where the heading is. */
  line: number;
  topics: PolicyTopic[];
}

export type PolicyTopic = 'late' | 'integrity' | 'ai' | 'format' | 'grading' | 'participation' | 'communication' | 'accessibility' | 'attendance' | 'submission';

const TOPICS: [PolicyTopic, RegExp][] = [
  ['late', /\blate\b|extension|make[- ]?up|missed (work|deadline)/i],
  ['integrity', /integrity|plagiari|honou?r code|cheating|original work|turnitin/i],
  ['ai', /\bAI\b|artificial intelligence|generative|chatgpt|large language/i],
  ['format', /\bAPA\b|\bMLA\b|format|citation|writing (standard|style|guideline)|style guide|font|double[- ]spaced/i],
  ['grading', /grading|grade scale|grades\b|evaluation|weighting|points distribution|rubric/i],
  ['participation', /participation|discussion (board|expectation|guideline|post)|netiquette|peer repl/i],
  ['communication', /communication|email|office hours|contact|response time/i],
  ['accessibility', /accessib|accommodation|disabilit/i],
  ['attendance', /attendance|absence/i],
  ['submission', /submission|submit|upload|file type/i],
];

export function topicsOf(text: string): PolicyTopic[] {
  return TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t);
}

const POLICY_HEADING = /polic|integrity|plagiari|late|attendance|participation|grading|grade|expectation|netiquette|artificial intelligence|\bAI\b|generative|format|\bAPA\b|writing|submission|rules|principles|conduct|accommodation|accessib|honou?r|communication|turnitin|citation/i;

function isHeading(line: string, next: string | undefined): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/[.,;]$/.test(t) || /^[-*•]/.test(t)) return false;
  if (findDates(t).length > 0 && t.length > 20) return false;
  const words = t.replace(/:$/, '').split(/\s+/);
  if (words.length > 9) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  if (t.endsWith(':') && words.length <= 7) return true;
  const caps = words.filter((w) => /^[A-Z0-9(&]/.test(w) || /^(and|or|of|the|for|in|on|to|a|an|with)$/.test(w)).length;
  // Title Case line followed by body text.
  return caps / words.length >= 0.8 && words.length >= 1 && !!next && next.trim().length > t.length;
}

/** Split a document into sections by its headings. */
export function splitSections(text: string): Section[] {
  const lines = text.split('\n');
  const out: Section[] = [];
  let cur: { heading: string; line: number; body: string[] } | null = null;
  lines.forEach((raw, i) => {
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (isHeading(raw, next)) {
      if (cur) out.push({ heading: cur.heading, line: cur.line, body: cur.body.join('\n').trim(), topics: [] });
      cur = { heading: raw.trim().replace(/^#+\s*/, '').replace(/:$/, ''), line: i + 1, body: [] };
    } else if (cur) {
      cur.body.push(raw);
    } else if (raw.trim()) {
      // Text before the first heading: its first line names the document.
      cur = { heading: raw.trim().slice(0, 80), line: i + 1, body: [] };
    }
  });
  if (cur) {
    const c = cur as { heading: string; line: number; body: string[] };
    out.push({ heading: c.heading, line: c.line, body: c.body.join('\n').trim(), topics: [] });
  }
  return out.map((s) => ({ ...s, topics: topicsOf(`${s.heading}\n${s.body}`) }));
}

/** Sections that state course rules: policies, expectations, formatting, integrity. */
export function policySections(source: CourseSource): Section[] {
  const kind = sourceKind(source);
  const sections = splitSections(source.text).filter((s) => s.body.length > 0);
  if (kind === 'policy') return sections;
  return sections.filter((s) => POLICY_HEADING.test(s.heading));
}

/* ---------- announcements ---------- */

export interface Announcement {
  source: CourseSource;
  title: string;
  date: string; // YYYY-MM-DD, from the text when stated, else the import date
  body: string;
}

export function toAnnouncement(source: CourseSource): Announcement {
  const lines = source.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = (lines[0] ?? 'Announcement').replace(/^announcement\s*[:\-–]\s*/i, '').slice(0, 120);
  const stated = findDates(lines.slice(0, 3).join(' ')).find((d) => d.date.iso)?.date.iso;
  return { source, title, date: stated ?? source.importedAt.slice(0, 10), body: lines.slice(1).join('\n') };
}

/* ---------- assignment context ---------- */

function numbers(s: string): string {
  return (normaliseKey(s).match(/\d+/g) ?? []).join(' ');
}

const TYPE_WORDS = ['discussion', 'writing', 'written', 'essay', 'paper', 'project', 'quiz', 'exam', 'reflection', 'presentation', 'lab', 'homework', 'case study', 'draft'];

/** Does this text talk about this assignment? Title match, or same numbers plus the same kind of work in one sentence. */
export function mentionsAssignment(text: string, assignment: ConfirmedRecord): boolean {
  const title = String(assignment.fields.title ?? '');
  const nt = normaliseKey(title);
  const body = normaliseKey(text);
  if (nt.length > 6 && body.includes(nt)) return true;
  const nums = numbers(title);
  const words = TYPE_WORDS.filter((w) => nt.includes(w));
  if (!nums || words.length === 0) {
    // "Major Project: Presenting Leadership Theories" → match on the distinctive part after the colon.
    const tail = normaliseKey(title.split(':').slice(1).join(':'));
    return tail.length > 12 && body.includes(tail);
  }
  return text.split(/(?<=[.!?])\s+|\n/).some((sentence) => {
    const ns = normaliseKey(sentence);
    return numbers(sentence).includes(nums) && words.some((w) => ns.includes(w));
  });
}

export interface ContextItem {
  kind: 'instructions' | 'policy' | 'announcement' | 'reading' | 'note';
  title: string;
  body: string;
  sourceName: string;
  sourceId: string;
  location: string | null;
  topics?: PolicyTopic[];
  recordId?: string;
}

const RELEVANT: Record<string, PolicyTopic[]> = {
  discussion: ['participation', 'late', 'grading', 'ai', 'integrity'],
  peer_reply: ['participation', 'late', 'grading'],
  quiz: ['integrity', 'late', 'grading'],
  exam: ['integrity', 'late', 'grading', 'attendance'],
};
const DEFAULT_RELEVANT: PolicyTopic[] = ['format', 'integrity', 'ai', 'late', 'grading', 'submission'];

export interface AssignmentContext {
  instructions: ContextItem[];
  rubric: ConfirmedRecord[];
  policies: ContextItem[];
  announcements: ContextItem[];
  readings: ContextItem[];
}

export function buildAssignmentContext(assignment: ConfirmedRecord, records: ConfirmedRecord[], sources: CourseSource[], links: MaterialLink[] = []): AssignmentContext {
  const code = String(assignment.fields.courseCode ?? '');
  const mine = sourcesForCourse(code, sources, records);
  const evidenceIds = new Set(assignment.evidence.map((e) => e.sourceId));

  const instructions: ContextItem[] = [];
  for (const s of mine.filter((x) => sourceKind(x) === 'instructions')) {
    const linked = s.hints.assignmentKey === assignment.key || evidenceIds.has(s.id) || mentionsAssignment(s.text.slice(0, 600), assignment);
    if (linked) instructions.push({ kind: 'instructions', title: s.originalName, body: s.text, sourceName: s.originalName, sourceId: s.id, location: null });
  }

  const wanted = RELEVANT[String(assignment.fields.type)] ?? DEFAULT_RELEVANT;
  const policies: ContextItem[] = [];
  for (const s of mine.filter((x) => ['syllabus', 'policy'].includes(sourceKind(x)))) {
    for (const sec of policySections(s)) {
      const score = sec.topics.filter((t) => wanted.includes(t)).length;
      if (score === 0 && sourceKind(s) !== 'policy') continue;
      policies.push({ kind: 'policy', title: sec.heading, body: sec.body, sourceName: s.originalName, sourceId: s.id, location: `line ${sec.line}`, topics: sec.topics });
    }
  }
  // Most important rule for this kind of work first (for a paper: formatting,
  // then integrity, AI, late work), then sections that touch more of them.
  // A topic named in the heading counts more than one mentioned in passing.
  const best = (ts: PolicyTopic[]) => Math.min(...ts.map((t) => wanted.indexOf(t)).filter((i) => i >= 0), 99);
  const rank = (p: ContextItem) => {
    const h = best(topicsOf(p.title));
    return h < 99 ? h : 20 + best(p.topics ?? []);
  };
  const hits = (p: ContextItem) => (p.topics ?? []).filter((t) => wanted.includes(t)).length;
  policies.sort((a, b) => rank(a) - rank(b) || hits(b) - hits(a));

  const announcements = mine
    .filter((s) => sourceKind(s) === 'announcement' && mentionsAssignment(s.text, assignment))
    .map((s) => toAnnouncement(s))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((a) => ({ kind: 'announcement' as const, title: a.title, body: a.body, sourceName: a.source.originalName, sourceId: a.source.id, location: a.date }));

  const unit = assignment.fields.unit;
  const readings: ContextItem[] = records
    .filter((r) => r.entityType === 'course_material' && r.fields.courseCode === code)
    .filter((r) => (unit && r.fields.unit === unit) || (r.fields.kind === 'note' && mentionsAssignment(String(r.fields.title), assignment)))
    .map((r) => ({
      kind: r.fields.kind === 'note' ? 'note' as const : 'reading' as const,
      title: String(r.fields.title),
      body: String(r.fields.kind ?? ''),
      sourceName: r.evidence[0]?.originalName ?? '',
      sourceId: r.evidence[0]?.sourceId ?? '',
      location: r.evidence[0]?.textLocation ? `line ${r.evidence[0].textLocation.line}` : null,
      recordId: r.id,
    }));

  // Files attached to this assignment by hand come first, each with its own note ("Chapters 1 and 2").
  const attached: ContextItem[] = attachmentsFor(assignment, links, sources).map((a) => ({
    kind: 'reading' as const, title: `${a.source.originalName}${a.note ? `: ${a.note}` : ''}`, body: a.note, sourceName: a.source.originalName, sourceId: a.source.id, location: a.note || null,
  }));
  const rubric = records.filter((r) => r.entityType === 'rubric_criterion' && r.fields.assignmentKey === assignment.key);
  return { instructions, rubric, policies, announcements, readings: [...attached, ...readings] };
}
