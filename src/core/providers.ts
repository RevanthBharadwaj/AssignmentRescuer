import { ANTHROPIC_MODELS, OPENAI_MODELS, normaliseAi, type AiJob, type AiSettings, type Provider } from './ai';

/**
 * Which model answers which job, and what it costs.
 * Auto mode picks the cheapest model that is good enough for the job, free local models first.
 * Prices are US dollars per million tokens from each provider's price page (checked November 2026)
 * and are only used for an estimate; the real bill is on the provider's own site.
 */

export interface ModelInfo {
  provider: Provider;
  id: string;
  label: string;
  /** How good it is for coursework: 1 light, 2 solid, 3 strongest. */
  tier: 1 | 2 | 3;
  usdIn: number;
  usdOut: number;
  /** Claude Haiku 5.5 charges more once a prompt is longer than this many tokens. */
  long?: { above: number; usdIn: number; usdOut: number };
}

export const CLOUD_CATALOG: ModelInfo[] = [
  { provider: 'anthropic', id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 2, usdIn: 0.10, usdOut: 0.50, long: { above: 100_000, usdIn: 0.50, usdOut: 2.50 } },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 3, usdIn: 2, usdOut: 10 },
  { provider: 'openai', id: 'gpt-4o-mini', label: 'gpt-4o-mini', tier: 2, usdIn: 0.15, usdOut: 0.60 },
  { provider: 'openai', id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', tier: 2, usdIn: 0.40, usdOut: 1.60 },
  { provider: 'openai', id: 'gpt-4o', label: 'gpt-4o', tier: 3, usdIn: 2.5, usdOut: 10 },
];

export const JOB_INFO: Record<AiJob, { label: string; about: string; tier: 1 | 2 | 3 }> = {
  assignment: { label: 'Assignment analysis', about: 'Analyzing an assignment with the full course context. Always Claude.', tier: 3 },
  chat: { label: 'Everyday chat', about: 'Quick questions and short answers', tier: 1 },
  read: { label: 'Reading announcements and syllabi', about: 'Turning course text into plain facts and to do items', tier: 2 },
  review: { label: 'Reviewing your semester', about: 'Looking for mistakes and gaps and suggesting fixes', tier: 2 },
};

/** Local models are rated by size in the name: 7B and up is solid, smaller is light. */
export function localTier(tag: string): 1 | 2 {
  const m = /(\d+(?:\.\d+)?)b/i.exec(tag);
  return m && Number(m[1]) >= 7 ? 2 : 1;
}

export const MODEL_LABEL = (provider: Provider, id: string): string =>
  CLOUD_CATALOG.find((m) => m.provider === provider && m.id === id)?.label ?? id;

export function infoFor(provider: Provider, id: string): ModelInfo {
  return CLOUD_CATALOG.find((m) => m.provider === provider && m.id === id)
    ?? { provider, id, label: id, tier: provider === 'ollama' ? localTier(id) : 2, usdIn: 0, usdOut: 0 };
}

