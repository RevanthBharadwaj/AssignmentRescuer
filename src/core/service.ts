import type { Repository } from '../db/repository';
import type { AcademicDate, ConfirmedRecord } from './types';
import { runImport, type ImportInput, type ImportResult } from './pipeline';
import { onboardingStatus, pickCurrentSemester, type OnboardingStatus } from './onboarding';
import {
  nextSubjectPromptDate,
  shouldPromptForSubjects,
  type SemesterReminderState,
} from './reminders/semesterReminders';
import {
  DEFAULT_OFFSETS,
  DEFAULT_REMIND_AT,
  buildDeadlineReminders,
  type ReminderSettings,
  type ScheduledReminder,
} from './reminders/deadlineReminders';
import type { Resolution } from './merge/merge';
import type { EntityType, FieldValue, Provenance } from './types';
import { DEFAULT_AI, PROVIDER_NAME, aiReady, isCloud, announcementPrompt, assignmentPrompt, parseBriefing, type AiSettings, type Completer } from './ai';
import { buildAssignmentContext, toAnnouncement } from './courseContent';
import { normaliseCourseCode } from './util';
import { parseSyllabus, unitItems, unitText, matchUnitItem, type SyllabusFacts } from './syllabus';
import { buildBrief, briefToText, type Brief } from './brief';
import { prettyDate, prettyTime, milestonesFor, remindersFor, dueReminders, formatDigest, formatEmail, scheduleEmails, DEFAULT_PUSH, type Email, type Milestone, type PushSettings, type Reminder } from './schedule';
import { summariseUnits, type UnitSummary } from './units';
import { parseOverview, syllabusPrompt } from './ai';
import { chunkText, retrieve } from './retrieve';
import { modelFor } from './models';
import { apaText, inText, searchWorks, verifyDoi, type Fetcher, type Work } from './scholar';
import { termMismatch } from './term';
import { dueRange, toolInfo, type ToolCall, type ToolId } from './tools';
import { chatSystem, describeIntake, findCourse, type ChatMessage } from './chat';
import { sourceKind, sourcesForCourse } from './courseContent';
import { addDays } from './extract/dates';

export interface SemesterInput {
  name: string;
  start: AcademicDate | null;
  end: AcademicDate | null;
}

export interface CourseInput {
  code: string;
  name: string | null;
  instructor: string | null;
  section?: string | null;
  url?: string | null;
}

export interface StudentProfile {
  name: string;
}

export interface CalendarFeed {
  url: string;
  lastSyncedAt: string | null;
  lastResult: string | null;
}

export type FeedFetcher = (url: string) => Promise<string>;

export interface FeedSyncResult {
  newItems: number;
  changedItems: number;
  unchanged: number;
  events: number;
}

/** Application service: the only layer the UI talks to. */

export interface NextSemesterSettings {
  subjectsConfirmed: boolean;
  subjects: string[];
  skipping: boolean;
  remindersEnabled: boolean;
  snoozedUntil: string | null;
  lastPromptedOn: string | null;
  /** The current semester these answers belong to; a new semester resets them. */
  forSemesterId: string | null;
}

const DEFAULT_NEXT: NextSemesterSettings = {
  subjectsConfirmed: false, subjects: [], skipping: false, remindersEnabled: true,
  snoozedUntil: null, lastPromptedOn: null, forSemesterId: null,
};

export type RawEmbed = (model: string, baseUrl: string, texts: string[]) => Promise<number[][]>;

export interface ToolResult { id: ToolId; label: string; note: string; text: string; works?: Work[] }

export class AcademicService {
  constructor(private readonly repo: Repository) {}

  async init(): Promise<void> {
    await this.repo.migrate();
  }

  get repository(): Repository {
    return this.repo;
  }

  async import(inputs: ImportInput[]): Promise<ImportResult> {
    const confirmed = await this.repo.listRecords();
    const semester = pickCurrentSemester(confirmed.filter((r) => r.entityType === 'semester'), await this.currentSemesterId());
    const result = await runImport(inputs, {
      existingSourceHashes: await this.repo.sourceHashes(),
      confirmedRecords: confirmed,
      context: {
        semesterStart: (semester?.fields.startDate as AcademicDate | null)?.iso ?? null,
        semesterEnd: (semester?.fields.endDate as AcademicDate | null)?.iso ?? null,
        semesterName: (semester?.fields.name as string | null) ?? null,
        knownCourses: confirmed.filter((r) => r.entityType === 'course').map((c) => ({ code: String(c.fields.code), name: (c.fields.name as string | null) ?? null })),
      },
    });
    await this.repo.saveImport(result);
    return result;
  }

  /**
   * Save something the student typed. Typed input is the student's own
   * statement, so it is confirmed straight away (still with provenance and
   * a change log). An existing record is updated in place.
   */
  async saveTyped(entityType: EntityType, fields: Record<string, FieldValue>, existingId: string | null = null) {
    if (existingId) return this.repo.correctRecord(existingId, fields);
    const r = await this.import([{ kind: 'manual', entityType, fields }]);
    const p = r.proposals[0];
    return this.repo.approveProposal(p.id);
  }

  /* ---------- AI ---------- */

  async aiSettings(): Promise<AiSettings> {
    return { ...DEFAULT_AI, ...(await this.repo.getSetting<Partial<AiSettings>>('ai', {})) };
  }

