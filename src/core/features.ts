import type { InputFormat } from './types';

/**
 * Single source of truth for what the app can actually do. The UI renders
 * this list so students can see implemented, experimental and unavailable
 * features. A feature moves to `implemented` only when its full workflow
 * has automated tests.
 */

export type FeatureStatus = 'implemented' | 'experimental' | 'unavailable';

export interface Feature {
  id: string;
  name: string;
  status: FeatureStatus;
  milestone: number;
  note: string;
}

export const FEATURES: Feature[] = [
  { id: 'input.plain_text', name: 'Paste plain text', status: 'implemented', milestone: 1, note: 'Assignment instructions, timelines, syllabus text, announcements, rubrics.' },
  { id: 'input.txt', name: 'TXT files', status: 'implemented', milestone: 1, note: 'UTF-8 text files.' },
  { id: 'input.markdown', name: 'Markdown files', status: 'implemented', milestone: 1, note: 'Markup is stripped, text is kept.' },
  { id: 'input.manual', name: 'Manual entry', status: 'implemented', milestone: 1, note: 'Courses, semester dates, assignments, readings, milestones.' },
  { id: 'input.multiple', name: 'Multiple inputs in one import', status: 'implemented', milestone: 1, note: 'Pasted text plus several text files in one batch.' },
  { id: 'input.lms_modules', name: 'Canvas Modules page (copied text)', status: 'implemented', milestone: 1, note: 'Select all on the Modules page, copy, paste into a course. Items, dates, points, readings and files are separated.' },
  { id: 'app.setup', name: 'Semester setup with real fields', status: 'implemented', milestone: 1, note: 'School, semester dates and courses are typed once and saved straight away.' },
  { id: 'input.course_list', name: 'Canvas course list', status: 'implemented', milestone: 1, note: 'Paste Courses → All Courses into setup; codes, names, sections and the term are read.' },
  { id: 'writing.title_page', name: 'Title page in your paper format', status: 'experimental', milestone: 1, note: 'APA 7 student title page filled from setup and the course. Preview and copy; Word export comes with the writing milestone.' },
  { id: 'app.course_pages', name: 'Course pages', status: 'implemented', milestone: 1, note: 'Timeline, assignments, readings and materials, and add material with review inside the course.' },
  { id: 'pipeline.classification', name: 'Content classification', status: 'experimental', milestone: 1, note: 'Rule based multi label classifier. Accuracy evaluation is milestone 11.' },
  { id: 'pipeline.extraction', name: 'Academic entity extraction', status: 'experimental', milestone: 1, note: 'Deterministic parsing of dates, courses, assignments, rubrics and timelines from text.' },
  { id: 'pipeline.provenance', name: 'Source provenance', status: 'implemented', milestone: 1, note: 'Every record keeps source, line, excerpt and method.' },
  { id: 'pipeline.review', name: 'Student review and approval', status: 'implemented', milestone: 1, note: 'Nothing is saved without approval. Conflicts show old and new values.' },
  { id: 'pipeline.duplicates', name: 'Duplicate and conflict detection', status: 'implemented', milestone: 1, note: 'Duplicates, changed deadlines and changed requirements.' },
  { id: 'onboarding.semester', name: 'Semester onboarding', status: 'implemented', milestone: 1, note: 'Resumable. Answers can come from imported material.' },
  { id: 'reminders.next_semester', name: 'Next semester subject reminders', status: 'implemented', milestone: 1, note: 'Deterministic, 14 days before semester end, repeats every 14 days.' },
  { id: 'reminders.deadlines', name: 'Deadline reminder schedule', status: 'experimental', milestone: 1, note: 'Schedule is computed. Shown in app while open only.' },
  { id: 'notifications.closed_app', name: 'Notifications while the app is closed', status: 'unavailable', milestone: 10, note: 'Needs background scheduling; not built or tested.' },
  { id: 'input.pdf', name: 'PDF files', status: 'unavailable', milestone: 2, note: 'Planned.' },
  { id: 'input.docx', name: 'DOCX files', status: 'unavailable', milestone: 2, note: 'Planned.' },
  { id: 'input.doc', name: 'DOC files', status: 'unavailable', milestone: 2, note: 'Planned.' },
  { id: 'input.rtf', name: 'RTF files', status: 'unavailable', milestone: 2, note: 'Planned where supported.' },
  { id: 'input.images', name: 'Screenshots and photos (OCR)', status: 'unavailable', milestone: 3, note: 'PNG, JPEG, WebP, HEIC planned.' },
  { id: 'input.csv', name: 'CSV files', status: 'unavailable', milestone: 4, note: 'Planned.' },
  { id: 'input.xlsx', name: 'XLSX files', status: 'unavailable', milestone: 4, note: 'Planned.' },
  { id: 'input.json', name: 'JSON files', status: 'unavailable', milestone: 4, note: 'Planned.' },
  { id: 'input.ics', name: 'Calendar files (ICS)', status: 'unavailable', milestone: 4, note: 'Planned.' },
  { id: 'timeline.merge', name: 'Unified academic timeline', status: 'unavailable', milestone: 8, note: 'Record level merging works now; the timeline view is planned.' },
  { id: 'calendar.views', name: 'Calendar views', status: 'unavailable', milestone: 9, note: 'Monthly, weekly, daily, course timelines.' },
  { id: 'agents.ai', name: 'AI agents (research, writing, APA, originality, statistics)', status: 'unavailable', milestone: 11, note: 'No AI calls are made in this build.' },
  { id: 'input.audio_video', name: 'Lecture audio and video', status: 'unavailable', milestone: 99, note: 'Future extension.' },
  { id: 'input.lms', name: 'LMS, email and cloud integrations', status: 'unavailable', milestone: 99, note: 'Future extension.' },
];

const FORMAT_FEATURE: Partial<Record<InputFormat, string>> = {
  plain_text: 'input.plain_text',
  txt: 'input.txt',
  markdown: 'input.markdown',
  manual: 'input.manual',
  pdf: 'input.pdf',
  docx: 'input.docx',
  doc: 'input.doc',
  rtf: 'input.rtf',
  png: 'input.images',
  jpeg: 'input.images',
  webp: 'input.images',
  heic: 'input.images',
  csv: 'input.csv',
  xlsx: 'input.xlsx',
  json: 'input.json',
  ics: 'input.ics',
};

export function featureStatus(id: string): FeatureStatus {
  return FEATURES.find((f) => f.id === id)?.status ?? 'unavailable';
}

export function isFormatImplemented(format: InputFormat): boolean {
  const id = FORMAT_FEATURE[format];
  return id ? featureStatus(id) === 'implemented' : false;
}
