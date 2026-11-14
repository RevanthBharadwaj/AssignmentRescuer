import { describe, expect, it } from 'vitest';
import { normaliseAi, type AiSettings, type CompletionRequest } from '../src/core/ai';
import { candidates, costOf, infoFor, pickModel, spentThisMonth } from '../src/core/providers';
import { makeService } from './helpers';

const NONE = { ollama: 0, anthropic: 0, openai: 0 };
const base: AiSettings = { provider: 'none', model: '', ollamaUrl: 'http://localhost:11434', cloudConsent: true };
const all: AiSettings = { ...base, model: 'qwen3:4b', writingModel: 'qwen3:8b', enabled: { ollama: true, anthropic: true, openai: true } };

describe('several providers at once', () => {
  it('turns an old single provider setting into the new shape', () => {
    const n = normaliseAi({ ...base, provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(n.enabled).toEqual({ ollama: false, anthropic: true, openai: false });
    expect(n.routing.mode).toBe('auto');
    expect(candidates(base)).toEqual([]);
  });

  it('always uses Claude for assignment analysis, and says so when Claude is off', () => {
    const p = pickModel('assignment', all, NONE);
    expect(p).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
    const local = pickModel('assignment', { ...all, enabled: { ollama: true, anthropic: false, openai: true } }, NONE);
    expect(local).toMatchObject({ ok: false, reason: 'claude-needed' });
  });

  it('lets you pick which Claude model analyzes assignments', () => {
    const s = normaliseAi({ ...all, routing: { mode: 'auto', manual: {}, assignmentModel: 'claude-haiku-5-5', limits: { anthropic: null, openai: null } } });
    expect(pickModel('assignment', s, NONE)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
  });

  it('automatic mode picks the cheapest model that is good enough, free local first', () => {
    // Everyday chat only needs a light model: the free 4B one.
    expect(pickModel('chat', all, NONE)).toMatchObject({ provider: 'ollama', model: 'qwen3:4b' });
    // Reading a syllabus needs a solid model: the free 8B one beats any paid model.
    expect(pickModel('read', all, NONE)).toMatchObject({ provider: 'ollama', model: 'qwen3:8b' });
    // With no local model, the cheapest paid model that fits is Claude Haiku 5.5.
    const paid = { ...all, enabled: { ollama: false, anthropic: true, openai: true } };
    expect(pickModel('read', paid, NONE)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    // Only a light local model: it is used for reading too, with a note that it is the best available.
    const small: AiSettings = { ...base, model: 'qwen3:4b', enabled: { ollama: true, anthropic: false, openai: false } };
    const p = pickModel('read', small, NONE);
    expect(p).toMatchObject({ ok: true, provider: 'ollama', model: 'qwen3:4b' });
    expect(p.ok && p.why).toMatch(/stronger one would do better/);
  });

  it('uses the model you chose for a job when you switch to choosing yourself', () => {
    const s = normaliseAi({ ...all, routing: { mode: 'manual', manual: { chat: { provider: 'openai', model: 'gpt-4o-mini' } }, assignmentModel: 'claude-sonnet-5-5', limits: { anthropic: null, openai: null } } });
    expect(pickModel('chat', s, NONE)).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini' });
    // A job you left on automatic still picks for itself.
    expect(pickModel('read', s, NONE)).toMatchObject({ provider: 'ollama', model: 'qwen3:8b' });
  });

  it('falls back to a free local model when a monthly limit is reached', () => {
    const s = normaliseAi({ ...all, routing: { mode: 'auto', manual: {}, assignmentModel: 'claude-sonnet-5-5', limits: { anthropic: 1, openai: null } } });
    const over = { ...NONE, anthropic: 1.2 };
    expect(pickModel('assignment', s, over)).toMatchObject({ ok: true, provider: 'ollama', fellBack: true });
    const noLocal = normaliseAi({ ...s, enabled: { ollama: false, anthropic: true, openai: false } });
    expect(pickModel('assignment', noLocal, over)).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('estimates cost from published prices, with the higher Haiku rate past 100K tokens', () => {
    expect(costOf(infoFor('anthropic', 'claude-sonnet-5-5'), 10_000, 2_000)).toBeCloseTo(0.04, 5);
    expect(costOf(infoFor('anthropic', 'claude-haiku-5-5'), 10_000, 2_000)).toBeCloseTo(0.002, 5);
    expect(costOf(infoFor('anthropic', 'claude-haiku-5-5'), 200_000, 0)).toBeCloseTo(0.1, 5);
    expect(costOf(infoFor('ollama', 'qwen3:4b'), 50_000, 5_000)).toBe(0);
  });

  it('adds up this month only', () => {
    const log = [
      { at: '2026-11-02T10:00:00Z', provider: 'anthropic' as const, model: 'm', job: 'chat' as const, inTokens: 1, outTokens: 1, usd: 0.5 },
      { at: '2026-11-10T10:00:00Z', provider: 'anthropic' as const, model: 'm', job: 'chat' as const, inTokens: 1, outTokens: 1, usd: 0.25 },
      { at: '2026-10-30T10:00:00Z', provider: 'anthropic' as const, model: 'm', job: 'chat' as const, inTokens: 1, outTokens: 1, usd: 9 },
    ];
    expect(spentThisMonth(log, new Date(2026, 10, 14)).anthropic).toBeCloseTo(0.75, 5);
  });
});

describe('calls through the service', () => {
  it('records each call, names the model that answered and stops at the limit', async () => {
    const { service } = await makeService();
    await service.saveAiSettings({ ...all, routing: { mode: 'auto', manual: {}, assignmentModel: 'claude-sonnet-5-5', limits: { anthropic: 0.001, openai: null } } });
    const seen: CompletionRequest[] = [];
    const complete = async (r: CompletionRequest) => { seen.push(r); return 'ok '.repeat(500); };
    const first = await service.completeFor('assignment', complete, { system: 'x'.repeat(8000), prompt: 'plan it', json: false });
    expect(first.pick).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(seen[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    const log = await service.usageLog();
    expect(log).toHaveLength(1);
    expect(log[0].usd).toBeGreaterThan(0.001);
    // The limit is now reached, so the next assignment call uses the free local model.
    const second = await service.completeFor('assignment', complete, { system: 'x', prompt: 'again', json: false });
    expect(second.pick).toMatchObject({ provider: 'ollama', fellBack: true });
    expect((await service.usageLog())[1].usd).toBe(0);
  });
});