  async saveAiSettings(s: AiSettings): Promise<void> {
    await this.repo.setSetting('ai', s);
  }

  private async runAi(complete: Completer, req: { system: string; prompt: string }): Promise<{ text: string; settings: AiSettings }> {
    const s = await this.aiSettings();
    if (!aiReady(s)) {
      throw new Error(isCloud(s.provider) && !s.cloudConsent
        ? `Agree to send material to ${PROVIDER_NAME[s.provider]} in Semester setup → AI assistant first.`
        : 'Turn on the AI assistant in Semester setup first.');
    }
    const text = await complete({ provider: s.provider, model: s.model, system: req.system, prompt: req.prompt, baseUrl: s.provider === 'ollama' ? s.ollamaUrl : undefined });
    return { text, settings: s };
  }

  private aiProvenance(sourceId: string, name: string, s: AiSettings, now: string): Provenance {
    return {
      sourceId, sourceType: 'pasted_text', originalName: name, importedAt: now, page: null, imageRegion: null, textLocation: null,
      excerpt: `Generated by ${s.provider === 'ollama' ? `${s.model} on this computer` : s.model}`,
      extractionMethod: 'ai_model', verificationStatus: 'unverified', confirmationStatus: 'confirmed',
    };
  }

  /** Read an announcement with AI and save what it asks for, linked to the assignments it mentions. */
  async analyzeAnnouncement(sourceId: string, complete: Completer, now = new Date().toISOString()) {
    const source = (await this.repo.listSources()).find((x) => x.id === sourceId);
    if (!source) throw new Error('That announcement no longer exists.');
    const code = source.hints.course ?? '';
    const assignments = (await this.repo.listRecords('assignment')).filter((a) => a.fields.courseCode === code);
    const { text, settings } = await this.runAi(complete, announcementPrompt(source.text, code, assignments));
    const b = parseBriefing(text, assignments);
    const title = toAnnouncement(source).title;
    return this.repo.saveGenerated({
      entityType: 'ai_note',
      key: `${code}|ai|announcement|${sourceId}`,
      fields: {
        kind: 'announcement', title: `About “${title}”`, courseCode: code, sourceId,
        summary: b.summary, actions: b.actions.map((a) => JSON.stringify(a)), cautions: b.cautions, assignmentKeys: b.assignmentKeys,
        provider: settings.provider, model: settings.model, createdAt: now,
      },
      unknownFields: [],
      evidence: [this.aiProvenance(sourceId, source.originalName, settings, now)],
    }, now);
  }

  /** Read a syllabus with AI: a short summary, the key facts, and the rules that are easy to miss. */
  async organizeSyllabus(sourceId: string, complete: Completer, now = new Date().toISOString()) {
    const source = (await this.repo.listSources()).find((x) => x.id === sourceId);
    if (!source) throw new Error('That syllabus no longer exists.');
    const code = source.hints.course ?? '';
    const { text, settings } = await this.runAi(complete, syllabusPrompt(source.text, code));
    const o = parseOverview(text);
    return this.repo.saveGenerated({
      entityType: 'ai_note',
      key: `${code}|ai|syllabus|${sourceId}`,
      fields: {
        kind: 'syllabus', title: 'Syllabus at a glance', courseCode: code, sourceId,
        summary: o.summary, actions: o.facts.map((f) => JSON.stringify({ text: `${f.label}: ${f.value}`, due: null, assignmentKey: null })), cautions: o.cautions, assignmentKeys: [],
        provider: settings.provider, model: settings.model, createdAt: now,
      },
      unknownFields: [],
      evidence: [this.aiProvenance(sourceId, source.originalName, settings, now)],
    }, now);
  }

