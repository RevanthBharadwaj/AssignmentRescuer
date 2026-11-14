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
      },
    });
    await this.repo.saveImport(result);
    return result;
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
      .sort((a, b) => (dateOf(a) as string).localeCompare(dateOf(b) as string));
  }
}
