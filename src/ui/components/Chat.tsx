import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { ChangeProposal, ConfirmedRecord } from '../../core/types';
import { isDocumentReply, looksLikeMaterial, type ChatMessage } from '../../core/chat';
import { aiReady } from '../../core/ai';
import { completeAi, describeImage, embedAi } from '../aiClient';
import { guessIntent, modelFor, modelLabel } from '../../core/models';
import { readFileBytes } from './AddInfo';
import { errorMessage } from '../format';
import { Hint } from './Guide';
import { FoundSources, SavedSources } from './References';
import { scholarGet } from '../scholarClient';
import { pickTools, TOOLS, toolInfo } from '../../core/tools';
import type { ToolResult } from '../../core/service';
import { buildDocx, docFileName } from '../../core/docxWriter';
import { saveDocx } from '../exporter';
import { titlePageLines } from './TitlePage';
import type { AcademicDate } from '../../core/types';

const WRITE_PROMPT = 'Write the complete, submission ready draft for this assignment as a paper in markdown: a # title, ## headings where the brief asks for sections, plain paragraphs in first person from my own notes and anything I pasted in this chat, and a final # References section that lists only my saved sources. Follow the word count and every requirement in the brief. If you cannot write it well without a personal example or notes from me, ask me for exactly what you need instead of writing it.';

/** Text before a line of three dashes is the document; anything after is the assistant's notes. */
const documentPart = (t: string) => t.split(/\n-{3,}\s*\n/)[0].trim();

const PHASES = [
  [0, 'Reading your course material'],
  [4, 'Thinking it through'],
  [10, 'Writing the answer'],
  [25, 'Still working. Longer answers can take a minute'],
] as const;

