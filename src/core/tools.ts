import { addDays } from './extract/dates';
import { extractDoi } from './scholar';

/**
 * Tools the chat can use. Each one wraps something the app already does and
 * is chosen by simple rules, so no extra model call is spent deciding. What a
 * tool returned is shown under the reply, and it is the only outside
 * information the model is given.
 */

export type ToolId = 'search_material' | 'whats_due' | 'find_sources' | 'check_doi';

export interface ToolInfo { id: ToolId; label: string; what: string; where: string }

export const TOOLS: ToolInfo[] = [
  { id: 'search_material', label: 'Search my saved material', what: 'Finds the passages of your syllabus, announcements and assignment pages that match your question. Used on every question.', where: 'Runs on this computer.' },
  { id: 'whats_due', label: "What's due", what: 'Lists assignments by date with course, professor, time and points. Used when you ask what is due, today, tomorrow or this week.', where: 'Runs on this computer.' },
  { id: 'find_sources', label: 'Find sources', what: 'Searches real papers and builds APA 7 references from what the catalogues return. Used when you ask for sources, references or citations.', where: 'Crossref and OpenAlex (free). Only the words you ask about are sent.' },
  { id: 'check_doi', label: 'Check a DOI', what: 'Confirms a DOI is real and shows its details. Used when your message contains a DOI.', where: 'Crossref (free). Only the DOI is sent.' },
];

export const toolInfo = (id: ToolId): ToolInfo => TOOLS.find((t) => t.id === id) as ToolInfo;

const FILLER = /\b(please|can you|could you|would you|find|get|give|show|search|look|me|some|any|a|an|the|for|about|on|of|to|i|need|want|real|good|best|credible|scholarly|academic|sources?|references?|citations?|cite|papers?|articles?|journals?|literature|peer[- ]reviewed|apa|and|with|my)\b/gi;

/** The topic to search for: the words left after the request words are removed, else the assignment's title. */
export function sourceQuery(input: string, focusTitle: string | null): string {
  const words = input.replace(FILLER, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const topic = words.join(' ');
  if (words.length >= 2) return topic;
  return [topic, focusTitle?.replace(/^Unit \d+:\s*/i, '')].filter(Boolean).join(' ').trim();
}

export interface ToolCall { id: Exclude<ToolId, 'search_material'>; arg: string }

export function pickTools(input: string, focusTitle: string | null): ToolCall[] {
  const calls: ToolCall[] = [];
  const doi = extractDoi(input);
  if (doi) calls.push({ id: 'check_doi', arg: doi });
  else if (/\b(sources?|references?|citations?|cite|papers?|articles?|journals?|literature|scholar|peer[- ]reviewed)\b/i.test(input)) {
    const q = sourceQuery(input, focusTitle);
    if (q) calls.push({ id: 'find_sources', arg: q });
  }
  if (/\b(due|deadlines?|today|tonight|tomorrow|this week|next week|upcoming|coming up|overdue|what'?s next|what is next)\b/i.test(input)) calls.push({ id: 'whats_due', arg: input });
  return calls;
}

export interface DueRange { from: string; to: string; label: string; overdue: boolean }

/** Which dates a question about deadlines means. */
export function dueRange(input: string, today: string): DueRange {
  const t = input.toLowerCase();
  if (/\boverdue|\blate\b|\bmissed\b/.test(t)) return { from: addDays(today, -60), to: addDays(today, -1), label: 'overdue', overdue: true };
  if (/\btomorrow\b/.test(t)) return { from: addDays(today, 1), to: addDays(today, 1), label: 'tomorrow', overdue: false };
  if (/\bnext week\b/.test(t)) return { from: addDays(today, 7), to: addDays(today, 13), label: 'next week', overdue: false };
  if (/\bthis week\b/.test(t)) return { from: today, to: addDays(today, 6), label: 'in the next 7 days', overdue: false };
  if (/\btoday\b|\btonight\b/.test(t)) return { from: today, to: today, label: 'today', overdue: false };
  return { from: today, to: addDays(today, 13), label: 'in the next two weeks', overdue: false };
}
