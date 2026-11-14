import { useEffect, useId, useState } from 'react';
import { useApp } from '../AppContext';
import { canDownload, installedModels, pullModel, type PullProgress } from '../ollamaClient';
import { useAsync } from '../useAsync';
import type { ConfirmedRecord } from '../../core/types';
import { ANTHROPIC_MODELS, aiReady, normaliseAi, type AiJob, type BriefingAction, type Provider } from '../../core/ai';
import { JOB_INFO, candidates, spentThisMonth, usd } from '../../core/providers';
import { completeAi, hasSecret, setSecret } from '../aiClient';
import { CLOUD_SETUP, DEFAULT_EMBED_TAG, DEFAULT_LOCAL_TAG, DEFAULT_VISION_TAG, DEFAULT_WRITING_TAG, EMBED_MODELS, HELPER_MODELS, LOCAL_MODELS, ROLE_INFO, isInstalled, modelFor, modelLabel, pullCommand, stars, type Role } from '../../core/models';
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

const PROVIDERS: { id: Provider; label: string; help: string }[] = [
  { id: 'ollama', label: 'Free local model (Ollama)', help: 'Free and private. Runs on this computer; nothing leaves it. Pick a model below, then press Download.' },
  { id: 'anthropic', label: 'Claude (Anthropic API)', help: 'Needs an API key from console.anthropic.com (paid per use). Assignments are always analyzed with Claude. Material you analyze or paste is sent to Anthropic.' },
  { id: 'openai', label: 'OpenAI (ChatGPT models)', help: 'Needs an API key from platform.openai.com (paid per use). Used for other jobs when it is the cheapest that fits. Material you analyze or paste is sent to OpenAI.' },
];

const providerName = (p: Provider) => (p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : 'Ollama');

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <span className="info-tip">
      <button type="button" className="info-btn" aria-label={label} aria-describedby={id}>i</button>
      <span role="tooltip" id={id} className="info-bubble">{children}</span>
    </span>
  );
}

const friendly = (status: string) => (/^pulling [0-9a-f]/i.test(status) ? 'downloading' : /^verifying/i.test(status) ? 'checking the file' : /^(writing|removing)/i.test(status) ? 'finishing' : status === 'success' ? 'done' : status || 'starting');

