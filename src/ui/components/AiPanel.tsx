import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { ConfirmedRecord } from '../../core/types';
import { ANTHROPIC_MODELS, DEFAULT_OLLAMA_MODEL, aiReady, type AiProvider, type AiSettings, type BriefingAction } from '../../core/ai';
import { completeAi, hasAnthropicKey, setAnthropicKey } from '../aiClient';
import { errorMessage } from '../format';

/* ---------- a saved AI note ---------- */

export function AiNote({ note }: { note: ConfirmedRecord }) {
  const { go } = useApp();
  const actions: BriefingAction[] = (Array.isArray(note.fields.actions) ? note.fields.actions : []).map((a) => {
    try { return JSON.parse(String(a)) as BriefingAction; } catch { return { text: String(a), due: null, assignmentKey: null }; }
  });
  const cautions = Array.isArray(note.fields.cautions) ? (note.fields.cautions as string[]) : [];
  const [done, setDone] = useState<Set<number>>(new Set());
  return (
    <div className="ai-note" aria-label={`AI note: ${String(note.fields.title)}`}>
      <div className="ai-note-head">
        <span className="kind-badge k-ai">AI</span>
        <strong>{String(note.fields.title)}</strong>
        <span className="muted small">{String(note.fields.model)} · {new Date(String(note.fields.createdAt)).toLocaleString()}</span>
      </div>
      <p>{String(note.fields.summary)}</p>
      {actions.length > 0 && (
        <>
          <h4>What to do</h4>
          <ul className="checklist">
            {actions.map((a, i) => (
              <li key={i} className={done.has(i) ? 'is-done' : ''}>
                <label>
                  <input type="checkbox" checked={done.has(i)} onChange={() => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                  {a.text}{a.due ? <span className="muted small"> · {a.due}</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {cautions.length > 0 && (
        <>
          <h4>Easy to miss</h4>
          <ul className="cautions">{cautions.map((c) => <li key={c}>{c}</li>)}</ul>
        </>
      )}
      <p className="muted small">Written by AI from your course material. Check it against the source; it does not change any dates or items.{' '}
        {note.fields.kind === 'announcement' && note.fields.courseCode ? <button type="button" className="link" onClick={() => go({ name: 'course', code: String(note.fields.courseCode), tab: 'announcements' })}>open the announcement</button> : null}
      </p>
    </div>
  );
}

/* ---------- run AI on something ---------- */

export function AiButton({ label, run, onDone }: { label: string; run: () => Promise<unknown>; onDone?: () => void }) {
  const { service, version, go, refresh, toast } = useApp();
  const { data: settings } = useAsync(() => service.aiSettings(), [version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  if (!aiReady(settings)) {
    return <button type="button" className="link" onClick={() => go({ name: 'setup' })}>Turn on the AI assistant to {label.toLowerCase()} →</button>;
  }
  return (
    <span className="ai-run">
      <button type="button" className="ai-btn" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await run();
          refresh();
          toast('AI note saved');
          onDone?.();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Thinking…' : `✦ ${label}`}</button>
      {error && <span role="alert" className="error small">{error}</span>}
    </span>
  );
}

export const runAnnouncement = (service: ReturnType<typeof useApp>['service'], id: string) => service.analyzeAnnouncement(id, completeAi);
export const runAssignment = (service: ReturnType<typeof useApp>['service'], id: string) => service.analyzeAssignment(id, completeAi);

/* ---------- settings (Semester setup step 05) ---------- */

const PROVIDERS: { id: AiProvider; label: string; help: string }[] = [
  { id: 'none', label: 'Off', help: 'No AI. Everything else works as before.' },
  { id: 'ollama', label: 'Local model (Ollama)', help: 'Free. Runs on this Mac; nothing leaves it. Install Ollama from ollama.com and run `ollama pull llama3.1` once.' },
  { id: 'anthropic', label: 'Claude (Anthropic API)', help: 'Best quality. Needs an API key from console.anthropic.com (paid per use). Material you analyze is sent to Anthropic.' },
];

export function AiSettingsCard() {
  const { service, version, refresh } = useApp();
  const { data } = useAsync(async () => ({ s: await service.aiSettings(), hasKey: await hasAnthropicKey() }), [version]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const s = draft ?? data.s;
  const showForm = editing || data.s.provider === 'none';

  if (!showForm) {
    return (
      <>
        <dl className="saved-values">
          <div><dt>Provider</dt><dd>{PROVIDERS.find((p) => p.id === data.s.provider)?.label}</dd></div>
          <div><dt>Model</dt><dd className="mono small">{data.s.model}</dd></div>
          {data.s.provider === 'anthropic' && <div><dt>API key</dt><dd className={data.hasKey ? '' : 'none'}>{data.hasKey ? 'Saved in your Keychain' : 'Not saved'}</dd></div>}
        </dl>
        <button type="button" className="modify" onClick={() => { setDraft(data.s); setEditing(true); }}>Modify</button>
      </>
    );
  }

  const save = async () => {
    setError(null);
    try {
      if (s.provider === 'anthropic' && key.trim()) await setAnthropicKey(key.trim());
      if (s.provider === 'anthropic' && !key.trim() && !data.hasKey) throw new Error('Paste your Anthropic API key.');
      if (s.provider !== 'anthropic' && data.hasKey) await setAnthropicKey(null).catch(() => undefined);
      await service.saveAiSettings({ ...s, model: s.model || (s.provider === 'ollama' ? DEFAULT_OLLAMA_MODEL : s.provider === 'anthropic' ? ANTHROPIC_MODELS[0].id : '') });
      setKey('');
      setDraft(null);
      setEditing(false);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <p className="muted small">The assistant reads an announcement or an assignment's course material and writes down what you need to do. It never changes dates or items.</p>
      <div className="kind-options">
        {PROVIDERS.map((p) => (
          <label key={p.id} className={`kind-option ${s.provider === p.id ? 'on' : ''}`}>
            <input type="radio" name="ai-provider" checked={s.provider === p.id} onChange={() => setDraft({ ...s, provider: p.id, model: p.id === 'ollama' ? DEFAULT_OLLAMA_MODEL : p.id === 'anthropic' ? ANTHROPIC_MODELS[0].id : '' })} />
            <strong>{p.label}</strong>
            <span className="muted small">{p.help}</span>
          </label>
        ))}
      </div>
      {s.provider === 'ollama' && (
        <div className="grid">
          <label>Model name<input value={s.model} onChange={(e) => setDraft({ ...s, model: e.target.value })} placeholder={DEFAULT_OLLAMA_MODEL} /></label>
          <label>Ollama address<input value={s.ollamaUrl} onChange={(e) => setDraft({ ...s, ollamaUrl: e.target.value })} /></label>
        </div>
      )}
      {s.provider === 'anthropic' && (
        <>
          <div className="grid">
            <label>Model
              <select value={s.model} onChange={(e) => setDraft({ ...s, model: e.target.value })}>
                {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label>API key {data.hasKey ? '(saved; paste a new one to replace it)' : ''}
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <label className="consent">
            <input type="checkbox" checked={s.cloudConsent} onChange={(e) => setDraft({ ...s, cloudConsent: e.target.checked })} />
            <span>I agree that the text of the announcements and assignments I choose to analyze is sent to Anthropic. Nothing is sent until I press an AI button.</span>
          </label>
        </>
      )}
      <div className="row">
        <button type="button" disabled={s.provider === 'anthropic' && !s.cloudConsent} onClick={save}>Save AI settings</button>
        {editing && <button type="button" className="secondary" onClick={() => { setDraft(null); setEditing(false); }}>Cancel</button>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
}
