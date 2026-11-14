import { useId, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { ConfirmedRecord } from '../../core/types';
import { ANTHROPIC_MODELS, OPENAI_MODELS, aiReady, isCloud, type AiProvider, type AiSettings, type BriefingAction } from '../../core/ai';
import { completeAi, hasSecret, setSecret } from '../aiClient';
import { CLOUD_SETUP, DEFAULT_EMBED_TAG, DEFAULT_LOCAL_TAG, DEFAULT_VISION_TAG, DEFAULT_WRITING_TAG, EMBED_MODELS, HELPER_MODELS, LOCAL_MODELS, ROLE_INFO, modelFor, modelLabel, pullCommand, stars, type Role } from '../../core/models';
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
      <p style={{ whiteSpace: 'pre-wrap' }}>{String(note.fields.summary)}</p>
      {actions.length > 0 && note.fields.kind === 'syllabus' && (
        <>
          <h4>Key facts</h4>
          <dl className="saved-values">{actions.map((a, i) => { const [k, ...v] = a.text.split(': '); return <div key={i}><dt>{k}</dt><dd>{v.join(': ')}</dd></div>; })}</dl>
        </>
      )}
      {actions.length > 0 && note.fields.kind !== 'syllabus' && (
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
export const runSyllabus = (service: ReturnType<typeof useApp>['service'], id: string) => service.organizeSyllabus(id, completeAi);
export const runAssignment = (service: ReturnType<typeof useApp>['service'], id: string) => service.analyzeAssignment(id, completeAi);

/* ---------- settings (Semester setup step 05) ---------- */

const PROVIDERS: { id: AiProvider; label: string; help: string }[] = [
  { id: 'none', label: 'Off', help: 'No AI. Everything else works as before.' },
  { id: 'ollama', label: 'Free local model (Ollama)', help: 'Free and private. Runs on this computer; nothing leaves it. Pick a model below, then press Set up.' },
  { id: 'openai', label: 'OpenAI (ChatGPT models)', help: 'Needs an API key from platform.openai.com (paid per use). Material you analyze or paste into Chat is sent to OpenAI.' },
  { id: 'anthropic', label: 'Claude (Anthropic API)', help: 'Needs an API key from console.anthropic.com (paid per use). Material you analyze or paste into Chat is sent to Anthropic.' },
];

const defaultModel = (p: AiProvider) => (p === 'ollama' ? DEFAULT_LOCAL_TAG : p === 'anthropic' ? ANTHROPIC_MODELS[0].id : p === 'openai' ? OPENAI_MODELS[0].id : '');
const providerName = (p: AiProvider) => (p === 'openai' ? 'OpenAI' : 'Anthropic');

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <span className="info-tip">
      <button type="button" className="info-btn" aria-label={label} aria-describedby={id}>i</button>
      <span role="tooltip" id={id} className="info-bubble">{children}</span>
    </span>
  );
}

function RoleRow({ role, value, options, none, onChange, open, onSetup }: {
  role: Role; value: string; options: { tag: string; name: string; about: string; size: string; stars: number }[]; none: string;
  onChange: (tag: string) => void; open: boolean; onSetup: (tag: string) => void;
}) {
  const info = ROLE_INFO[role];
  const chosen = options.find((o) => o.tag === value);
  return (
    <div className="role-row">
      <div className="role-head">
        <strong>{info.label}</strong>
        <InfoTip label={`About the ${info.label}`}>
          <b>{info.label}</b>
          <span>{info.hint}</span>
          {chosen && <span>{chosen.name}: {chosen.about} Quality <span aria-label={`${chosen.stars} out of 5`}>{stars(chosen.stars)}</span>. Download {chosen.size}.</span>}
        </InfoTip>
        <span className="muted small">{info.job}</span>
      </div>
      <div className="row">
        <select aria-label={info.label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{none}</option>
          {options.map((o) => <option key={o.tag} value={o.tag}>{o.name} ({o.size})</option>)}
        </select>
        {value && <button type="button" className="secondary small" onClick={() => { void navigator.clipboard?.writeText(pullCommand(value)); onSetup(value); }}>Set up</button>}
      </div>
      {open && value && (
        <ol className="setup-steps small">
          <li>Install Ollama from ollama.com and open it (once).</li>
          <li>In Terminal (Mac) or PowerShell (Windows) run <code>{pullCommand(value)}</code>. It is copied for you.</li>
          <li>Come back and press Save AI settings.</li>
        </ol>
      )}
    </div>
  );
}

export function AiSettingsCard() {
  const { service, version, refresh } = useApp();
  const { data } = useAsync(async () => ({ s: await service.aiSettings(), keys: { anthropic: await hasSecret('anthropic'), openai: await hasSecret('openai') } }), [version]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  if (!data) return null;
  const s = draft ?? data.s;
  const cloud = isCloud(s.provider);
  const hasKey = s.provider === 'anthropic' || s.provider === 'openai' ? data.keys[s.provider] : false;
  const showForm = editing || data.s.provider === 'none';

  if (!showForm) {
    const saved = isCloud(data.s.provider) ? data.keys[data.s.provider as 'anthropic' | 'openai'] : false;
    return (
      <>
        <dl className="saved-values">
          <div><dt>Provider</dt><dd>{PROVIDERS.find((p) => p.id === data.s.provider)?.label}</dd></div>
          <div><dt>Everyday model</dt><dd className="mono small">{modelLabel(data.s.model)}</dd></div>
          {data.s.provider === 'ollama' && <>
            <div><dt>Assignment model</dt><dd className="mono small">{modelLabel(modelFor(data.s, 'writing'))}</dd></div>
            <div><dt>Image model</dt><dd className={modelFor(data.s, 'vision') ? 'mono small' : 'none'}>{modelFor(data.s, 'vision') ? modelLabel(modelFor(data.s, 'vision')) : 'Not set up'}</dd></div>
            <div><dt>Search model</dt><dd className={modelFor(data.s, 'embed') ? 'mono small' : 'none'}>{modelFor(data.s, 'embed') ? modelLabel(modelFor(data.s, 'embed')) : 'Keywords only'}</dd></div>
          </>}
          {isCloud(data.s.provider) && <div><dt>API key</dt><dd className={saved ? '' : 'none'}>{saved ? 'Saved in your keychain' : 'Not saved'}</dd></div>}
        </dl>
        <button type="button" className="modify" onClick={() => { setDraft(data.s); setEditing(true); }}>Modify</button>
      </>
    );
  }

  const save = async () => {
    setError(null);
    try {
      if (cloud && key.trim()) await setSecret(s.provider as 'anthropic' | 'openai', key.trim());
      if (cloud && !key.trim() && !hasKey) throw new Error(`Paste your ${providerName(s.provider)} API key.`);
      await service.saveAiSettings({ ...s, model: s.model || defaultModel(s.provider) });
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
      <p className="muted small">The assistant answers in Chat and reads announcements and assignments to write down what you need to do. It never changes dates or items.</p>
      <div className="kind-options">
        {PROVIDERS.map((p) => (
          <label key={p.id} className={`kind-option ${s.provider === p.id ? 'on' : ''}`}>
            <input type="radio" name="ai-provider" checked={s.provider === p.id} onChange={() => setDraft({ ...s, provider: p.id, model: defaultModel(p.id), ...(p.id === 'ollama' ? { writingModel: s.writingModel || DEFAULT_WRITING_TAG, visionModel: s.visionModel || DEFAULT_VISION_TAG, embedModel: s.embedModel || DEFAULT_EMBED_TAG } : {}) })} />
            <strong>{p.label}</strong>
            <span className="muted small">{p.help}</span>
          </label>
        ))}
      </div>
      {s.provider === 'ollama' && (
        <>
          <h3>Everyday model</h3>
          <div className="model-list" role="radiogroup" aria-label="Free local models">
            {LOCAL_MODELS.map((m) => (
              <div key={m.tag} className={`model-card ${s.model === m.tag ? 'on' : ''}`}>
                <label>
                  <input type="radio" name="ai-model" checked={s.model === m.tag} onChange={() => setDraft({ ...s, model: m.tag })} aria-label={m.name} />
                  <strong>{m.name}</strong>
                  {m.recommended && <span className="pill">{m.recommended}</span>}
                  {m.vision && <span className="pill alt">reads images</span>}
                </label>
                <InfoTip label={`About ${m.name}`}>
                  <b>{m.name}</b>
                  <span className="mono small">{m.hf}</span>
                  <span>Quality for coursework: <span aria-label={`${m.stars} out of 5`}>{stars(m.stars)}</span></span>
                  <span>{m.about}</span>
                  <span>Download {m.size}, about {m.memory}. Licence: {m.licence}.</span>
                </InfoTip>
                <span className="muted small model-best">{m.best}</span>
                <button type="button" className="secondary small" onClick={() => { void navigator.clipboard?.writeText(pullCommand(m.tag)); setSetup(m.tag); }}>Set up</button>
                {setup === m.tag && (
                  <ol className="setup-steps small">
                    <li>Install Ollama from ollama.com (free) and open it.</li>
                    <li>In Terminal (Mac) or PowerShell (Windows) run <code>{pullCommand(m.tag)}</code>. It is copied for you. The download is {m.size}, once.</li>
                    <li>Come back, choose this model and press Save AI settings.</li>
                  </ol>
                )}
              </div>
            ))}
          </div>
          <label>Other model name from Ollama
            <input value={LOCAL_MODELS.some((m) => m.tag === s.model) ? '' : s.model} onChange={(e) => setDraft({ ...s, model: e.target.value })} placeholder="for example mistral" />
          </label>
          <h3>Other jobs, other models</h3>
          <p className="muted small">The app can use a different free model for each job. Each runs on this computer. Pick one, press Set up, and run the command once.</p>
          <RoleRow role="writing" value={s.writingModel ?? ''} none="Same as the everyday model" options={LOCAL_MODELS.filter((m) => !m.vision)} open={setup === 'writing'} onSetup={() => setSetup('writing')} onChange={(tag) => setDraft({ ...s, writingModel: tag })} />
          <RoleRow role="vision" value={s.visionModel ?? ''} none="Not set up (images will not be read)" options={LOCAL_MODELS.filter((m) => m.vision)} open={setup === 'vision'} onSetup={() => setSetup('vision')} onChange={(tag) => setDraft({ ...s, visionModel: tag })} />
          <RoleRow role="embed" value={s.embedModel ?? ''} none="Not set up (search by keywords only)" options={EMBED_MODELS} open={setup === 'embed'} onSetup={() => setSetup('embed')} onChange={(tag) => setDraft({ ...s, embedModel: tag })} />
          <label>Ollama address<input value={s.ollamaUrl} onChange={(e) => setDraft({ ...s, ollamaUrl: e.target.value })} /></label>
          <details className="helper-models">
            <summary>Search and checking models planned for later</summary>
            <ul>{HELPER_MODELS.map((h) => <li key={h.name}><b>{h.name}</b> <span className="mono small">{h.hf}</span> {h.job}</li>)}</ul>
          </details>
        </>
      )}
      {cloud && (
        <>
          <div className="grid">
            <label>Model
              {s.provider === 'anthropic' ? (
                <select value={s.model} onChange={(e) => setDraft({ ...s, model: e.target.value })}>
                  {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              ) : (
                <>
                  <input list="openai-models" value={s.model} onChange={(e) => setDraft({ ...s, model: e.target.value })} />
                  <datalist id="openai-models">{OPENAI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
                </>
              )}
            </label>
            <label>API key {hasKey ? '(saved; paste a new one to replace it)' : ''}
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.provider === 'openai' ? 'sk-…' : 'sk-ant-…'} autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <button type="button" className="secondary small" onClick={() => setSetup(setup === s.provider ? null : s.provider)}>{hasKey ? 'Setup steps' : 'Set up an API key'}</button>
          {setup === s.provider && CLOUD_SETUP.filter((c) => c.provider === s.provider).map((c) => (
            <div key={c.provider} className="setup-steps small">
              <p><b>{c.name}</b> is a paid service. {c.cost} Keys come from <span className="mono">{c.keyPage}</span>.</p>
              <ol>{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          ))}
          <label className="consent">
            <input type="checkbox" checked={s.cloudConsent} onChange={(e) => setDraft({ ...s, cloudConsent: e.target.checked })} />
            <span>I agree that the text of announcements and assignments I analyze, and anything I type or paste into Chat, is sent to {providerName(s.provider)}. Nothing is sent until I press an AI button or send a chat message.</span>
          </label>
        </>
      )}
      <div className="row">
        <button type="button" disabled={cloud && !s.cloudConsent} onClick={save}>Save AI settings</button>
        {editing && <button type="button" className="secondary" onClick={() => { setDraft(null); setEditing(false); }}>Cancel</button>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
}