  /** Make a plan for one assignment from everything the course says about it. */
  async analyzeAssignment(recordId: string, complete: Completer, now = new Date().toISOString()) {
    const records = await this.repo.listRecords();
    const a = records.find((r) => r.id === recordId);
    if (!a) throw new Error('That assignment no longer exists.');
    const code = String(a.fields.courseCode ?? '');
    const sources = await this.repo.listSources();
    const ctx = buildAssignmentContext(a, records, sources);
    const material = [
      `ASSIGNMENT: ${String(a.fields.title)}${(a.fields.dueDate as AcademicDate | null)?.iso ? `, due ${(a.fields.dueDate as AcademicDate).iso}` : ''}${typeof a.fields.pointsPossible === 'number' ? `, ${a.fields.pointsPossible} points` : ''}`,
      typeof a.fields.instructions === 'string' ? `INSTRUCTIONS:\n${a.fields.instructions}` : '',
      ...ctx.instructions.map((x) => `INSTRUCTIONS (${x.sourceName}):\n${x.body}`),
      ctx.rubric.length ? `RUBRIC:\n${ctx.rubric.map((r) => `- ${String(r.fields.criterion)} (${String(r.fields.maxPoints ?? '?')} pts): ${String(r.fields.description ?? '')}`).join('\n')}` : '',
      ...ctx.announcements.map((x) => `ANNOUNCEMENT ${x.location ?? ''}: ${x.title}\n${x.body}`),
      ...ctx.policies.slice(0, 8).map((x) => `COURSE RULE: ${x.title}\n${x.body}`),
      ctx.readings.length ? `READINGS FOR THIS UNIT:\n${ctx.readings.map((r) => `- ${r.title}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const assignments = records.filter((r) => r.entityType === 'assignment' && r.fields.courseCode === code);
    const { text, settings } = await this.runAi(complete, assignmentPrompt(a, material, assignments));
    const b = parseBriefing(text, assignments);
    const keys = [...new Set([a.key, ...b.assignmentKeys])];
    return this.repo.saveGenerated({
      entityType: 'ai_note',
      key: `${code}|ai|assignment|${a.key}`,
      fields: {
        kind: 'assignment', title: `Plan for ${String(a.fields.title)}`, courseCode: code, sourceId: null,
        summary: b.summary, actions: b.actions.map((x) => JSON.stringify({ ...x, assignmentKey: x.assignmentKey ?? a.key })), cautions: b.cautions, assignmentKeys: keys,
        provider: settings.provider, model: settings.model, createdAt: now,
      },
      unknownFields: [],
      evidence: [this.aiProvenance(a.evidence[0]?.sourceId ?? 'none', String(a.fields.title), settings, now)],
    }, now);
  }

  /** Keep a verified source, as an APA reference, with the assignment it is for. */
  async saveReference(assignmentId: string, work: Work, now = new Date().toISOString()): Promise<ConfirmedRecord> {
    const a = (await this.repo.listRecords('assignment')).find((r) => r.id === assignmentId);
    if (!a) throw new Error('That assignment no longer exists.');
    const id = work.doi ?? work.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    return this.repo.saveGenerated({
      entityType: 'ai_note',
      key: `${String(a.fields.courseCode)}|ref|${a.key}|${id}`,
      fields: {
        kind: 'reference', title: work.title, courseCode: String(a.fields.courseCode ?? ''), sourceId: null,
        summary: apaText(work), actions: [inText(work)], cautions: [], assignmentKeys: [a.key], provider: work.from, model: 'catalogue record', createdAt: now,
      },
      unknownFields: [],
      evidence: [{
        sourceId: a.evidence[0]?.sourceId ?? 'none', sourceType: 'pasted_text', originalName: `${work.from === 'crossref' ? 'Crossref' : 'OpenAlex'} record`, importedAt: now, page: null, imageRegion: null, textLocation: null,
        excerpt: work.doi ? `doi:${work.doi}` : work.title, extractionMethod: 'deterministic_text', verificationStatus: 'verified', confirmationStatus: 'confirmed',
      }],
    }, now);
  }

  async referencesFor(assignmentKey: string): Promise<ConfirmedRecord[]> {
    return (await this.aiNotesFor(assignmentKey)).filter((n) => n.fields.kind === 'reference').reverse();
  }

  /** AI notes for one assignment, newest first. */
  async aiNotesFor(assignmentKey: string): Promise<ConfirmedRecord[]> {
    return (await this.repo.listRecords('ai_note'))
      .filter((n) => Array.isArray(n.fields.assignmentKeys) && (n.fields.assignmentKeys as string[]).includes(assignmentKey))
      .sort((x, y) => String(y.fields.createdAt).localeCompare(String(x.fields.createdAt)));
  }

  async calendarFeed(): Promise<CalendarFeed | null> {
    return this.repo.getSetting<CalendarFeed | null>('calendarFeed', null);
  }

  async saveCalendarFeed(url: string | null): Promise<void> {
    if (!url) return this.repo.setSetting('calendarFeed', null);
    const prev = await this.calendarFeed();
    await this.repo.setSetting('calendarFeed', { url: url.trim(), lastSyncedAt: prev?.url === url.trim() ? prev.lastSyncedAt : null, lastResult: null });
  }

  /**
   * Download the student's calendar feed and propose what is new or changed.
   * Events that match saved items exactly are not shown again.
   */
  async syncCalendarFeed(fetch: FeedFetcher, now = new Date().toISOString()): Promise<FeedSyncResult> {
    const feed = await this.calendarFeed();
    if (!feed) throw new Error('No calendar feed link is saved yet.');
    const text = await fetch(feed.url);
    const r = await this.import([{ kind: 'file', name: 'Calendar feed.ics', bytes: new TextEncoder().encode(text), hints: { material: 'other' } }]);
    let unchanged = 0;
    for (const p of r.proposals.filter((x) => x.kind === 'duplicate')) {
      await this.reject(p.id);
      unchanged++;
    }
    const res: FeedSyncResult = {
      newItems: r.proposals.filter((p) => p.kind === 'create').length,
      changedItems: r.proposals.filter((p) => p.kind === 'update' || p.kind === 'conflict').length,
      unchanged,
      events: r.sources.reduce((n, s) => n + s.records.length, 0),
    };
    const summary = `${res.newItems} new, ${res.changedItems} changed, ${res.unchanged} already saved`;
    await this.repo.setSetting('calendarFeed', { ...feed, lastSyncedAt: now, lastResult: summary });
    return res;
  }

  async student(): Promise<StudentProfile> {
    return this.repo.getSetting<StudentProfile>('student', { name: '' });
  }

  async saveStudent(profile: StudentProfile) {
    await this.repo.setSetting('student', { name: profile.name.trim() });
  }

  async saveProfile(university: string, program: string | null) {
    const existing = (await this.repo.listRecords('university'))[0] ?? null;
    return this.saveTyped('university', { name: university.trim(), program: program?.trim() || null, academicYear: null }, existing?.id ?? null);
  }

  async saveSemester(input: SemesterInput) {
    const sem = (await this.onboarding()).currentSemester;
    const durationWeeks = input.start?.iso && input.end?.iso
      ? Math.round(((Date.parse(input.end.iso) - Date.parse(input.start.iso)) / 86_400_000 + 1) / 7)
      : null;
    const rec = await this.saveTyped('semester', { name: input.name.trim(), startDate: input.start, endDate: input.end, durationWeeks }, sem?.id ?? null);
    await this.setCurrentSemester(rec.id);
    return rec;
  }

  async addCourse(input: CourseInput) {
    const semester = (await this.onboarding()).currentSemester;
    const code = normaliseCourseCode(input.code);
    const existing = await this.repo.findRecordByKey('course', code);
    const fields: Record<string, FieldValue> = {
      code,
      name: input.name?.trim() || null,
      instructor: input.instructor?.trim() || null,
      semester: (semester?.fields.name as string | null) ?? null,
    };
    if (input.section !== undefined) fields.section = input.section || null;
    if (input.url !== undefined) fields.lmsUrl = input.url || null;
    // When updating, fields left out here keep their saved values
    // (correctRecord merges into the existing record).
    return this.saveTyped('course', fields, existing?.id ?? null);
  }

  /**
   * Makes sure every course code that appears on a saved assignment or event has a course of its own,
   * so the Courses page is never empty while the Home page shows work for those courses.
   * Returns how many courses were created.
   */
  async ensureCourses(): Promise<number> {
    const records = await this.repo.listRecords();
    const have = new Set(records.filter((r) => r.entityType === 'course').map((r) => String(r.fields.code)));
    const missing = new Set<string>();
    for (const r of records) {
      if (r.entityType === 'course') continue;
      const c = r.fields.courseCode;
      if (typeof c === 'string' && c && !have.has(c)) missing.add(c);
    }
    for (const code of missing) await this.addCourse({ code, name: null, instructor: null });
    return missing.size;
  }

  /**
   * Add several courses at once (for example a pasted Canvas course list).
   * When no semester is set yet, the list's term becomes the semester name.
   */
  /** The saved semester's name, or null when none is saved yet. */
  async semesterName(): Promise<string | null> {
    const s = (await this.onboarding()).currentSemester;
    return s?.fields.name ? String(s.fields.name) : null;
  }

  /** Terms named in the text that are not the saved semester, so the app can ask before trusting it. */
  async termMismatch(text: string): Promise<{ found: string[]; semester: string } | null> {
    return termMismatch(text, await this.semesterName());
  }

  async addCourses(list: { code: string; name: string | null; section: string | null; term: string | null; url: string | null }[]) {
    const current = (await this.onboarding()).currentSemester;
    const term = list.find((c) => c.term)?.term ?? null;
    if (!current && term) await this.saveSemester({ name: term, start: null, end: null });
    const saved = [];
    for (const c of list) {
      const existing = await this.repo.findRecordByKey('course', normaliseCourseCode(c.code));
      saved.push(await this.addCourse({
        code: c.code,
        name: c.name,
        instructor: (existing?.fields.instructor as string | null) ?? null,
        section: c.section,
        url: c.url,
      }));
    }
    return saved;
  }

  /**
   * Removes a course and everything that belongs to it: its assignments, events and announcements,
   * waiting suggestions, imported material used only by this course, and its saved chat.
   * Nothing is left behind to show up on Home, the calendar or in Chat.
   * Returns how many saved items went with it.
   */
  async removeCourse(id: string): Promise<number> {
    const records = await this.repo.listRecords();
    const course = records.find((r) => r.id === id);
    if (!course) return 0;
    const code = String(course.fields.code ?? course.key);
    const owned = records.filter((r) => r.id !== id && r.fields.courseCode === code);
    for (const p of await this.repo.listProposals('pending')) {
      if (p.candidate.fields.courseCode === code || p.key === code || p.candidate.provenance.importedInto === code) await this.repo.rejectProposal(p.id);
    }
    const others = records.filter((r) => r.entityType !== 'course' && r.fields.courseCode !== code);
    const usedElsewhere = new Set(others.flatMap((r) => r.evidence.map((e) => e.sourceId)));
    for (const src of sourcesForCourse(code, await this.repo.listSources(), records)) {
      if (!usedElsewhere.has(src.id)) await this.repo.deleteSource(src.id, true);
    }
    for (const r of owned) await this.repo.deleteRecord(r.id).catch(() => undefined);
    await this.repo.deleteRecord(id);
    await this.clearChat(code);
    return owned.length;
  }

  /** Import material for one course: the course and semester are known, so nothing needs classifying by hand. */
  async importForCourse(courseCode: string, inputs: ImportInput[]) {
    const semester = (await this.onboarding()).currentSemester;
    const hints = { course: courseCode, semester: (semester?.fields.name as string | undefined) ?? undefined };
    const r = await this.import(inputs.map((i) => ({ ...i, hints: { ...hints, ...(i.hints ?? {}) } }) as ImportInput));
    // Inside a course, items that match what is saved exactly add nothing: skip them.
    const skipped = r.proposals.filter((p) => p.kind === 'duplicate');
    for (const p of skipped) await this.reject(p.id);
    return { ...r, proposals: r.proposals.filter((p) => p.kind !== 'duplicate'), skippedDuplicates: skipped.length };
  }

  approve(proposalId: string, resolution?: Resolution) {
    return this.repo.approveProposal(proposalId, resolution);
  }

  reject(proposalId: string) {
    return this.repo.rejectProposal(proposalId);
  }

  async currentSemesterId(): Promise<string | null> {
    return this.repo.getSetting<string | null>('currentSemesterId', null);
  }

  async setCurrentSemester(id: string): Promise<void> {
    await this.repo.setSetting('currentSemesterId', id);
  }

  async onboarding(): Promise<OnboardingStatus> {
    return onboardingStatus(await this.repo.listRecords(), await this.currentSemesterId());
  }

  // ---------- next semester reminders ----------

  async nextSemesterSettings(): Promise<NextSemesterSettings> {
    const s = await this.repo.getSetting<NextSemesterSettings>('nextSemester', DEFAULT_NEXT);
    const { currentSemester } = await this.onboarding();
    // A different current semester means a new cycle: earlier answers were
    // about this semester, not the next one.
    if (currentSemester && s.forSemesterId && s.forSemesterId !== currentSemester.id) {
      return { ...DEFAULT_NEXT, remindersEnabled: s.remindersEnabled, forSemesterId: currentSemester.id };
    }
    return { ...DEFAULT_NEXT, ...s, forSemesterId: currentSemester?.id ?? s.forSemesterId };
  }

  async updateNextSemester(patch: Partial<NextSemesterSettings>): Promise<NextSemesterSettings> {
    const next = { ...(await this.nextSemesterSettings()), ...patch };
    await this.repo.setSetting('nextSemester', next);
    return next;
  }

  async reminderState(): Promise<SemesterReminderState> {
    const records = await this.repo.listRecords();
    const { currentSemester } = onboardingStatus(records, await this.currentSemesterId());
    const s = await this.nextSemesterSettings();
    const start = (currentSemester?.fields.startDate as AcademicDate | null)?.iso ?? null;
    const end = (currentSemester?.fields.endDate as AcademicDate | null)?.iso ?? null;
    const semName = currentSemester?.fields.name ?? null;
    const breaks = records
      .filter((r) => r.entityType === 'academic_break' && (!semName || !r.fields.semester || r.fields.semester === semName))
      .map((r) => ({
        start: (r.fields.startDate as AcademicDate | null)?.iso ?? null,
        end: (r.fields.endDate as AcademicDate | null)?.iso ?? null,
      }))
      .filter((b): b is { start: string; end: string } => !!b.start && !!b.end);
    return {
      currentSemester: start && end ? { start, end } : null,
      breaks,
      nextSemesterSubjectsConfirmed: s.subjectsConfirmed,
      skippingNextSemester: s.skipping,
      remindersEnabled: s.remindersEnabled,
      snoozedUntil: s.snoozedUntil,
      lastPromptedOn: s.lastPromptedOn,
    };
  }

  async subjectPrompt(today: string): Promise<{ show: boolean; nextDate: string | null }> {
    const st = await this.reminderState();
    return { show: shouldPromptForSubjects(st, today), nextDate: nextSubjectPromptDate(st, today) };
  }

  async markSubjectPromptShown(today: string): Promise<void> {
    await this.updateNextSemester({ lastPromptedOn: today });
  }

  // ---------- deadlines ----------

  async reminderSettings(): Promise<ReminderSettings> {
    return this.repo.getSetting<ReminderSettings>('deadlineReminders', {
      offsetsDays: DEFAULT_OFFSETS, remindAt: DEFAULT_REMIND_AT, enabled: true,
    });
  }

  async upcomingReminders(today: string): Promise<ScheduledReminder[]> {
    return buildDeadlineReminders(await this.repo.listRecords(), await this.reminderSettings(), today);
  }

  async upcomingDeadlines(today: string, days = 14): Promise<ConfirmedRecord[]> {
    const limit = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
    const recs = await this.repo.listRecords();
    const dateOf = (r: ConfirmedRecord) => ((r.fields.dueDate ?? r.fields.date) as AcademicDate | null)?.iso ?? null;
    return recs
      .filter((r) => (r.entityType === 'assignment' || r.entityType === 'timeline_event') && r.fields.kind !== 'availability' && r.fields.kind !== 'module')
      .filter((r) => {
        const d = dateOf(r);
        return d !== null && d >= today && d <= limit;
      })
      .sort((a, b) => (dateOf(a) as string).localeCompare(dateOf(b) as string) || String(a.fields.title ?? '').localeCompare(String(b.fields.title ?? ''), undefined, { numeric: true }));
  }

  // ---------- syllabus facts, briefs, units ----------

  /** The syllabus text and the facts read from it, for one course. */
  async syllabusFor(code: string): Promise<{ text: string | null; facts: SyllabusFacts | null }> {
    const records = await this.repo.listRecords();
    const sources = sourcesForCourse(code, await this.repo.listSources(), records).filter((x) => sourceKind(x) === 'syllabus');
    if (!sources.length) return { text: null, facts: null };
    const text = [...sources].sort((a, b) => b.text.length - a.text.length)[0].text;
    return { text, facts: parseSyllabus(text) };
  }

  private async factsByCourse(records: ConfirmedRecord[]): Promise<{ facts: Record<string, SyllabusFacts | undefined>; texts: Record<string, string | undefined> }> {
    const facts: Record<string, SyllabusFacts | undefined> = {};
    const texts: Record<string, string | undefined> = {};
    for (const c of records.filter((r) => r.entityType === 'course')) {
      const code = String(c.fields.code);
      const s = await this.syllabusFor(code);
      if (s.facts) { facts[code] = s.facts; texts[code] = s.text ?? undefined; }
    }
    return { facts, texts };
  }

  async milestones(): Promise<Milestone[]> {
    const records = await this.repo.listRecords();
    return milestonesFor(records, (await this.factsByCourse(records)).facts);
  }

  async briefFor(recordId: string): Promise<Brief | null> {
    const records = await this.repo.listRecords();
    const rec = records.find((r) => r.id === recordId);
    if (!rec) return null;
    const code = String(rec.fields.courseCode ?? '');
    const { text, facts } = await this.syllabusFor(code);
    const sources = sourcesForCourse(code, await this.repo.listSources(), records);
    const ms = milestonesFor(records, facts ? { [code]: facts } : {});
    return buildBrief(rec, records, sources, facts, text, ms);
  }

  async units(code: string, today: string): Promise<UnitSummary[]> {
    return summariseUnits((await this.repo.listRecords()).filter((r) => r.fields.courseCode === code), today);
  }

  // ---------- reminders by email and desktop notification ----------

  async pushSettings(): Promise<PushSettings> {
    const stored = await this.repo.getSetting<Partial<PushSettings>>('push', {});
    // Only known fields, so settings saved by older versions (texting) are dropped cleanly.
    return (Object.keys(DEFAULT_PUSH) as (keyof PushSettings)[]).reduce(
      (out, k) => ({ ...out, [k]: stored[k] ?? DEFAULT_PUSH[k] }), { ...DEFAULT_PUSH });
  }

  async savePushSettings(s: PushSettings): Promise<void> {
    await this.repo.setSetting('push', s);
  }

  private async sentLog(): Promise<Record<string, string>> {
    return this.repo.getSetting<Record<string, string>>('push.sent', {});
  }

  async reminderPlan(): Promise<Reminder[]> {
    return remindersFor(await this.milestones());
  }

  private async courseInfo(): Promise<Record<string, { name: string | null; instructor: string | null }>> {
    const courses: Record<string, { name: string | null; instructor: string | null }> = {};
    for (const c of (await this.repo.listRecords()).filter((r) => r.entityType === 'course')) {
      courses[String(c.fields.code)] = { name: c.fields.name ? String(c.fields.name) : null, instructor: c.fields.instructor ? String(c.fields.instructor) : null };
    }
    return courses;
  }

  /** The email for a day's reminders, for a preview and for sending. */
  async emailFor(reminders: Reminder[]): Promise<Email | null> {
    return formatEmail(reminders, await this.courseInfo(), (await this.pushSettings()).name);
  }

  /** The next weeks of reminder emails, one per day, for the job that runs when the app is closed. */
  async emailSchedule(today: string, days = 45) {
    const settings = await this.pushSettings();
    return scheduleEmails(await this.reminderPlan(), await this.courseInfo(), settings.name, today, days, new Set(Object.keys(await this.sentLog())));
  }

  /** What a day's desktop notification would say. */
  async messagesFor(reminders: Reminder[]): Promise<string[]> {
    const records = await this.repo.listRecords();
    const { texts } = await this.factsByCourse(records);
    const courses = await this.courseInfo();
    return formatDigest(reminders, courses, (m) => {
      const t = texts[m.courseCode];
      const n = /(\d+)/.exec(m.unit ?? '')?.[1];
      const section = t && n ? unitText(t, Number(n)) : null;
      const item = section ? matchUnitItem(m.title, unitItems(section)) : null;
      return item?.prompt ?? null;
    });
  }

  /** Reminders that are due now and have not gone out yet. */
  async dueNow(now: Date, today: string): Promise<{ reminders: Reminder[]; messages: string[]; email: Email | null; settings: PushSettings }> {
    const settings = await this.pushSettings();
    if (!settings.enabled) return { reminders: [], messages: [], email: null, settings };
    const sent = await this.sentLog();
    const due = dueReminders(await this.reminderPlan(), now, today, settings.hour, new Set(Object.keys(sent)));
    return { reminders: due, messages: due.length ? await this.messagesFor(due) : [], email: due.length && settings.mail ? await this.emailFor(due) : null, settings };
  }

  async markReminded(reminders: Reminder[], today: string): Promise<void> {
    const sent = await this.sentLog();
    const keep: Record<string, string> = {};
    const cutoff = addDays(today, -45);
    for (const [k, v] of Object.entries(sent)) if (v >= cutoff) keep[k] = v;
    for (const r of reminders) keep[r.id] = r.sendOn;
    await this.repo.setSetting('push.sent', keep);
  }

  // ---------- chat ----------

  /** Keep a chat answer with the assignment it is for. */
  async saveDraft(assignmentId: string, text: string, now = new Date().toISOString()): Promise<ConfirmedRecord> {
    const a = (await this.repo.listRecords('assignment')).find((r) => r.id === assignmentId);
    if (!a) throw new Error('That assignment no longer exists.');
    const s = await this.aiSettings();
    const stamp = now.replace(/\D/g, '').slice(0, 14);
    return this.repo.saveGenerated({
      entityType: 'ai_note',
      key: `${String(a.fields.courseCode)}|ai|draft|${a.key}|${stamp}`,
      fields: {
        kind: 'draft', title: `Draft for ${String(a.fields.title)}`, courseCode: String(a.fields.courseCode ?? ''), sourceId: null,
        summary: text, actions: [], cautions: [], assignmentKeys: [a.key], provider: s.provider, model: s.model, createdAt: now,
      },
      unknownFields: [],
      evidence: [this.aiProvenance(a.evidence[0]?.sourceId ?? 'none', String(a.fields.title), s, now)],
    }, now);
  }


  async chatHistory(key: string): Promise<ChatMessage[]> {
    return this.repo.getSetting<ChatMessage[]>(`chat:${key}`, []);
  }

  async saveChatHistory(key: string, messages: ChatMessage[]): Promise<void> {
    await this.repo.setSetting(`chat:${key}`, messages.slice(-60));
  }

  /** One line per saved chat (one chat per course, plus one for all courses), for the list beside the conversation. */
  async chatThreads(keys: string[]): Promise<Record<string, { last: string; at: string | null }>> {
    const out: Record<string, { last: string; at: string | null }> = {};
    for (const k of keys) {
      const h = (await this.chatHistory(k)).filter((m) => m.kind !== 'ask');
      const m = h[h.length - 1];
      out[k] = { last: m ? m.content.replace(/\s+/g, ' ').trim().slice(0, 80) : '', at: m?.at ?? null };
    }
    return out;
  }

  async clearChat(key: string): Promise<void> {
    await this.repo.setSetting(`chat:${key}`, []);
  }

  /** Course codes this pasted text names, or the chosen course. */
  async courseFor(text: string, chosen: string | null): Promise<string | null> {
    const codes = (await this.repo.listRecords('course')).map((c) => String(c.fields.code));
    return findCourse(text, codes) ?? chosen ?? (codes.length === 1 ? codes[0] : null);
  }

  /** Sort pasted material into its course, once, and say what happened. */
  async chatIntake(code: string, given: { text?: string; files?: { name: string; bytes: Uint8Array }[] }): Promise<{ reply: string; proposalIds: string[]; announcementIds: string[] }> {
    const inputs: ImportInput[] = [];
    if (given.text?.trim()) inputs.push({ kind: 'text', text: given.text, label: `Chat paste (${code})` });
    for (const f of given.files ?? []) inputs.push({ kind: 'file', name: f.name, bytes: f.bytes });
    const r = await this.importForCourse(code, inputs);
    const reply = describeIntake(r, code, r.skippedDuplicates);
    const announcementIds = r.sources
      .filter((s) => sourceKind({ ...s.source, classifications: s.classifications }) === 'announcement')
      .map((s) => s.source.id);
    return { reply, proposalIds: r.proposals.map((p) => p.id), announcementIds };
  }

  /** Passages of this course's saved material that match a question. */
  async passagesFor(code: string | null, query: string, settings: AiSettings, embed?: RawEmbed): Promise<{ text: string; how: 'meaning' | 'keywords' }[]> {
    if (!code) return [];
    const records = await this.repo.listRecords();
    const sources = sourcesForCourse(code, await this.repo.listSources(), records);
    const chunks = sources.flatMap((x) => chunkText(x.text, x.originalName));
    const tag = modelFor(settings, 'embed');
    const embedder = embed && tag ? (texts: string[]) => embed(tag, settings.ollamaUrl, texts) : undefined;
    const found = await retrieve(query, chunks, 5, embedder, tag);
    return found.map((f) => ({ text: `[${f.chunk.source}]\n${f.chunk.text}`, how: f.how }));
  }

  async chatSystemFor(code: string | null, assignmentId: string | null, today: string, passages: string[] = [], tools: string[] = []): Promise<string> {
    const records = await this.repo.listRecords();
    const course = code ? records.find((r) => r.entityType === 'course' && r.fields.code === code) : null;
    const { facts } = code ? await this.syllabusFor(code) : { facts: null };
    const grading = facts?.grading.map((g) => `${g.label}: ${g.points} points, ${g.percent}%`).join('\n') ?? '';
    const mine = records.filter((r) => r.entityType === 'assignment' && (!code || r.fields.courseCode === code) && r.fields.status !== 'submitted');
    const dueOf = (r: ConfirmedRecord) => (r.fields.dueDate as AcademicDate | null)?.iso ?? null;
    const upcoming = mine.filter((r) => dueOf(r) && (dueOf(r) as string) >= today).sort((a, b) => (dueOf(a) as string).localeCompare(dueOf(b) as string)).slice(0, 14)
      .map((r) => `[${String(r.fields.courseCode ?? '')}] ${String(r.fields.title)} (due ${dueOf(r)}${typeof r.fields.pointsPossible === 'number' ? `, ${r.fields.pointsPossible} pts` : ''})`).join('\n');
    const courses = records.filter((r) => r.entityType === 'course').map((r) => [String(r.fields.code), r.fields.name ? String(r.fields.name) : '', r.fields.instructor ? `Professor ${String(r.fields.instructor)}` : ''].filter(Boolean).join(' · '));
    let focus: { title: string; brief: string } | null = null;
    let references: string[] = [];
    if (assignmentId) {
      const a = records.find((r) => r.id === assignmentId);
      if (a) references = (await this.referencesFor(a.key)).map((n) => String(n.fields.summary));
      const b = await this.briefFor(assignmentId);
      if (b) focus = { title: b.title, brief: briefToText(b) };
    }
    return chatSystem({
      courseCode: code, courseName: course?.fields.name ? String(course.fields.name) : null, instructor: course?.fields.instructor ? String(course.fields.instructor) : null,
      grading, upcoming, courses, focus, references, passages, tools, today: `${prettyDate(today)}, ${today.slice(0, 4)} (${today})`,
    }, globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12));
  }

