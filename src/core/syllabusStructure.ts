import { splitSections, topicsOf, type PolicyTopic, type Section } from './courseContent';

/**
 * Turns a syllabus into a tidy structure: groups (overview, grading,
 * materials, schedule, policies, other) holding whole sections. The plain
 * heading splitter treats every short capitalised line as a heading; this
 * keeps only real section headings and folds the rest (table rows, wrapped
 * lines, page numbers, ISBN lines) into the section they belong to.
 */

export type GroupId = 'overview' | 'grading' | 'materials' | 'schedule' | 'policies' | 'other';
export interface StructuredSection { heading: string; body: string; topics: PolicyTopic[]; policy: boolean }
export interface Group { id: GroupId; label: string; hint: string; sections: StructuredSection[] }

const GROUPS: Record<GroupId, { label: string; hint: string }> = {
  overview: { label: 'Course overview', hint: 'What the course is about and what you should be able to do by the end.' },
  grading: { label: 'Grading', hint: 'How points are earned and how they turn into a letter grade.' },
  materials: { label: 'Books and readings', hint: 'Required texts and the articles to read, unit by unit.' },
  schedule: { label: 'Units and assignments', hint: 'What each unit asks you to read, do and submit, and how each assignment is described.' },
  policies: { label: 'Rules and policies', hint: 'Late work, integrity, formatting, participation and similar rules.' },
  other: { label: 'Other', hint: 'Everything else in the document.' },
};

const KNOWN: [GroupId, RegExp][] = [
  ['overview', /^(course )?(description|overview|summary|information|introduction|goals?|objectives?|outcomes?|learning (outcomes|objectives)|student (competencies|learning outcomes)|competencies|prerequisites?|instructor|contact|office hours)\b/i],
  ['grading', /(rubric)|^(assessment( criteria)?|grading( scale| policy| criteria)?|grades?|evaluation|points( distribution)?|assignment points|weighting|grade scale|final grades?)\b/i],
  ['materials', /^(resource inventory|required (texts?|reading|materials?|resources?)|textbooks?|course materials?|recommended (texts?|reading)|(required )?readings?$|unit \d+ articles?|unit \w+ articles?|references|bibliography)\b/i],
  ['schedule', /^(writing assignments|threaded discussion|projects? (in|\d)|project \d|final (paper|project)|welcome message|discussion (format|forum)|unit (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|week (\d+|one|two|three|four|five|six|seven|eight)\b|module \d+|schedule|course (schedule|calendar|outline)|calendar|weekly (schedule|outline))/i],
  ['policies', /polic|integrity|plagiari|late (work|submission)|attendance|participation|netiquette|artificial intelligence|\bAI\b|generative|\bAPA\b|writing (standard|style)|submission|rules|principles|conduct|accommodation|accessib|honou?r|communication|turnitin|citation|technical|disability|title ix|withdraw/i],
];

const UNIT_LINE = /^[ \t\f]*(UNIT|WEEK|MODULE)\s+(\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\b(?!\s+ARTICLES?\b)[ \t]*[:\-–.]?[ \t]*(.*)$/gim;
const UNIT_PART = /^(unit learning objectives|learning objectives|upon completion.*|unit activities|activities|reading assignments?|writing assignments?|discussion( questions?)?|assignments?|resources?|overview|lectures?.*|unit overview|required reading|objectives?)$/i;
const groupOf = (heading: string): GroupId | null => KNOWN.find(([, re]) => re.test(heading.trim()))?.[0] ?? null;
const LOOKS_LIKE_ROW = (h: string) => /\s{3,}/.test(h.trim()) || /^(\(?[a-z0-9]\)|[IVX]+\.|\d+\.)\s/i.test(h.trim());
const isPageNumber = (h: string) => /^\d{1,3}$/.test(h.trim()) || /^page \d+( of \d+)?$/i.test(h.trim());

export function structureSyllabus(text: string): { title: string; groups: Group[] } {
  // Lines such as "UNIT ONE: Market Orientation" start a unit; make that explicit for the splitter.
  const raw = splitSections(text.replace(UNIT_LINE, (_m, w: string, n: string, rest: string) => `# ${w.toUpperCase()} ${n.toUpperCase()}${rest.trim() ? `: ${rest.trim()}` : ''}`));
  const kept: { heading: string; body: string; id: GroupId }[] = [];
  let title = '';
  for (let i = 0; i < raw.length; i++) {
    const s: Section = raw[i];
    if (isPageNumber(s.heading)) {
      if (kept.length) kept[kept.length - 1].body = `${kept[kept.length - 1].body}\n${s.body}`.trim();
      continue;
    }
    if (kept.length && LOOKS_LIKE_ROW(s.heading)) {
      const prev = kept[kept.length - 1];
      prev.body = [prev.body, [s.heading, s.body].filter(Boolean).join('\n')].filter(Boolean).join('\n');
      continue;
    }
    const known = groupOf(s.heading);
    const inUnit = kept.length > 0 && kept[kept.length - 1].id === 'schedule' && UNIT_PART.test(s.heading.trim().replace(/:$/, ''));
    if (inUnit) {
      const prev = kept[kept.length - 1];
      prev.body = [prev.body, [`${s.heading}:`, s.body].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
      continue;
    }
    const substantial = s.body.replace(/\s+/g, ' ').length >= 160;
    if (kept.length === 0) {
      // Everything before the first real heading is the document's title block.
      if (known || substantial) kept.push({ heading: s.heading, body: s.body, id: known ?? 'other' });
      else { title = [title, s.heading, s.body].filter(Boolean).join('\n').trim(); }
      continue;
    }
    if (known || substantial) kept.push({ heading: s.heading, body: s.body, id: known ?? 'other' });
    else {
      // Table rows, wrapped lines and labels belong to the section before.
      const prev = kept[kept.length - 1];
      prev.body = [prev.body, [s.heading, s.body].filter(Boolean).join('\n')].filter(Boolean).join('\n');
    }
  }
  const info = kept.length && title ? [{ heading: 'Course information', body: title, id: 'overview' as GroupId }] : [];
  const all = [...info, ...kept];
  const order: GroupId[] = ['overview', 'grading', 'materials', 'schedule', 'policies', 'other'];
  const groups: Group[] = order.map((id) => ({
    id, ...GROUPS[id],
    sections: all.filter((s) => s.id === id).map((s) => ({ heading: s.heading, body: s.body.trim(), topics: topicsOf(`${s.heading}\n${s.body}`), policy: id === 'policies' })),
  })).filter((g) => g.sections.length > 0);
  // The grading scale reads best next to the points table: merge it into Assessment when both exist.
  const grading = groups.find((g) => g.id === 'grading');
  if (grading && grading.sections.length > 1) {
    const [head, ...rest] = grading.sections;
    grading.sections = [{ ...head, body: [head.body, ...rest.map((r) => (/^grading scale$/i.test(r.heading) || /^grade scale$/i.test(r.heading) ? `${r.heading}:\n${r.body}` : `${r.heading}\n${r.body}`))].join('\n\n').trim() }];
  }
  return { title: title.split('\n')[0] ?? '', groups };
}