function Thinking({ label }: { label: string | null }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const phase = label ?? [...PHASES].reverse().find(([s]) => secs >= s)?.[1] ?? PHASES[0][1];
  return (
    <div className="bubble assistant thinking" role="status" aria-live="polite">
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{phase}…</span>
      <span className="muted small">{secs}s</span>
    </div>
  );
}

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
    route: await service.routeSummary(),
  }), [version]);

  const [code, setCode] = useState<string>(startCode ?? '');
  const [assignmentId, setAssignmentId] = useState<string>(startAssignment ?? '');
  // One saved chat per course, plus one for all courses. The assignment you pick only adds context.
  const key = code || 'all';
  const { data: stored } = useAsync(() => service.chatHistory(key), [key]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asQuestion, setAsQuestion] = useState(false);
  const [titlePageOn, setTitlePageOn] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); }, [key]);
  useEffect(() => { if (stored) setMessages(stored); }, [stored, key]);
  const { data: threads } = useAsync(() => service.chatThreads(['all', ...(base?.courses ?? []).map((c) => c.code)]), [version, messages.length, base]);
  useEffect(() => { if (typeof end.current?.scrollIntoView === 'function') end.current.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);
  useEffect(() => { if (base && !code && base.courses.length === 1) setCode(base.courses[0].code); }, [base, code]);

  if (!base) return <p className="muted">Loading…</p>;
  const ready = aiReady(base.ai);
  const courseAssignments = base.assignments.filter((a) => !code || a.fields.courseCode === code);
  const focus = base.assignments.find((a) => a.id === assignmentId) ?? null;
  const material = looksLikeMaterial(text) && !asQuestion;

  const makeDoc = async (content: string, withTitlePage: boolean) => {
    try {
      const body = documentPart(content);
      const first = /^#\s+(.+)/m.exec(body)?.[1]?.replace(/\*+/g, '').trim() ?? String(focus?.fields.title ?? 'Assignment draft');
      let titlePage;
      if (withTitlePage) {
        const course = (await service.repository.listRecords('course')).find((c) => c.fields.code === (focus?.fields.courseCode ?? code)) ?? null;
        const uni = (await service.repository.listRecords('university'))[0] ?? null;
        titlePage = titlePageLines({ title: first, student: (await service.student()).name, university: (uni?.fields.name as string | null) ?? null, course, due: (focus?.fields.dueDate as AcademicDate | null) ?? null })
          .filter((l) => l.text).map((l) => ({ text: l.text, bold: l.bold }));
      }
      const path = await saveDocx(docFileName(first), buildDocx(withTitlePage ? body.replace(/^#\s+.+\n?/, '') : body, { titlePage }));
      toast(`Saved Word document: ${path}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const push = async (next: ChatMessage[]) => { setMessages(next); await service.saveChatHistory(key, next); };
  const msg = (m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage => ({ id: uid(), at: new Date().toISOString(), ...m });

  const titles = base.assignments.map((r) => String(r.fields.title));
  const roleName = (t: 'assignment' | 'general', provider?: string) => `${t === 'assignment' ? 'assignment analysis' : 'everyday chat'}${provider === 'ollama' ? ' (free, on this computer)' : ''}`;

  /** One model written answer, with the model named while it works and on the reply. */
  const answer = async (list: ChatMessage[], prompt: string, task: 'assignment' | 'general', used: ToolResult[] = []) => {
    const picked = await service.pickFor(task === 'assignment' ? 'assignment' : 'chat');
    setBusy(`${task === 'assignment' ? 'Working on your assignment' : 'Thinking'} with ${modelLabel(picked.model)}`);
    const r = await service.chatReply(key, code || null, assignmentId || null, prompt, completeAi, today, { task, embed: embedAi, tools: used });
    const shown = [...used.map((t) => ({ id: t.id, label: t.label, note: t.note })), ...(r.passages ? [{ id: 'search_material', label: toolInfo('search_material').label, note: `${r.passages} passage${r.passages === 1 ? '' : 's'}, by ${r.search === 'meaning' ? 'meaning' : 'keywords'}` }] : [])];
    const works = used.flatMap((t) => t.works ?? []);
    const next = [...list, msg({ role: 'assistant', content: r.text.trim(), model: r.model, provider: r.provider, task: r.task, tools: shown.length ? shown : undefined, works: works.length ? works : undefined })];
    await push(next);
    return next;
  };

  /** Save pasted or attached material into its course, once, and explain what happened. */
  const intake = async (list: ChatMessage[], target: string, inputs: { text?: string; files?: { name: string; bytes: Uint8Array }[] }, task: 'assignment' | 'general') => {
    setBusy('Sorting what you gave me…');
    if (target !== code) setCode(target);
    const r = await service.chatIntake(target, inputs);
    list = [...list, msg({ role: 'assistant', content: r.reply, kind: 'intake', proposalIds: r.proposalIds })];
    await push(list);
    refresh();
    if (r.announcementIds.length && ready) {
      for (const id of r.announcementIds) {
        setBusy(`Reading the announcement with ${modelLabel((await service.pickFor('read')).model)}`);
        const note = await service.analyzeAnnouncement(id, completeAi);
        const actions = (Array.isArray(note.fields.actions) ? note.fields.actions : []).map((a) => { try { return (JSON.parse(String(a)) as { text: string; due: string | null }); } catch { return { text: String(a), due: null }; } });
        const body = [String(note.fields.summary), actions.length ? `\nWhat to do:\n${actions.map((a) => `• ${a.text}${a.due ? ` (${a.due})` : ''}`).join('\n')}` : '', (note.fields.cautions as string[] | undefined)?.length ? `\nEasy to miss:\n${(note.fields.cautions as string[]).map((c) => `• ${c}`).join('\n')}` : ''].join('\n').trim();
        list = [...list, msg({ role: 'assistant', content: body, noteId: note.id, model: (await service.pickFor('read')).model, task: 'general' })];
        await push(list);
      }
      refresh();
    } else if (r.announcementIds.length) {
      list = [...list, msg({ role: 'assistant', content: 'It is saved under Announcements. Turn on the AI assistant in Semester setup and I will also tell you what it asks you to do.' })];
      await push(list);
    }
    if (task === 'assignment' && ready) {
      list = await answer(list, 'I just added assignment material. In three or four short lines: what is required, how it is scored, and what I should read or do first?', 'assignment');
    }
    return list;
  };

  const words = (l: string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`);

  /** Run the tools a question needs, then answer. Assignment analysis waits for the full context unless the student says to go ahead. */
  const respond = async (list: ChatMessage[], input: string, task: 'assignment' | 'general', override: boolean, anyway: boolean) => {
    if (task === 'assignment' && !override && !anyway) {
      const c = await service.assignmentContext(code || null, assignmentId || null, false);
      if (c.blocking) {
        list = [...list, msg({ role: 'assistant', kind: 'ask', ask: 'context', pending: input, content: `Before I analyze this with Claude I want the full picture. I have ${c.have.length ? words(c.have) : 'nothing saved for it yet'}, and I am missing ${words(c.missing)}. Add them for a better answer, or ask anyway.` })];
        await push(list);
        return;
      }
    }
    const used: ToolResult[] = [];
    if (!override) {
      for (const call of pickTools(input, focus ? String(focus.fields.title) : null)) {
        setBusy(`Using ${toolInfo(call.id).label}…`);
        try { used.push(await service.runTool(call, { code: code || null, today, fetcher: scholarGet })); }
        catch (e) { used.push({ id: call.id, label: toolInfo(call.id).label, note: 'Could not run', text: `The ${toolInfo(call.id).label} tool failed: ${errorMessage(e)}. Tell the student it did not work and what to try.` }); }
      }
    }
    await answer(list, input, task, used);
  };

  const askAnyway = async (m: ChatMessage) => {
    if (busy !== null || !m.pending) return;
    setError(null);
    try { await respond(messages.filter((x) => x.id !== m.id), m.pending, 'assignment', false, true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const send = async (override?: { prompt: string; shown: string }, decided?: { text: string; task?: 'assignment' | 'general'; termOk?: boolean }) => {
    const input = decided ? decided.text : override ? override.prompt : text.trim();
    if (!input || busy !== null) return;
    setError(null);
    if (!override && !decided) setText('');
    setAsQuestion(false);
    let list = decided ? messages.filter((m) => m.kind !== 'ask') : [...messages, msg({ role: 'user', content: override ? override.shown : preview(input) })];
    await push(list);
    try {
      const paste = !override && (decided ? true : looksLikeMaterial(input) && !asQuestion);
      if (paste) {
        if (!decided?.termOk) {
          const mismatch = await service.termMismatch(input);
          if (mismatch) {
            list = [...list, msg({ role: 'assistant', kind: 'ask', ask: 'term', pending: input, content: `This says ${mismatch.found.join(' and ')}, but your semester is ${mismatch.semester}. Is it for ${mismatch.semester}? I will not save it until you tell me.` })];
            await push(list);
            return;
          }
        }
        const intent = decided?.task ?? guessIntent(input, titles);
        if (intent === 'unsure') {
          list = [...list, msg({ role: 'assistant', kind: 'ask', ask: 'assignment', pending: input, content: 'Is this about an assignment, or something else, like an announcement, the syllabus or general course information? I use a stronger model for assignments.' })];
          await push(list);
          return;
        }
        setBusy('Working out which course this is for…');
        const target = await service.courseFor(input, code || null);
        if (!target) {
          list = [...list, msg({ role: 'assistant', content: 'I could not tell which course this belongs to. Choose the course at the top, then paste it again.' })];
          await push(list);
          return;
        }
        await intake(list, target, { text: input }, intent);
      } else {
        const task = override ? 'assignment' : assignmentId ? 'assignment' : guessIntent(input, titles) === 'assignment' ? 'assignment' : 'general';
        await respond(list, input, task as 'assignment' | 'general', !!override, false);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length || busy !== null) return;
    setError(null);
    const picked = await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, bytes: await readFileBytes(f), image: /\.(png|jpe?g)$/i.test(f.name) })));
    let list = [...messages, msg({ role: 'user', content: `Attached: ${picked.map((p) => p.name).join(', ')}` })];
    await push(list);
    try {
      if (!code) {
        list = [...list, msg({ role: 'assistant', content: 'Choose the course at the top first, then attach the file again so I save it in the right place.' })];
        await push(list);
        return;
      }
      const docs = picked.filter((p) => !p.image);
      const imgs = picked.filter((p) => p.image);
      if (docs.length) list = await intake(list, code, { files: docs }, 'general');
      for (const im of imgs) {
        const vision = modelFor(base.ai, 'vision');
        if (!vision) {
          list = [...list, msg({ role: 'assistant', content: `To read ${im.name} I need an image model on this computer. Set one up in Semester setup, under AI assistant, in the "Image model" row. Nothing is uploaded; it runs locally.` })];
          await push(list);
          continue;
        }
        setBusy(`Reading ${im.name} with ${modelLabel(vision)}`);
        const seen = await describeImage(vision, base.ai.ollamaUrl, im.bytes, 'Transcribe all the text in this screenshot exactly as written, keeping headings, due dates, point values and table rows on their own lines. Do not add anything.');
        list = [...list, msg({ role: 'assistant', content: 'I read the image. Here is the text I found:\n\n' + seen.trim(), model: vision, task: 'general' })];
        await push(list);
        const mismatch = await service.termMismatch(seen);
        if (mismatch) {
          list = [...list, msg({ role: 'assistant', kind: 'ask', ask: 'term', pending: seen, content: `The screenshot says ${mismatch.found.join(' and ')}, but your semester is ${mismatch.semester}. Is it for ${mismatch.semester}? I will not save it until you tell me.` })];
          await push(list);
          continue;
        }
        list = await intake(list, code, { text: seen }, guessIntent(seen, titles) === 'assignment' ? 'assignment' : 'general');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <nav className="chat-threads" aria-label="Chats by course">
        <h2>Chats</h2>
        {[{ code: '', name: 'Questions about any course' }, ...base.courses].map((t) => {
          const th = threads?.[t.code || 'all'];
          return (
            <button key={t.code || 'all'} type="button" className={`thread ${code === t.code ? 'on' : ''}`} aria-current={code === t.code ? 'true' : undefined} disabled={busy !== null} onClick={() => { setCode(t.code); setAssignmentId(''); }}>
              <strong>{t.code || 'All courses'}</strong>
              <span className="thread-name">{t.name}</span>
              <span className="thread-last">{th?.last || 'No messages yet'}</span>
            </button>
          );
        })}
      </nav>
      <div className="chat-main">
      <Hint id="chat" />
      <header className="chat-head">
        <div>
          <h1 id="chat-title">{code ? `Chat · ${code}` : 'Chat'}</h1>
        </div>
        <span className={`chat-ai ${ready ? 'on' : 'off'}`}>
          {ready ? `Everyday: ${base.route.chat ?? 'not set up'} · Assignments: ${base.route.assignment ?? 'needs Claude'}` : <button type="button" className="link" onClick={() => go({ name: 'setup' })}>Turn on the AI assistant →</button>}
        </span>
      </header>

      <div className="chat-focus">
        <label className="chat-course-select">Course
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

      <div className="chat-tools" aria-label="Tools the chat can use">
        <span className="muted small">Tools</span>
        {TOOLS.map((t) => <span key={t.id} className="tool-chip" tabIndex={0} title={`${t.what} ${t.where}`}>{t.label}</span>)}
        {assignmentId && <SavedSources assignmentId={assignmentId} />}
      </div>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Try one of these.</p>
            <ul>
              <li>Paste an announcement. I will save it once and tell you what it asks you to do.</li>
              <li>Choose an assignment above, then ask what you need to read and how it is scored.</li>
              <li>Ask "what is due this week?" or "find sources on servant leadership". I use a tool and show you what it found.</li>
              <li>Paste your own notes and ask me to turn them into a clean draft.</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role} ${m.kind ?? ''}`}>
            <div className="bubble-text">{m.content}</div>
            {m.kind === 'ask' && m.pending && m.ask === 'term' && (
              <div className="bubble-actions">
                <button type="button" disabled={busy !== null} onClick={() => void send(undefined, { text: m.pending as string, termOk: true })}>Yes, it is for my semester</button>
                <button type="button" className="secondary" disabled={busy !== null} onClick={async () => { await push([...messages.filter((x) => x.id !== m.id), msg({ role: 'assistant', content: 'Okay, I did not save it. If your semester changed, update it in Semester setup first.' })]); }}>No, it is another semester</button>
              </div>
            )}
            {m.kind === 'ask' && m.pending && m.ask === 'context' && (
              <div className="bubble-actions">
                <button type="button" disabled={busy !== null} onClick={() => void askAnyway(m)}>Ask anyway</button>
                <button type="button" className="secondary" onClick={() => { const c = code || String(focus?.fields.courseCode ?? ''); if (c) go({ name: 'course', code: c, tab: 'add' }); else toast('Choose a course first'); }}>Add material</button>
              </div>
            )}
            {m.kind === 'ask' && m.pending && m.ask === 'assignment' && (
              <div className="bubble-actions">
                <button type="button" disabled={busy !== null} onClick={() => void send(undefined, { text: m.pending as string, task: 'assignment', termOk: true })}>It is about an assignment</button>
                <button type="button" className="secondary" disabled={busy !== null} onClick={() => void send(undefined, { text: m.pending as string, task: 'general', termOk: true })}>Something else</button>
              </div>
            )}
            {m.role === 'assistant' && m.model && <div className="model-caption muted small">{modelLabel(m.model)} · {roleName(m.task ?? 'general', m.provider)}</div>}
            {m.tools && m.tools.length > 0 && <div className="tool-used muted small">{m.tools.map((t) => <span key={t.id} className="tool-chip" title={toolInfo(t.id as never).what}>{t.label}: {t.note}</span>)}</div>}
            {m.works && m.works.length > 0 && <FoundSources works={m.works} assignmentId={assignmentId} />}
            {m.kind === 'intake' && m.proposalIds && m.proposalIds.length > 0 && <ProposalCard ids={m.proposalIds} />}
            {m.role === 'assistant' && !m.kind && m.model && (
              <div className="bubble-actions">
                {isDocumentReply(m.content) && <button type="button" className="secondary small" onClick={() => void makeDoc(m.content, titlePageOn)}>Download as Word document</button>}
                <button type="button" className="link" onClick={() => { void navigator.clipboard?.writeText(m.content); toast('Copied'); }}>copy</button>
                {assignmentId && !m.noteId && <button type="button" className="link" onClick={async () => { await service.saveDraft(assignmentId, m.content); refresh(); toast('Saved with the assignment'); }}>save with this assignment</button>}
              </div>
            )}
          </div>
        ))}
        {busy !== null && <Thinking label={busy || null} />}
        <div ref={end} />
      </div>

      <div className="chat-dock">
        {error && <p role="alert" className="error">{error}</p>}
        {material && <p className="chat-hint small">This looks like course material. It will be sorted into {code || 'the matching course'} and saved once. <button type="button" className="link" onClick={() => setAsQuestion(true)}>send it as a question instead</button></p>}
        {focus && (
          <div className="chat-write">
            <button type="button" disabled={busy !== null || !ready} onClick={() => void send({ prompt: WRITE_PROMPT, shown: `Write ${String(focus.fields.title)} as a document` })}>Write this assignment as a document</button>
            <label className="inline"><input type="checkbox" checked={titlePageOn} onChange={(e) => setTitlePageOn(e.target.checked)} /> Include an APA title page</label>
            <span className="muted small">Uses your notes, the brief and your saved sources. Download it as Word from the answer.</span>
          </div>
        )}
        <div className="chat-compose">
          <textarea
            aria-label="Message"
            rows={3}
            value={text}
            placeholder={focus ? `Ask about ${String(focus.fields.title)}, or paste notes to polish…` : 'Ask a question, or paste something from Canvas…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          />
          <div className="chat-buttons">
            <label className="attach secondary-label" title="Attach a PDF, Word file, text file or screenshot">
              Attach
              <input type="file" multiple accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} aria-label="Attach files" />
            </label>
            <button type="button" className="chat-send" disabled={busy !== null || !text.trim()} onClick={() => void send()}>Send</button>
          </div>
        </div>
        <p className="muted small">Cmd+Enter (Ctrl+Enter on Windows) sends. Answers come from your saved material; check anything you will submit.</p>
      </div>
      </div>
    </section>
  );
}
