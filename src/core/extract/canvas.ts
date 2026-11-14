import type { AssignmentType, ExtractedRecord, FieldValue, ReviewFlag, SourceDocument } from '../types';
import { findDates, type DateContext } from './dates';
import { fnv1a, normaliseKey } from '../util';

/**
 * Parser for text copied from an LMS module list (Canvas "Modules" page and
 * similar). In that layout every item spans several lines:
 *
 *   Discussion Topic                 <- item type
 *   Unit 2: Discussion Question 1    <- title
 *   Oct 24                           <- due date (optional)
 *   20 pts                           <- points (optional)
 *   ViewedModule item has been ...   <- completion status (noise)
 *
 * Modules ("UNIT 2", "COURSE EVALUATION") and section labels
 * ("READING ASSIGNMENT", "LECTURE") give context to the items below them.
 */

const ITEM_TYPES = new Map<string, string>([
  ['page', 'page'],
  ['discussion topic', 'discussion'],
  ['discussion', 'discussion'],
  ['assignment', 'assignment'],
  ['quiz', 'quiz'],
  ['attachment', 'file'],
  ['file', 'file'],
  ['external url', 'link'],
  ['external tool', 'tool'],
  ['wiki page', 'page'],
]);

const NOISE = [
  /^context module sub header$/i,
  /^(marked done|mark done|viewed|view|submit|submitted|contribute|score at least|must )/i,
  /module item (has been|marked|must)/i,
  /^complete (all|one) items?$/i,
  /^module (in progress|completed|locked|not started)$/i,
  /^prerequisites?:/i,
  /^(not started|in progress|completed|locked)$/i,
];

const MODULE_RE = /^(unit|week|module|lesson|topic)\s+(\d+)\b\s*[:\-–]?\s*(.*)$/i;
const POINTS_RE = /^(\d+(?:\.\d+)?)\s*(pts?|points?)$/i;
const REMINDER_RE = /^(reminder|note|announcement)\s*:\s*(.+)$/i;

const MARKERS = [/context module sub header/i, /module item (has been|marked|must)/i, /^complete all items$/im, /^module (in progress|completed|locked)$/im, /^discussion topic$/im];

/** True when the text looks like a copied LMS module list. */
export function looksLikeModuleList(text: string): boolean {
  let hits = 0;
  for (const m of MARKERS) {
    const g = new RegExp(m.source, m.flags.includes('g') ? m.flags : m.flags + 'g');
    hits += Math.min((text.match(g) ?? []).length, 5);
  }
  return hits >= 6;
}

const isNoise = (s: string) => NOISE.some((re) => re.test(s));
const isAllCaps = (s: string) =>
  /[A-Z]{2}/.test(s) && s === s.toUpperCase() && s.length <= 60 && !POINTS_RE.test(s) && findDates(s).length === 0;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function assignmentTypeFor(kind: string, title: string, section: string | null): AssignmentType {
  const t = `${title} ${section ?? ''}`.toLowerCase();
  if (kind === 'quiz') return /exam|midterm|final exam|test/.test(t) ? 'exam' : 'quiz';
  if (kind === 'discussion') return /repl(y|ies)|peer/.test(t) ? 'peer_reply' : 'discussion';
  if (/final paper|research paper|paper/.test(t)) return 'paper';
  if (/writing|written|essay/.test(t)) return 'essay';
  if (/project|capstone/.test(t)) return 'project';
  if (/presentation/.test(t)) return 'presentation';
  if (/reflection|journal/.test(t)) return 'reflection';
  if (/report/.test(t)) return 'report';
  if (/lab\b/.test(t)) return 'lab';
  if (/homework|problem set/.test(t)) return 'homework';
  return 'assignment';
}

interface Line {
  no: number;
  text: string;
  start: number;
  end: number;
}

