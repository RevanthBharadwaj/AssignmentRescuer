import type { ConfirmedRecord, AcademicDate } from './types';
import { buildAssignmentContext } from './courseContent';
import type { MaterialLink } from './materials';
import type { CourseSource } from './courseContent';
import { matchUnitItem, unitItems, unitReadingLines, unitText, gradeRowFor, type SyllabusFacts } from './syllabus';
import { unitNumber } from './units';
import type { Milestone } from './schedule';
import { prettyDate } from './schedule';

/**
 * The brief is what the student needs on one page before starting: what is
 * required, how it is scored, what to read, and the dates. Every line says
 * where it came from. Nothing is stored twice: the brief is built from the
 * material already saved, so adding the same announcement again changes
 * nothing.
 */

export interface BriefLine {
  text: string;
  source: string | null;
}

export interface BriefBlock {
  id: 'required' | 'scoring' | 'resources' | 'dates';
  title: string;
  lines: BriefLine[];
  /** Shown when the block has nothing, with what to add. */
  empty: string;
}

export interface Brief {
  title: string;
  courseCode: string;
  blocks: BriefBlock[];
}

const fmtDue = (d: AcademicDate | null) => (d?.iso ? prettyDate(d.iso) + (d.time ? ` ${d.time}` : '') : null);

