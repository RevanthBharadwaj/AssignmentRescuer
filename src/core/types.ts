/**
 * Core domain types for Assignment Rescue AI.
 *
 * Rule: extracted values that are not present in the source are `null`
 * and listed in `unknownFields`. Nothing is invented.
 */

export type InputFormat =
  | 'plain_text'
  | 'markdown'
  | 'txt'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'rtf'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'heic'
  | 'csv'
  | 'xlsx'
  | 'json'
  | 'ics'
  | 'manual'
  | 'unknown';

export type SourceType = 'pasted_text' | 'file' | 'manual_entry';

export type ExtractionMethod =
  | 'deterministic_text'
  | 'manual_entry'
  | 'ocr'
  | 'vision_model'
  | 'document_parser'
  | 'structured_parser'
  | 'ai_model';

export type VerificationStatus = 'unverified' | 'verified' | 'flagged';
export type ConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export interface SourceDocument {
  id: string;
  sourceType: SourceType;
  format: InputFormat;
  /** Original filename, or a label such as "Pasted text" for text entries. */
  originalName: string;
  importedAt: string; // ISO timestamp
  contentHash: string;
  text: string;
  byteSize: number;
  /** Optional student supplied hints. */
  hints: ImportHints;
  securityFlags: SecurityFlag[];
}

export interface ImportHints {
  university?: string;
  semester?: string;
  course?: string;
  contentType?: ContentLabel;
  academicYear?: string;
}

export interface TextLocation {
  line: number; // 1 based
  start: number; // char offset in source text
  end: number;
}

export interface Provenance {
  sourceId: string;
  sourceType: SourceType;
  originalName: string;
  importedAt: string;
  page: number | null;
  imageRegion: { x: number; y: number; w: number; h: number } | null;
  textLocation: TextLocation | null;
  excerpt: string;
  extractionMethod: ExtractionMethod;
  verificationStatus: VerificationStatus;
  confirmationStatus: ConfirmationStatus;
}

export const CONTENT_LABELS = [
  'semester_information',
  'course_information',
  'course_timeline',
  'syllabus',
  'announcement',
  'assignment_instructions',
  'grading_rubric',
  'discussion_question',
  'peer_reply_instructions',
  'reading_schedule',
  'lecture_material',
  'textbook_content',
  'research_article',
  'academic_deadline',
  'project_requirements',
  'statistical_dataset',
] as const;
export type ContentLabel = (typeof CONTENT_LABELS)[number];

export interface Classification {
  label: ContentLabel;
  score: number;
  evidence: string[];
}

export type EntityType =
  | 'university'
  | 'semester'
  | 'academic_break'
  | 'course'
  | 'assignment'
  | 'rubric_criterion'
  | 'timeline_event'
  | 'research_source';

export type TimelineEventKind =
  | 'module'
  | 'due'
  | 'availability'
  | 'reading'
  | 'discussion'
  | 'peer_reply'
  | 'exam'
  | 'milestone'
  | 'course_start'
  | 'course_end';

export type AssignmentType =
  | 'essay'
  | 'paper'
  | 'project'
  | 'quiz'
  | 'exam'
  | 'discussion'
  | 'peer_reply'
  | 'lab'
  | 'report'
  | 'presentation'
  | 'reflection'
  | 'homework'
  | 'assignment';

/** A calendar date with explicit knowledge about what is known. */
export interface AcademicDate {
  /** YYYY-MM-DD when the year is known or inferred, otherwise null. */
  iso: string | null;
  month: number;
  day: number;
  year: number | null;
  yearSource: 'explicit' | 'semester_context' | 'unknown';
  /** HH:MM 24 hour, or null when no time was stated. */
  time: string | null;
  timeZone: string | null;
  raw: string;
}

export type FieldValue = string | number | boolean | AcademicDate | string[] | null;

export type ReviewFlag =
  | 'missing_year'
  | 'ambiguous_time_zone'
  | 'missing_date'
  | 'course_unassigned'
  | 'course_mismatch'
  | 'possible_prompt_injection'
  | 'low_confidence'
  | 'date_range_inverted';

export interface ExtractedRecord {
  /** Deterministic id derived from source + location. */
  id: string;
  entityType: EntityType;
  /** Natural key used for duplicate detection (normalised). */
  key: string;
  fields: Record<string, FieldValue>;
  unknownFields: string[];
  flags: ReviewFlag[];
  provenance: Provenance;
}

export interface FieldChange {
  field: string;
  oldValue: FieldValue;
  newValue: FieldValue;
}

/**
 * create:    new record, nothing similar exists
 * update:    differs from a confirmed record (old and new values shown)
 * duplicate: matches a confirmed record exactly, approval only adds evidence
 * conflict:  two sources in the same import disagree with each other
 */
export type ProposalKind = 'create' | 'update' | 'duplicate' | 'conflict';

export interface ChangeProposal {
  id: string;
  kind: ProposalKind;
  entityType: EntityType;
  key: string;
  /** Existing confirmed record id for updates and duplicates. */
  targetRecordId: string | null;
  candidate: ExtractedRecord;
  /** Other extracted records that support or contradict the candidate. */
  alternatives: ExtractedRecord[];
  changes: FieldChange[];
  status: ConfirmationStatus;
  createdAt: string;
}

export interface ConfirmedRecord {
  id: string;
  entityType: EntityType;
  key: string;
  fields: Record<string, FieldValue>;
  unknownFields: string[];
  evidence: Provenance[];
  confirmedAt: string;
  updatedAt: string;
}

export type SecurityFlagKind =
  | 'prompt_injection_pattern'
  | 'control_characters_removed'
  | 'oversized_input_truncated'
  | 'hidden_text_pattern';

export interface SecurityFlag {
  kind: SecurityFlagKind;
  detail: string;
  line: number | null;
}