/** Every model that can be used right now: local models you chose, and the models of each paid provider you switched on. */
export function candidates(raw: AiSettings): ModelInfo[] {
  const s = normaliseAi(raw);
  const out: ModelInfo[] = [];
  if (s.enabled.ollama) {
    for (const tag of new Set([s.model, s.writingModel].filter((t): t is string => !!t))) out.push(infoFor('ollama', tag));
  }
  if (s.cloudConsent) {
    if (s.enabled.anthropic) out.push(...CLOUD_CATALOG.filter((m) => m.provider === 'anthropic'));
    if (s.enabled.openai) out.push(...CLOUD_CATALOG.filter((m) => m.provider === 'openai'));
  }
  return out;
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function costOf(m: ModelInfo, inTokens: number, outTokens: number): number {
  const rate = m.long && inTokens > m.long.above ? m.long : m;
  return (inTokens * rate.usdIn + outTokens * rate.usdOut) / 1_000_000;
}

export interface UsageEntry { at: string; provider: Provider; model: string; job: AiJob; inTokens: number; outTokens: number; usd: number }
export type Spent = Record<Provider, number>;

/** What each provider has cost so far this calendar month (an estimate). */
export function spentThisMonth(log: UsageEntry[], now: Date): Spent {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const out: Spent = { ollama: 0, anthropic: 0, openai: 0 };
  for (const e of log) if (e.at.slice(0, 7) === month) out[e.provider] += e.usd;
  return out;
}

export type Pick =
  | { ok: true; provider: Provider; model: string; why: string; fellBack?: boolean }
  | { ok: false; reason: 'claude-needed' | 'no-model' | 'limit'; message: string };

const blended = (m: ModelInfo) => m.usdIn * 3 + m.usdOut;
const overLimit = (s: ReturnType<typeof normaliseAi>, spent: Spent, p: Provider) =>
  p !== 'ollama' && s.routing.limits[p] !== null && spent[p] >= (s.routing.limits[p] as number);

/** The best local model for a job when a paid provider cannot be used, or null. */
function localFallback(all: ModelInfo[], tier: number): ModelInfo | null {
  const local = all.filter((m) => m.provider === 'ollama').sort((a, b) => b.tier - a.tier);
  return local.find((m) => m.tier >= tier) ?? local[0] ?? null;
}

export function pickModel(job: AiJob, raw: AiSettings, spent: Spent): Pick {
  const s = normaliseAi(raw);
  const all = candidates(s);
  if (!all.length) return { ok: false, reason: 'no-model', message: 'Turn on an AI provider in Semester setup first.' };

  if (job === 'assignment') {
    const claude = all.filter((m) => m.provider === 'anthropic');
    if (!claude.length) {
      return { ok: false, reason: 'claude-needed', message: 'Assignment analysis uses Claude. Turn on Claude and add your key in Semester setup, then ask again.' };
    }
    if (overLimit(s, spent, 'anthropic')) {
      const local = localFallback(all, 3);
      if (local) return { ok: true, provider: 'ollama', model: local.id, why: 'Your monthly Claude limit is reached, so a free local model answered.', fellBack: true };
      return { ok: false, reason: 'limit', message: 'You have reached your monthly Claude limit and no free local model is set up. Raise the limit in Semester setup.' };
    }
    const wanted = claude.find((m) => m.id === s.routing.assignmentModel) ?? claude.find((m) => m.tier === 3) ?? claude[0];
    return { ok: true, provider: 'anthropic', model: wanted.id, why: 'Assignments are analyzed with Claude.' };
  }

  if (s.routing.mode === 'manual') {
    const chosen = s.routing.manual[job];
    const m = chosen && all.find((x) => x.provider === chosen.provider && x.id === chosen.model);
    if (m && !overLimit(s, spent, m.provider)) return { ok: true, provider: m.provider, model: m.id, why: 'The model you chose for this job.' };
    if (m) {
      const local = localFallback(all, JOB_INFO[job].tier);
      if (local) return { ok: true, provider: 'ollama', model: local.id, why: `Your monthly ${m.provider === 'anthropic' ? 'Claude' : 'OpenAI'} limit is reached, so a free local model answered.`, fellBack: true };
    }
    // Nothing chosen for this job (or it is switched off): fall through to the automatic choice.
  }

  const usable = all.filter((m) => !overLimit(s, spent, m.provider));
  if (!usable.length) return { ok: false, reason: 'limit', message: 'You have reached your monthly limit and no free local model is set up. Raise the limit in Semester setup.' };
  const need = JOB_INFO[job].tier;
  const fit = usable.filter((m) => m.tier >= need).sort((a, b) => blended(a) - blended(b) || a.tier - b.tier);
  if (fit.length) {
    const m = fit[0];
    return { ok: true, provider: m.provider, model: m.id, why: m.provider === 'ollama' ? 'The cheapest model that fits this job: free, on this computer.' : 'The cheapest model that fits this job.' };
  }
  const best = [...usable].sort((a, b) => b.tier - a.tier || blended(a) - blended(b))[0];
  return { ok: true, provider: best.provider, model: best.id, why: 'The best model you have for this job; a stronger one would do better.' };
}

export function usd(n: number): string {
  return n === 0 ? '$0.00' : n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
}

export { ANTHROPIC_MODELS, OPENAI_MODELS };