  /** Run one chat tool and return what it found, for the student (note, works) and for the model (text). */
  async runTool(call: ToolCall, ctx: { code: string | null; today: string; fetcher: Fetcher }): Promise<ToolResult> {
    const label = toolInfo(call.id).label;
    if (call.id === 'whats_due') {
      const range = dueRange(call.arg, ctx.today);
      const courses = await this.courseInfo();
      const all = (await this.milestones()).filter((m) => !ctx.code || m.courseCode === ctx.code);
      const line = (m: (typeof all)[number]) => {
        const c = courses[m.courseCode];
        return `- ${m.title}${m.kind === 'initial_post' ? ' (first post)' : ''} | ${[m.courseCode, c?.name].filter(Boolean).join(' ')}${c?.instructor ? ` | Professor ${c.instructor}` : ''} | due ${prettyDate(m.date)}${m.time ? `, ${prettyTime(m.time)}${m.timeZone ? ` ${m.timeZone}` : ''}` : ''}${m.points !== null ? ` | ${m.points} pts` : ''}`;
      };
      const inRange = all.filter((m) => m.date >= range.from && m.date <= range.to);
      if (inRange.length) return { id: call.id, label, note: `${inRange.length} due ${range.label}`, text: `Today is ${ctx.today}. Due ${range.label}:\n${inRange.map(line).join('\n')}` };
      const next = range.overdue ? undefined : all.find((m) => m.date > range.to);
      return { id: call.id, label, note: `Nothing due ${range.label}`, text: `Today is ${ctx.today}. Nothing is due ${range.label}.${next ? ` The next one is:\n${line(next)}` : ''}` };
    }
    if (call.id === 'check_doi') {
      const w = await verifyDoi(call.arg, ctx.fetcher);
      if (!w) return { id: call.id, label, note: 'DOI not found', text: `No record for DOI ${call.arg} exists in Crossref. Tell the student not to cite it until they find the real paper.` };
      return { id: call.id, label, note: 'DOI is real', works: [w], text: `DOI ${call.arg} is real:\n${apaText(w)}\nIn text: ${inText(w)}` };
    }
    const r = await searchWorks(call.arg, ctx.fetcher);
    const works = r.works.slice(0, 5);
    if (!works.length) return { id: call.id, label, note: 'Nothing found', text: `A search for "${call.arg}" in Crossref and OpenAlex found nothing. Suggest fewer or different keywords. Do not make up sources.` };
    return { id: call.id, label, note: `${works.length} found for "${call.arg}"`, works, text: `Real records found for "${call.arg}":\n${works.map((w) => `- ${apaText(w)} | In text: ${inText(w)}`).join('\n')}` };
  }