export function parseModuleList(
  source: SourceDocument,
  ctx: DateContext,
  courseCode: string | null,
): ExtractedRecord[] {
  const lines: Line[] = [];
  let offset = 0;
  source.text.split('\n').forEach((raw, i) => {
    lines.push({ no: i + 1, text: raw.trim(), start: offset, end: offset + raw.length });
    offset += raw.length + 1;
  });
  const content = lines.filter((l) => l.text && !isNoise(l.text));

  const records: ExtractedRecord[] = [];
  const injection = new Set(source.securityFlags.filter((f) => f.line !== null).map((f) => f.line as number));
  const course = courseCode;
  const courseKey = course ?? '-';

  const push = (entityType: ExtractedRecord['entityType'], key: string, fields: Record<string, FieldValue>, at: Line[], flags: ReviewFlag[] = []) => {
    const first = at[0];
    const last = at[at.length - 1];
    const f = new Set(flags);
    if (!course) f.add('course_unassigned');
    if (at.some((l) => injection.has(l.no))) f.add('possible_prompt_injection');
    records.push({
      id: `rec_${fnv1a(`${source.id}|${entityType}|${key}|${first.no}`)}`,
      entityType,
      key,
      fields,
      unknownFields: Object.entries(fields).filter(([, v]) => v === null || (Array.isArray(v) && v.length === 0)).map(([k]) => k),
      flags: [...f],
      provenance: {
        sourceId: source.id,
        sourceType: source.sourceType,
        originalName: source.originalName,
        importedAt: source.importedAt,
        page: null,
        imageRegion: null,
        textLocation: { line: first.no, start: first.start, end: last.end },
        excerpt: at.map((l) => l.text).join('\n').slice(0, 300),
        extractionMethod: 'deterministic_text',
        verificationStatus: 'unverified',
        confirmationStatus: 'pending',
      },
    });
  };

  let module: string | null = null;
  let section: string | null = null;
  const seen = new Set<string>();

  for (let i = 0; i < content.length; i++) {
    const line = content[i];
    const text = line.text;
    const next = content[i + 1]?.text ?? '';

    // Module header: Canvas prints the module name twice in a row.
    const mod = MODULE_RE.exec(text);
    if ((next === text && isAllCaps(text)) || (mod && isAllCaps(text))) {
      module = mod ? `${titleCase(mod[1])} ${mod[2]}` : titleCase(text);
      section = null;
      if (next === text) i++;
      continue;
    }

    const kind = ITEM_TYPES.get(text.toLowerCase());
    if (kind && content[i + 1]) {
      const titleLine = content[i + 1];
      const title = titleLine.text;
      const block = [line, titleLine];
      let j = i + 2;
      let due = null as ReturnType<typeof findDates>[number]['date'] | null;
      let points: number | null = null;
      // Date and points follow the title on their own lines.
      for (; j < content.length && j <= i + 4; j++) {
        const t = content[j].text;
        const ds = findDates(t, ctx);
        const pm = POINTS_RE.exec(t);
        if (!due && ds.length === 1 && ds[0].start <= 4 && t.length <= ds[0].end - ds[0].start + 8) {
          due = ds[0].date;
          block.push(content[j]);
        } else if (points === null && pm) {
          points = Number(pm[1]);
          block.push(content[j]);
        } else break;
      }
      i = j - 1;

      const unit = MODULE_RE.exec(title) ? `${titleCase(MODULE_RE.exec(title)![1])} ${MODULE_RE.exec(title)![2]}` : module && MODULE_RE.test(module) ? module : null;
      const sec = section ?? null;

      if (kind === 'file' || kind === 'link' || kind === 'tool' || (kind === 'page' && !due)) {
        let mkind = kind === 'page' ? 'page' : kind;
        if (kind === 'page' && /read/i.test(`${sec ?? ''} ${title}`)) mkind = 'reading';
        else if (kind === 'page' && /lecture/i.test(`${sec ?? ''} ${title}`)) mkind = 'lecture';
        else if (kind === 'file' && sec && /read/i.test(sec)) mkind = 'reading_file';
        const key = `${courseKey}|material|${normaliseKey(`${unit ?? module ?? ''} ${title}`)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        push('course_material', key, { title, kind: mkind, courseCode: course, unit: unit ?? module, section: sec ? titleCase(sec) : null }, block);
        continue;
      }

      if (kind === 'discussion' && !due && points === null) {
        // Standing forums such as "Questions for the Professor".
        const key = `${courseKey}|material|${normaliseKey(title)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        push('course_material', key, { title, kind: 'forum', courseCode: course, unit: unit ?? module, section: null }, block);
        continue;
      }

      const type = assignmentTypeFor(kind, title, sec);
      const key = `${courseKey}|${normaliseKey(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const flags: ReviewFlag[] = [];
      if (!due) flags.push('missing_date');
      else if (due.year === null) flags.push('missing_year');
      push('assignment', key, {
        title,
        type,
        courseCode: course,
        unit: unit ?? module,
        dueDate: due,
        availableDate: null,
        pointsPossible: points,
        dueNote: null,
      }, block, flags);
      continue;
    }

    const rem = REMINDER_RE.exec(text);
    if (rem) {
      const body = rem[2].trim();
      // Projects named only in reminders still need to be on the radar.
      const pm = /(?:^|next week\s*:?\s*)((?:final\s+|major\s+)?project(?:\s+\d+)?\s*:\s*[^.]+?)(?:\s+(?:is\s+)?due\s+(.+?))?\.?$/i.exec(body);
      if (pm) {
        const title = pm[1].replace(/\s*[-–]\s*rough draft.*$/i, '').trim();
        const when = pm[2] ?? (/next week/i.test(body) ? 'next week' : null);
        const key = `${courseKey}|${normaliseKey(title)}`;
        if (!seen.has(key)) {
          seen.add(key);
          push('assignment', key, {
            title,
            type: 'project',
            courseCode: course,
            unit: module,
            dueDate: null,
            availableDate: null,
            pointsPossible: null,
            dueNote: when ? `Due ${when}${module ? ` (mentioned in ${module})` : ''}` : body,
          }, [line], ['missing_date']);
        }
      }
      const key = `${courseKey}|note|${normaliseKey(body)}`;
      if (!seen.has(key)) {
        seen.add(key);
        push('course_material', key, { title: body, kind: 'note', courseCode: course, unit: module, section: null }, [line]);
      }
      continue;
    }

    if (isAllCaps(text) && !kind) {
      section = text;
      continue;
    }
  }
  return records;
}