export function buildBrief(
  record: ConfirmedRecord,
  records: ConfirmedRecord[],
  sources: CourseSource[],
  facts: SyllabusFacts | null,
  syllabusText: string | null,
  milestones: Milestone[],
  links: MaterialLink[] = [],
): Brief {
  const f = record.fields;
  const title = String(f.title ?? 'Assignment');
  const code = String(f.courseCode ?? '');
  const unit = unitNumber(f.unit);
  const ctx = buildAssignmentContext(record, records, sources, links);
  const section = unit !== null && syllabusText ? unitText(syllabusText, unit) : null;
  const items = section ? unitItems(section) : [];
  const item = matchUnitItem(title, items);
  const where = unit !== null ? `Syllabus, Unit ${unit}` : 'Syllabus';

  const required: BriefLine[] = [];
  if (item?.prompt) required.push({ text: item.prompt, source: where });
  if (item?.requirements) required.push({ text: `Requirements: ${item.requirements}`, source: where });
  if (typeof f.instructions === 'string' && f.instructions.trim()) required.push({ text: f.instructions.trim(), source: 'Assignment instructions you added' });
  for (const x of ctx.instructions) if (x.body !== f.instructions) required.push({ text: x.body.replace(/\s+/g, ' ').slice(0, 900), source: x.sourceName });
  if (/discussion/i.test(title) && facts) {
    const r = facts.rules;
    if (r.wordMin && r.wordMax) required.push({ text: `First post: ${r.wordMin} to ${r.wordMax} words${r.initialPostDay ? `, before ${r.initialPostTime ?? ''} ${r.initialPostDay}`.replace(/\s+/g, ' ') : ''}.`, source: 'Syllabus, discussion rules' });
    if (r.replies) required.push({ text: `Reply to at least ${r.replies} classmates${r.dueDay ? ` by ${r.dueDay}` : ''}.`, source: 'Syllabus, discussion rules' });
    if (r.referencesRequired) required.push({ text: 'The post and the replies must both contain references.', source: 'Syllabus, discussion rules' });
  } else if (facts?.rules.apa && !/discussion/i.test(title)) {
    required.push({ text: 'APA 7 format with a title page, citations and a reference list.', source: 'Syllabus, writing assignments' });
  }
  for (const a of ctx.announcements.slice(0, 3)) required.push({ text: `Announcement “${a.title}”: ${a.body.replace(/\s+/g, ' ').slice(0, 300)}`, source: a.sourceName });
  for (const p of ctx.policies.filter((x) => x.topics?.includes('format') || x.topics?.includes('integrity')).slice(0, 2)) {
    required.push({ text: `${p.title}: ${p.body.replace(/\s+/g, ' ').slice(0, 300)}`, source: p.sourceName });
  }

  const scoring: BriefLine[] = [];
  const pts = typeof f.pointsPossible === 'number' ? f.pointsPossible : null;
  if (pts !== null) scoring.push({ text: `Worth ${pts} points.`, source: 'Canvas modules' });
  const row = facts ? gradeRowFor(title, facts) : null;
  if (row && facts) {
    scoring.push({
      text: row.each ? `Part of ${row.label}: ${row.count} items at ${row.each} points each, ${row.points} points (${row.percent}% of the course grade).` : `${row.label}: ${row.points} points, ${row.percent}% of the course grade.`,
      source: 'Syllabus, grading',
    });
  } else if (pts !== null && facts?.totalPoints) {
    scoring.push({ text: `That is ${Math.round((pts / facts.totalPoints) * 1000) / 10}% of the ${facts.totalPoints} points in the course.`, source: 'Syllabus, grading' });
  }
  for (const r of ctx.rubric) {
    scoring.push({ text: `${String(r.fields.criterion)}${r.fields.maxPoints !== undefined && r.fields.maxPoints !== null ? ` (${String(r.fields.maxPoints)} pts)` : ''}${r.fields.description ? `: ${String(r.fields.description)}` : ''}`, source: 'Rubric' });
  }
  for (const p of ctx.policies.filter((x) => x.topics?.includes('late') || x.topics?.includes('grading')).slice(0, 2)) {
    scoring.push({ text: `${p.title}: ${p.body.replace(/\s+/g, ' ').slice(0, 260)}`, source: p.sourceName });
  }

  const resources: BriefLine[] = [];
  if (section) for (const l of unitReadingLines(section)) resources.push({ text: l, source: where });
  if (unit !== null && facts?.articles[unit]) for (const a of facts.articles[unit]) resources.push({ text: a.citation + (a.url ? ` (${a.url})` : ''), source: 'Syllabus, unit articles' });
  for (const r of ctx.readings) {
    if (resources.some((x) => x.text.toLowerCase().includes(r.title.toLowerCase().replace(/\.pdf$/, '').slice(0, 24)))) continue;
    resources.push({ text: r.title, source: r.sourceName });
  }
  if (facts?.texts.length) resources.push({ text: `Course texts: ${facts.texts.join('; ')}`, source: 'Syllabus, resource inventory' });

  const dates: BriefLine[] = milestones.filter((m) => m.recordId === record.id).map((m) => ({
    text: `${m.kind === 'initial_post' ? 'First post' : 'Due'} ${prettyDate(m.date)}${m.time ? `, ${m.time}` : ''}${m.timeZone ? ` ${m.timeZone}` : ''}: ${m.action}.`,
    source: m.kind === 'initial_post' ? 'Syllabus, discussion rules' : 'Canvas modules',
  }));
  if (!dates.length && fmtDue(f.dueDate as AcademicDate | null)) dates.push({ text: `Due ${fmtDue(f.dueDate as AcademicDate)}.`, source: 'Canvas modules' });

  return {
    title,
    courseCode: code,
    blocks: [
      { id: 'required', title: 'What is required', lines: required, empty: 'No instructions found yet. Add the syllabus, or paste the assignment page in Chat.' },
      { id: 'scoring', title: 'How it is scored', lines: scoring, empty: 'No scoring information yet. Add the syllabus or the rubric.' },
      { id: 'resources', title: 'What to read and use', lines: resources, empty: 'No readings found yet. Add the Modules page and the syllabus.' },
      { id: 'dates', title: 'Dates to hit', lines: dates, empty: 'No dates yet.' },
    ],
  };
}

/** The brief as plain text, for the chat to use as context. */
export function briefToText(b: Brief): string {
  return b.blocks.map((blk) => `${blk.title.toUpperCase()}\n${blk.lines.length ? blk.lines.map((l) => `- ${l.text}${l.source ? ` [${l.source}]` : ''}`).join('\n') : '- (nothing found)'}`).join('\n\n');
}
