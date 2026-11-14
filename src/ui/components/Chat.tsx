import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { ChangeProposal, ConfirmedRecord } from '../../core/types';
import { looksLikeMaterial, type ChatMessage } from '../../core/chat';
import { PROVIDER_NAME, aiReady } from '../../core/ai';
import { completeAi } from '../aiClient';
import { errorMessage } from '../format';

const uid = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const preview = (t: string) => {
  const lines = t.split('\n').length;
  return t.length > 320 || lines > 6 ? `${t.slice(0, 280).trim()}…\n(pasted ${lines} lines)` : t;
};

function ProposalCard({ ids }: { ids: string[] }) {
  const { service, version, refresh, go, toast } = useApp();
  const { data } = useAsync(async () => (await service.repository.listProposals('pending')).filter((p) => ids.includes(p.id)), [version, ids.join(',')]);
  const [busy, setBusy] = useState(false);
  if (!data || data.length === 0) return <p className="muted small">Nothing here is waiting for approval.</p>;
  const label = (p: ChangeProposal) => `${String(p.candidate.fields.title ?? p.key)} — ${p.kind === 'create' ? 'new' : `changed: ${p.changes.map((c) => c.field).join(', ')}`}`;
  return (
    <div className="chat-proposals">
      <ul>{data.slice(0, 8).map((p) => <li key={p.id}>{label(p)}</li>)}{data.length > 8 && <li className="muted">and {data.length - 8} more</li>}</ul>
      <div className="row">
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try { for (const p of data) if (p.kind !== 'conflict') await service.approve(p.id); refresh(); toast('Approved'); } finally { setBusy(false); }
        }}>Approve {data.filter((p) => p.kind !== 'conflict').length}</button>
        <button type="button" className="secondary" onClick={() => go({ name: 'review' })}>Look first in Review</button>
      </div>
    </div>
  );
}