  /** One chat turn: the student's message in, the assistant's reply out. */
  async chatReply(key: string, code: string | null, assignmentId: string | null, text: string, complete: Completer, today: string, opts: { task?: 'assignment' | 'general'; embed?: RawEmbed; tools?: ToolResult[] } = {}): Promise<{ text: string; model: string; task: 'assignment' | 'general'; search: 'meaning' | 'keywords' | 'none'; passages: number }> {
    const s = await this.aiSettings();
    if (!aiReady(s)) {
      throw new Error(isCloud(s.provider) && !s.cloudConsent
        ? `Agree to send material to ${PROVIDER_NAME[s.provider]} in Semester setup → AI assistant first.`
        : 'Turn on the AI assistant in Semester setup first, then I can answer here.');
    }
    const history = (await this.chatHistory(key)).filter((m) => m.kind !== 'intake').slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const task = opts.task ?? (assignmentId ? 'assignment' : 'general');
    const model = modelFor(s, task === 'assignment' ? 'writing' : 'chat');
    const found = await this.passagesFor(code, text, s, s.provider === 'ollama' ? opts.embed : undefined);
    const system = await this.chatSystemFor(code, assignmentId, today, found.map((f) => f.text), (opts.tools ?? []).map((t) => `${t.label}:\n${t.text}`));
    const reply = await complete({ provider: s.provider, model, system, prompt: text, history, json: false, baseUrl: s.provider === 'ollama' ? s.ollamaUrl : undefined });
    return { text: reply, model, task, search: found[0]?.how ?? 'none', passages: found.length };
  }
}
