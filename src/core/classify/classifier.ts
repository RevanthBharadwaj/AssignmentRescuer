import type { Classification, ContentLabel } from '../types';

/**
 * Deterministic multi label classifier. Each label has weighted cue
 * patterns; a label is assigned when its score reaches the threshold.
 * One input can carry several labels (a syllabus usually also holds a
 * course timeline, rubric and semester information).
 */

interface Cue {
  re: RegExp;
  weight: number;
}

const CUES: Record<ContentLabel, Cue[]> = {
  semester_information: [
    { re: /\b(spring|summer|fall|winter)\s+(semester|term|\d{4})\b/i, weight: 2 },
    { re: /\b(semester|term)\s+(begins|starts|ends|start date|end date)\b/i, weight: 3 },
    { re: /\b(classes|instruction)\s+(begin|end)\b/i, weight: 2 },
    { re: /\b(spring|fall|thanksgiving|winter)\s+break\b/i, weight: 2 },
    { re: /\bacademic\s+calendar\b/i, weight: 3 },
  ],
  course_information: [
    { re: /\b[A-Z]{2,4}\s?-?\d{3,4}[A-Z]?\b/, weight: 2 },
    { re: /\b(instructor|professor|office hours|course description|credit hours)\b/i, weight: 2 },
    { re: /\bcourse\s+(title|name|code|number)\b/i, weight: 2 },
  ],
  course_timeline: [
    { re: /\b(week|unit|module)\s+\d+\b/i, weight: 2 },
    { re: /\b(course\s+)?(schedule|calendar|timeline)\b/i, weight: 2 },
  ],
  syllabus: [
    { re: /\bsyllabus\b/i, weight: 4 },
    { re: /\b(grading\s+(policy|scale)|late\s+(work|policy)|academic\s+integrity|learning\s+outcomes|course\s+objectives|required\s+text(book)?s?)\b/i, weight: 2 },
  ],
  announcement: [
    { re: /\bannouncement\b/i, weight: 3 },
    { re: /\b(hi|hello|dear)\s+(class|everyone|students|all)\b/i, weight: 2 },
    { re: /\b(reminder|update|change|has been (moved|extended|changed)|new due date)\b/i, weight: 1 },
  ],
  assignment_instructions: [
    { re: /\b(instructions|directions|requirements|prompt|deliverables?)\s*:/i, weight: 3 },
    { re: /\b(write|submit|prepare|develop|create)\s+(a|an|your)\b/i, weight: 2 },
    { re: /\b\d[\d,]*\s*(-|–|to)?\s*\d*[\d,]*\s*words\b/i, weight: 2 },
    { re: /\b(assignment|essay|paper|report)\b/i, weight: 1 },
  ],
  grading_rubric: [
    { re: /\brubric\b/i, weight: 4 },
    { re: /\b(criteria|criterion)\b/i, weight: 2 },
    { re: /\b(exemplary|proficient|developing|beginning|exceeds|meets|unsatisfactory)\b/i, weight: 1 },
    { re: /\b\d+\s*(points|pts)\b/i, weight: 1 },
  ],
  discussion_question: [
    { re: /\bdiscussion\s*(board|forum|question|post|prompt)?\b/i, weight: 3 },
    { re: /\binitial\s+post\b/i, weight: 3 },
  ],
  peer_reply_instructions: [
    { re: /\b(reply|respond)\s+to\s+(at\s+least\s+)?(\w+\s+)?(peers?|classmates?|other students)\b/i, weight: 4 },
    { re: /\bpeer\s+(replies|reply|responses?)\b/i, weight: 4 },
  ],
  reading_schedule: [
    { re: /\b(read|reading|readings)\b/i, weight: 2 },
    { re: /\b(chapter|ch\.)\s*\d+/i, weight: 2 },
    { re: /\bpp?\.\s*\d+/i, weight: 1 },
  ],
  lecture_material: [
    { re: /\blecture\b/i, weight: 3 },
    { re: /\b(slides?|today we will|in this lecture|learning objectives)\b/i, weight: 1 },
  ],
  textbook_content: [
    { re: /\b(chapter\s+\d+\s+summary|key\s+terms|review\s+questions|end of chapter)\b/i, weight: 3 },
    { re: /\bISBN\b/, weight: 2 },
  ],
  research_article: [
    { re: /\babstract\b/i, weight: 2 },
    { re: /\b(doi:|https?:\/\/doi\.org\/|10\.\d{4,9}\/\S+)/i, weight: 3 },
    { re: /\b(methodology|literature review|participants|results|discussion|references)\b/i, weight: 1 },
    { re: /\bjournal\s+of\b/i, weight: 2 },
  ],
  academic_deadline: [
    { re: /\b(due|deadline|submit\s+by|no later than)\b/i, weight: 3 },
  ],
  project_requirements: [
    { re: /\b(project|capstone|milestone|deliverable)\b/i, weight: 2 },
    { re: /\b(phase|proposal|final\s+report|prototype)\b/i, weight: 1 },
  ],
  statistical_dataset: [
    { re: /\b(dataset|data\s+set|variables?|n\s*=\s*\d+|mean|median|standard deviation|regression|p\s*[<=]\s*\.?\d)\b/i, weight: 2 },
    { re: /^([^,\n]+,){3,}[^,\n]+$/m, weight: 2 },
  ],
};

const THRESHOLD = 3;

export function classify(text: string): Classification[] {
  const out: Classification[] = [];
  for (const [label, cues] of Object.entries(CUES) as [ContentLabel, Cue[]][]) {
    let score = 0;
    const evidence: string[] = [];
    for (const cue of cues) {
      const global = new RegExp(cue.re.source, cue.re.flags.includes('g') ? cue.re.flags : cue.re.flags + 'g');
      const matches = text.match(global);
      if (matches && matches.length > 0) {
        // Diminishing returns so one repeated word cannot dominate.
        score += cue.weight * Math.min(matches.length, 3);
        evidence.push(matches[0].trim());
      }
    }
    if (score >= THRESHOLD) out.push({ label, score, evidence: [...new Set(evidence)].slice(0, 5) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function hasLabel(cls: Classification[], label: ContentLabel): boolean {
  return cls.some((c) => c.label === label);
}