export function Chat({ code: startCode, assignmentId: startAssignment }: { code?: string; assignmentId?: string }) {
  const { service, version, today, go, refresh, toast } = useApp();
  const { data: base } = useAsync(async () => ({
    courses: (await service.repository.listRecords('course')).map((c) => ({ code: String(c.fields.code), name: String(c.fields.name ?? '') })),
    assignments: await service.repository.listRecords('assignment'),
    ai: await service.aiSettings(),
  }), [version]);

  const [code, setCode] = useState<string>(startCode ?? '');
  const [assignmentId, setAssignmentId] = useState<string>(startAssignment ?? '');
  const key = assignmentId || code || 'all';
  const { data: stored } = useAsync(() => service.chatHistory(key), [key]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asQuestion, setAsQuestion] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (stored) setMessages(stored); }, [stored, key]);
  useEffect(() => { if (typeof end.current?.scrollIntoView === 'function') end.current.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);
  useEffect(() => { if (base && !code && base.courses.length === 1) setCode(base.courses[0].code); }, [base, code]);

  if (!base) return <p className="muted">Loading…</p>;
  const ready = aiReady(base.ai);
  const courseAssignments = base.assignments.filter((a) => !code || a.fields.courseCode === code);
  const focus = base.assignments.find((a) => a.id === assignmentId) ?? null;
  const material = looksLikeMaterial(text) && !asQuestion;

  const push = async (next: ChatMessage[]) => { setMessages(next); await service.saveChatHistory(key, next); };
  const msg = (m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage => ({ id: uid(), at: new Date().toISOString(), ...m });

  const send = async () => {
    const input = text.trim();
    if (!input || busy) return;
    setError(null);
    setText('');
    setAsQuestion(false);
    let list = [...messages, msg({ role: 'user', content: preview(input) })];
    await push(list);
    try {
      if (looksLikeMaterial(input) && !asQuestion) {
        setBusy('Sorting what you pasted…');
        const target = await service.courseFor(input, code || null);
        if (!target) {
          list = [...list, msg({ role: 'assistant', content: 'I could not tell which course this belongs to. Choose the course at the top, then paste it again.' })];
          await push(list);
          return;
        }
        if (target !== code) setCode(target);
        const r = await service.chatIntake(target, input);
        list = [...list, msg({ role: 'assistant', content: r.reply, kind: 'intake', proposalIds: r.proposalIds })];
        await push(list);
        refresh();
        if (r.announcementIds.length && ready) {
          setBusy('Reading the announcement…');
          for (const id of r.announcementIds) {
            const note = await service.analyzeAnnouncement(id, completeAi);
            const actions = (Array.isArray(note.fields.actions) ? note.fields.actions : []).map((a) => { try { return (JSON.parse(String(a)) as { text: string; due: string | null }); } catch { return { text: String(a), due: null }; } });
            const body = [String(note.fields.summary), actions.length ? `\nWhat to do:\n${actions.map((a) => `• ${a.text}${a.due ? ` (${a.due})` : ''}`).join('\n')}` : '', (note.fields.cautions as string[] | undefined)?.length ? `\nEasy to miss:\n${(note.fields.cautions as string[]).map((c) => `• ${c}`).join('\n')}` : ''].join('\n').trim();
            list = [...list, msg({ role: 'assistant', content: body, noteId: note.id })];
            await push(list);
          }
          refresh();
        } else if (r.announcementIds.length && !ready) {
          list = [...list, msg({ role: 'assistant', content: 'It is saved under Announcements. Turn on the AI assistant in Semester setup and I will also tell you what it asks you to do.' })];
          await push(list);
        }
      } else {
        setBusy('Thinking…');
        const reply = await service.chatReply(key, code || null, assignmentId || null, input, completeAi, today);
        list = [...list, msg({ role: 'assistant', content: reply.trim() })];
        await push(list);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <header className="chat-head">
        <div>
          <h1 id="chat-title">Chat</h1>
          <p className="muted small">Ask about your courses, or paste anything copied from Canvas. I sort it into the right course and keep it ready for your assignment.</p>
        </div>
        <span className={`chat-ai ${ready ? 'on' : 'off'}`}>
          {ready ? `${PROVIDER_NAME[base.ai.provider]} · ${base.ai.model}` : <button type="button" className="link" onClick={() => go({ name: 'setup' })}>Turn on the AI assistant →</button>}
        </span>
      </header>

      <div className="chat-focus">
        <label>Course
          <select value={code} onChange={(e) => { setCode(e.target.value); setAssignmentId(''); }}>
            <option value="">Any course</option>
            {base.courses.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
          </select>
        </label>
        <label>Working on
          <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} disabled={!courseAssignments.length}>
            <option value="">No specific assignment</option>
            {courseAssignments.map((a: ConfirmedRecord) => <option key={a.id} value={a.id}>{String(a.fields.title)}</option>)}
          </select>
        </label>
        {focus && <button type="button" className="link" onClick={() => go({ name: 'assignment', id: focus.id, section: 'brief' })}>open its brief →</button>}
        {messages.length > 0 && <button type="button" className="link" onClick={async () => { await service.clearChat(key); setMessages([]); }}>clear this chat</button>}
      </div>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Try one of these.</p>
            <ul>
              <li>Paste an announcement. I will save it once and tell you what it asks you to do.</li>
              <li>Choose an assignment above, then ask what you need to read and how it is scored.</li>
              <li>Paste your own notes and ask me to turn them into a clean draft.</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role} ${m.kind ?? ''}`}>
            <div className="bubble-text">{m.content}</div>
            {m.kind === 'intake' && m.proposalIds && m.proposalIds.length > 0 && <ProposalCard ids={m.proposalIds} />}
            {m.role === 'assistant' && !m.kind && (
              <div className="bubble-actions">
                <button type="button" className="link" onClick={() => { void navigator.clipboard?.writeText(m.content); toast('Copied'); }}>copy</button>
                {assignmentId && !m.noteId && <button type="button" className="link" onClick={async () => { await service.saveDraft(assignmentId, m.content); refresh(); toast('Saved with the assignment'); }}>save with this assignment</button>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant pending">{busy}</div>}
        <div ref={end} />
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {material && <p className="chat-hint small">This looks like course material. It will be sorted into {code || 'the matching course'} and saved once. <button type="button" className="link" onClick={() => setAsQuestion(true)}>send it as a question instead</button></p>}
      <div className="chat-compose">
        <textarea
          aria-label="Message"
          rows={3}
          value={text}
          placeholder={focus ? `Ask about ${String(focus.fields.title)}, or paste notes to polish…` : 'Ask a question, or paste something from Canvas…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        />
        <button type="button" className="chat-send" disabled={!!busy || !text.trim()} onClick={() => void send()}>{busy ? '…' : 'Send'}</button>
      </div>
      <p className="muted small">Cmd+Enter (Ctrl+Enter on Windows) sends. Answers come from your saved material; check anything you will submit.</p>
    </section>
  );
}