/** Download a model with Ollama after the student confirms; shows progress; shows Installed when it is already here. */
function DownloadButton({ tag, name, size, baseUrl, installed, onDone, onFallback }: {
  tag: string; name: string; size: string; baseUrl: string; installed: string[] | null; onDone: () => void; onFallback: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [p, setP] = useState<PullProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!canDownload()) return <button type="button" className="secondary small" onClick={onFallback}>Set up</button>;
  if (installed && isInstalled(installed, tag)) return <span className="installed" title="Already on this computer">Installed ✓</span>;
  const pct = p && p.total > 0 ? Math.min(100, Math.floor((p.completed / p.total) * 100)) : null;
  const start = async () => {
    setStep('busy'); setErr(null); setP(null);
    try { await pullModel(baseUrl, tag, setP); onDone(); } catch (e) { setErr(errorMessage(e)); } finally { setStep('idle'); }
  };
  return (
    <div className="download">
      {step === 'idle' && <button type="button" className="secondary small" onClick={() => setStep('confirm')}>Download</button>}
      {step === 'confirm' && (
        <div className="download-confirm" role="group" aria-label={`Download ${name}`}>
          <p className="small">Download <b>{name}</b> ({size}) with Ollama on this computer? The app runs <code>{pullCommand(tag)}</code> for you, once. You can keep using the app while it downloads.</p>
          <div className="row">
            <button type="button" className="small" onClick={() => void start()}>Yes, download</button>
            <button type="button" className="secondary small" onClick={() => setStep('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {step === 'busy' && (
        <div className="download-busy" role="status">
          <progress max={100} value={pct ?? undefined} aria-label={`Downloading ${name}`} />
          <span className="small muted">{pct !== null ? `${pct}% · ` : ''}{friendly(p?.status ?? '')}</span>
        </div>
      )}
      {err && <p role="alert" className="error small">{err}</p>}
    </div>
  );
}

function RoleRow({ role, value, options, none, onChange, open, onSetup, baseUrl, installed, onDone }: {
  role: Role; value: string; options: { tag: string; name: string; about: string; size: string; stars: number }[]; none: string;
  onChange: (tag: string) => void; open: boolean; onSetup: (tag: string) => void; baseUrl: string; installed: string[] | null; onDone: () => void;
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
        {value && <DownloadButton tag={value} name={chosen?.name ?? value} size={chosen?.size ?? ''} baseUrl={baseUrl} installed={installed} onDone={onDone} onFallback={() => { void navigator.clipboard?.writeText(pullCommand(value)); onSetup(value); }} />}
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

/** This month's estimated spend per provider, and the optional limit. */
function UsageCard({ s, spent, calls }: { s: ReturnType<typeof normaliseAi>; spent: Record<Provider, number>; calls: Record<Provider, number> }) {
  const rows = (['anthropic', 'openai'] as const).filter((p) => s.enabled[p] || spent[p] > 0);
  return (
    <div className="usage-card">
      <h3>This month</h3>
      {rows.length === 0 && <p className="muted small">Nothing paid is switched on, so nothing is being charged.</p>}
      {rows.map((p) => {
        const limit = s.routing.limits[p];
        return (
          <div key={p} className="usage-row">
            <strong>{providerName(p)}</strong>
            <span className="mono">{usd(spent[p])}</span>
            <span className="muted small">{calls[p]} call{calls[p] === 1 ? '' : 's'}{limit !== null ? ` · limit ${usd(limit)}` : ' · no limit'}{limit !== null && spent[p] >= limit ? ' · reached, using a free local model' : ''}</span>
          </div>
        );
      })}
      <p className="muted small">An estimate from the size of what was sent and received, at each provider's published price. The exact bill is on the provider's own site. Local models are free.</p>
    </div>
  );
}

export function AiSettingsCard() {
  const { service, version, refresh } = useApp();
  const { data } = useAsync(async () => {
    const usage = await service.usageLog();
    return {
      s: await service.aiSettings(),
      keys: { anthropic: await hasSecret('anthropic'), openai: await hasSecret('openai') },
      spent: spentThisMonth(usage, new Date()),
      calls: (() => { const month = new Date().toISOString().slice(0, 7); const c: Record<Provider, number> = { ollama: 0, anthropic: 0, openai: 0 }; for (const e of usage) if (e.at.slice(0, 7) === month) c[e.provider]++; return c; })(),
    };
  }, [version]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof normaliseAi> | null>(null);
  const [keys, setKeys] = useState<{ anthropic: string; openai: string }>({ anthropic: '', openai: '' });
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [recheck, setRecheck] = useState(0);
  const ollamaUrl = (draft ?? data?.s)?.ollamaUrl;
  useEffect(() => {
    if (!ollamaUrl) return;
    let live = true;
    void installedModels(ollamaUrl).then((l) => { if (live) setInstalled(l); });
    return () => { live = false; };
  }, [ollamaUrl, recheck]);
  if (!data) return null;
  const s = draft ?? data.s;
  const anyOn = data.s.enabled.ollama || data.s.enabled.anthropic || data.s.enabled.openai;
  const cloudOn = s.enabled.anthropic || s.enabled.openai;
  const showForm = editing || !anyOn;
  const set = (patch: Partial<ReturnType<typeof normaliseAi>>) => setDraft({ ...s, ...patch });
  const turn = (p: Provider, on: boolean) => {
    const next = { ...s, enabled: { ...s.enabled, [p]: on } };
    if (p === 'ollama' && on) Object.assign(next, { model: s.model || DEFAULT_LOCAL_TAG, writingModel: s.writingModel || DEFAULT_WRITING_TAG, visionModel: s.visionModel || DEFAULT_VISION_TAG, embedModel: s.embedModel || DEFAULT_EMBED_TAG });
    setDraft(next);
  };

  if (!showForm) {
    const names = PROVIDERS.filter((p) => data.s.enabled[p.id]).map((p) => p.label.replace(/ \(.*\)/, ''));
    return (
      <>
        <dl className="saved-values">
          <div><dt>Providers on</dt><dd>{names.join(', ')}</dd></div>
          {data.s.enabled.anthropic && <div><dt>Assignment analysis</dt><dd className="mono small">{modelLabel(data.s.routing.assignmentModel)}</dd></div>}
          {!data.s.enabled.anthropic && <div><dt>Assignment analysis</dt><dd className="none">Needs Claude. Turn it on to analyze assignments.</dd></div>}
          <div><dt>Other jobs</dt><dd>{data.s.routing.mode === 'auto' ? 'Chosen for you: the cheapest model that fits each job' : 'Chosen by you, job by job'}</dd></div>
          {data.s.enabled.ollama && <>
            <div><dt>Everyday local model</dt><dd className="mono small">{modelLabel(data.s.model)}</dd></div>
            <div><dt>Image model</dt><dd className={modelFor(data.s, 'vision') ? 'mono small' : 'none'}>{modelFor(data.s, 'vision') ? modelLabel(modelFor(data.s, 'vision')) : 'Not set up'}</dd></div>
            <div><dt>Search model</dt><dd className={modelFor(data.s, 'embed') ? 'mono small' : 'none'}>{modelFor(data.s, 'embed') ? modelLabel(modelFor(data.s, 'embed')) : 'Keywords only'}</dd></div>
          </>}
          {(['anthropic', 'openai'] as const).filter((p) => data.s.enabled[p]).map((p) => (
            <div key={p}><dt>{providerName(p)} key</dt><dd className={data.keys[p] ? '' : 'none'}>{data.keys[p] ? 'Saved in your keychain' : 'Not saved'}</dd></div>
          ))}
        </dl>
        <UsageCard s={data.s} spent={data.spent} calls={data.calls} />
        <button type="button" className="modify" onClick={() => { setDraft(data.s); setEditing(true); }}>Modify</button>
      </>
    );
  }

  const save = async () => {
    setError(null);
    try {
      for (const p of ['anthropic', 'openai'] as const) {
        if (!s.enabled[p]) continue;
        if (keys[p].trim()) await setSecret(p, keys[p].trim());
        else if (!data.keys[p]) throw new Error(`Paste your ${providerName(p)} API key.`);
      }
      await service.saveAiSettings({ ...s, model: s.enabled.ollama ? s.model || DEFAULT_LOCAL_TAG : s.model });
      setKeys({ anthropic: '', openai: '' });
      setDraft(null);
      setEditing(false);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const pool = candidates(s);
  const manualJobs: AiJob[] = ['chat', 'read', 'review'];

  return (
    <>
      <p className="muted small">The assistant answers in Chat and reads announcements and assignments to write down what you need to do. Turn on as many providers as you like. It never changes dates or items without your approval.</p>
      <div className="kind-options">
        {PROVIDERS.map((p) => (
          <label key={p.id} className={`kind-option ${s.enabled[p.id] ? 'on' : ''}`}>
            <input type="checkbox" checked={s.enabled[p.id]} onChange={(e) => turn(p.id, e.target.checked)} />
            <strong>{p.label}</strong>
            <span className="muted small">{p.help}</span>
          </label>
        ))}
      </div>

      {s.enabled.ollama && (
        <>
          <h3>Everyday model</h3>
          <div className="model-list" role="radiogroup" aria-label="Free local models">
            {LOCAL_MODELS.map((m) => (
              <div key={m.tag} className={`model-card ${s.model === m.tag ? 'on' : ''}`}>
                <div className="model-top">
                  <label className="model-pick">
                    <input type="radio" name="ai-model" checked={s.model === m.tag} onChange={() => set({ model: m.tag })} aria-label={m.name} />
                    <strong>{m.name}</strong>
                  </label>
                  {m.recommended && <span className="pill">{m.recommended}</span>}
                  {m.vision && <span className="pill alt">reads images</span>}
                  <span className="grow" />
                  <InfoTip label={`About ${m.name}`}>
                    <b>{m.name}</b>
                    <span className="mono small">{m.hf}</span>
                    <span>Quality for coursework: <span aria-label={`${m.stars} out of 5`}>{stars(m.stars)}</span></span>
                    <span>{m.about}</span>
                    <span>Download {m.size}, about {m.memory}. Licence: {m.licence}.</span>
                  </InfoTip>
                </div>
                <div className="model-foot">
                  <span className="muted small model-best">{m.best}</span>
                  <DownloadButton tag={m.tag} name={m.name} size={m.size} baseUrl={s.ollamaUrl} installed={installed} onDone={() => setRecheck((n) => n + 1)} onFallback={() => { void navigator.clipboard?.writeText(pullCommand(m.tag)); setSetup(m.tag); }} />
                </div>
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
            <input value={LOCAL_MODELS.some((m) => m.tag === s.model) ? '' : s.model} onChange={(e) => set({ model: e.target.value })} placeholder="for example mistral" />
          </label>
          <h3>Other jobs, other local models</h3>
          <p className="muted small">The app can use a different free model for each job. Each runs on this computer. Pick one and press Download; the app gets it for you after you confirm.</p>
          <RoleRow role="writing" value={s.writingModel ?? ''} none="Same as the everyday model" options={LOCAL_MODELS.filter((m) => !m.vision)} open={setup === 'writing'} onSetup={() => setSetup('writing')} baseUrl={s.ollamaUrl} installed={installed} onDone={() => setRecheck((n) => n + 1)} onChange={(tag) => set({ writingModel: tag })} />
          <RoleRow role="vision" value={s.visionModel ?? ''} none="Not set up (images will not be read)" options={LOCAL_MODELS.filter((m) => m.vision)} open={setup === 'vision'} onSetup={() => setSetup('vision')} baseUrl={s.ollamaUrl} installed={installed} onDone={() => setRecheck((n) => n + 1)} onChange={(tag) => set({ visionModel: tag })} />
          <RoleRow role="embed" value={s.embedModel ?? ''} none="Not set up (search by keywords only)" options={EMBED_MODELS} open={setup === 'embed'} onSetup={() => setSetup('embed')} baseUrl={s.ollamaUrl} installed={installed} onDone={() => setRecheck((n) => n + 1)} onChange={(tag) => set({ embedModel: tag })} />
          <label>Ollama address<input value={s.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} /></label>
          <details className="helper-models">
            <summary>Search and checking models planned for later</summary>
            <ul>{HELPER_MODELS.map((h) => <li key={h.name}><b>{h.name}</b> <span className="mono small">{h.hf}</span> {h.job}</li>)}</ul>
          </details>
        </>
      )}

      {(['anthropic', 'openai'] as const).filter((p) => s.enabled[p]).map((p) => (
        <div key={p} className="provider-box">
          <h3>{p === 'anthropic' ? 'Claude' : 'OpenAI'}</h3>
          <div className="grid">
            <label>API key {data.keys[p] ? '(saved; paste a new one to replace it)' : ''}
              <input type="password" aria-label={`${providerName(p)} API key`} value={keys[p]} onChange={(e) => setKeys({ ...keys, [p]: e.target.value })} placeholder={p === 'openai' ? 'sk-…' : 'sk-ant-…'} autoComplete="off" spellCheck={false} />
            </label>
            <label>Monthly limit in dollars (optional)
              <input type="number" min="0" step="1" aria-label={`${providerName(p)} monthly limit`} value={s.routing.limits[p] ?? ''} placeholder="No limit"
                onChange={(e) => set({ routing: { ...s.routing, limits: { ...s.routing.limits, [p]: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } } })} />
            </label>
          </div>
          {p === 'anthropic' && (
            <label>Claude model for analyzing assignments
              <select value={s.routing.assignmentModel} onChange={(e) => set({ routing: { ...s.routing, assignmentModel: e.target.value } })}>
                {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="secondary small" onClick={() => setSetup(setup === p ? null : p)}>{data.keys[p] ? 'Setup steps' : 'Set up an API key'}</button>
          {setup === p && CLOUD_SETUP.filter((c) => c.provider === p).map((c) => (
            <div key={c.provider} className="setup-steps small">
              <p><b>{c.name}</b> is a paid service. {c.cost} Keys come from <span className="mono">{c.keyPage}</span>.</p>
              <ol>{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          ))}
        </div>
      ))}
      {cloudOn && (
        <>
          <p className="muted small">On a Mac, the first time the app uses your key, macOS asks for your Mac login password to open the keychain. That is your Mac asking, not the app. Press Always Allow and it will not ask again for this version of the app; a new version asks once more.</p>
          <label className="consent">
            <input type="checkbox" checked={s.cloudConsent} onChange={(e) => set({ cloudConsent: e.target.checked })} />
            <span>I agree that the text of announcements and assignments I analyze, and anything I type or paste into Chat, is sent to the paid providers I turned on. Nothing is sent until I press an AI button or send a chat message.</span>
          </label>
        </>
      )}

      {pool.length > 0 && (
        <div className="routing-box">
          <h3>Which model does which job</h3>
          <p className="muted small">Analyzing an assignment always uses Claude, and only after the syllabus, rules and brief are gathered. For everything else:</p>
          <div className="kind-options">
            <label className={`kind-option ${s.routing.mode === 'auto' ? 'on' : ''}`}>
              <input type="radio" name="ai-routing" checked={s.routing.mode === 'auto'} onChange={() => set({ routing: { ...s.routing, mode: 'auto' } })} />
              <strong>Automatic</strong>
              <span className="muted small">The app picks the cheapest model that is good enough for each job. Free local models come first.</span>
            </label>
            <label className={`kind-option ${s.routing.mode === 'manual' ? 'on' : ''}`}>
              <input type="radio" name="ai-routing" checked={s.routing.mode === 'manual'} onChange={() => set({ routing: { ...s.routing, mode: 'manual' } })} />
              <strong>I choose</strong>
              <span className="muted small">Pick the model for each job yourself.</span>
            </label>
          </div>
          {s.routing.mode === 'manual' && manualJobs.map((j) => {
            const chosen = s.routing.manual[j];
            return (
              <label key={j}>{JOB_INFO[j].label}
                <select value={chosen ? `${chosen.provider}|${chosen.model}` : ''} onChange={(e) => {
                  const manual = { ...s.routing.manual };
                  if (!e.target.value) delete manual[j];
                  else { const [provider, model] = e.target.value.split('|'); manual[j] = { provider: provider as Provider, model }; }
                  set({ routing: { ...s.routing, manual } });
                }}>
                  <option value="">Automatic for this job</option>
                  {pool.map((m) => <option key={`${m.provider}|${m.id}`} value={`${m.provider}|${m.id}`}>{m.label}{m.provider === 'ollama' ? ' (free, local)' : ` (${providerName(m.provider)})`}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      <UsageCard s={s} spent={data.spent} calls={data.calls} />
      <div className="row">
        <button type="button" disabled={cloudOn && !s.cloudConsent} onClick={save}>Save AI settings</button>
        {editing && <button type="button" className="secondary" onClick={() => { setDraft(null); setEditing(false); }}>Cancel</button>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
}
