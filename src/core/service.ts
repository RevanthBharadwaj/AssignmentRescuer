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
import type { EntityType, FieldValue } from './types';
import { normaliseCourseCode } from './util';

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
   * Add several courses at once (for example a pasted Canvas course list).
   * When no semester is set yet, the list's term becomes the semester name.
   */
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

  async removeCourse(id: string) {
    await this.repo.deleteRecord(id);
  }

  /** Import material for one course: the course and semester are known, so nothing needs classifying by hand. */
  async importForCourse(courseCode: string, inputs: ImportInput[]) {
    const semester = (await this.onboarding()).currentSemester;
    const hints = { course: courseCode, semester: (semester?.fields.name as string | undefined) ?? undefined };
    return this.import(inputs.map((i) => ({ ...i, hints: { ...hints, ...(i.hints ?? {}) } }) as ImportInput));
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
}
