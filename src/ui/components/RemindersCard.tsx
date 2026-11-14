import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { PushSettings } from '../../core/schedule';
import { prettyDate } from '../../core/schedule';
import { hasSecret, setSecret } from '../aiClient';
import { notifyDesktop, sendEmail } from '../notifier';
import { errorMessage } from '../format';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ h, label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? 'PM' : 'AM'}` }));

/** Semester setup step 06: where and when reminders go. Addresses stay on this computer; the app password is kept in the keychain. */
export function RemindersCard() {
  const { service, version, refresh, today, toast } = useApp();
  const { data } = useAsync(async () => {
    const s = await service.pushSettings();
    const plan = await service.reminderPlan();
    const next = plan.find((r) => r.sendOn >= today);
    const day = next ? plan.filter((r) => r.sendOn === next.sendOn) : [];
    return { s, hasToken: await hasSecret('gmail'), nextDay: next?.sendOn ?? null, email: day.length ? await service.emailFor(day) : null, notice: day.length ? (await service.messagesFor(day))[0] ?? null : null };
  }, [version, today]);
  const [draft, setDraft] = useState<PushSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  if (!data) return null;
  const s = draft ?? data.s;
  const set = (patch: Partial<PushSettings>) => setDraft({ ...s, ...patch });
  const configured = data.s.enabled && ((data.s.mail && !!data.s.gmail) || data.s.desktop);

  const preview = data.nextDay && data.email && (
    <details className="reminder-preview">
      <summary>Preview the next reminder email ({prettyDate(data.nextDay)})</summary>
      <pre>{`Subject: ${data.email.subject}\n\n${data.email.body}`}</pre>
    </details>
  );

  if (!editing && configured) {
    return (
      <>
        <dl className="saved-values">
          <div><dt>Reminders</dt><dd>On, every day at {HOURS[data.s.hour].label}</dd></div>
          <div><dt>Channels</dt><dd>{[data.s.desktop && 'Desktop notification', data.s.mail && `Email to ${data.s.email || data.s.gmail}`].filter(Boolean).join(' and ')}</dd></div>
        </dl>
        <p className="muted small">Day before and day of; every day for five days before big work; the first discussion post gets its own reminder.{data.s.mail && data.s.background ? ' Emails go out even when this app is closed, as long as your computer is on.' : ' They go out while this app is open.'}</p>
        {preview}
        <button type="button" className="modify" onClick={() => { setDraft(data.s); setEditing(true); }}>Modify</button>
      </>
    );
  }

  const save = async () => {
    setError(null);
    try {
      if (s.enabled && s.mail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.gmail.trim())) throw new Error('Enter the Gmail address to send from.');
        if (s.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) throw new Error('The address to send to does not look right.');
        if (token.trim()) await setSecret('gmail', token.trim());
        else if (!data.hasToken) throw new Error('Paste your Gmail app password.');
      }
      await service.savePushSettings({ ...s, name: s.name.trim(), gmail: s.gmail.trim(), email: s.email.trim() });
      setToken('');
      setDraft(null);
      setEditing(false);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      if (s.mail) {
        if (token.trim()) await setSecret('gmail', token.trim());
        const sample = data.email ?? { subject: 'Test reminder from Assignment Rescue', body: `Hi${s.name.trim() ? ` ${s.name.trim()}` : ''},\n\nThis is a test. Real reminders list the assignment, course, professor and due date.\n` };
        await sendEmail(s.gmail.trim(), s.email.trim() || s.gmail.trim(), `TEST: ${sample.subject}`, sample.body);
        toast('Test email sent');
      } else {
        await notifyDesktop('Assignment Rescue', (data.notice ?? 'Assignment Rescue\nThis is a test reminder.').split('\n').slice(1).join('\n').slice(0, 220));
        toast('Test notification sent');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <label className="consent">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Send me reminders: the day before and the day of, every day for five days before big assignments (100 points or more), and an extra one for the first discussion post.</span>
      </label>
      {s.enabled && (
        <>
          <div className="grid">
            <label>Send at
              <select value={s.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
                {HOURS.map((x) => <option key={x.h} value={x.h}>{x.label}</option>)}
              </select>
            </label>
            <label>Your first name (for the greeting)
              <input value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="Revanth" autoComplete="off" />
            </label>
          </div>
          <label className="consent"><input type="checkbox" checked={s.desktop} onChange={(e) => set({ desktop: e.target.checked })} /><span>Desktop notification</span></label>
          <label className="consent"><input type="checkbox" checked={s.mail} onChange={(e) => set({ mail: e.target.checked })} /><span>Email, sent from my own Gmail account (free)</span></label>
          {s.mail && (
            <label className="consent"><input type="checkbox" checked={s.background} onChange={(e) => set({ background: e.target.checked })} /><span>Send emails even when this app is closed. My computer will check every 15 minutes using its own scheduler (launchd on Mac, Task Scheduler on Windows). Turning this off removes it. The computer has to be on.</span></label>
          )}
          {s.mail && (
            <>
              <div className="grid">
                <label>Gmail address to send from<input type="email" value={s.gmail} onChange={(e) => set({ gmail: e.target.value })} placeholder="you@gmail.com" autoComplete="off" spellCheck={false} /></label>
                <label>Send reminders to (leave empty for the same address)<input type="email" value={s.email} onChange={(e) => set({ email: e.target.value })} placeholder="optional" autoComplete="off" spellCheck={false} /></label>
                <label>Gmail app password {data.hasToken ? '(saved; paste a new one to replace it)' : ''}
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="16 letters" />
                </label>
              </div>
              <details className="reminder-preview">
                <summary>How do I get an app password?</summary>
                <ol className="small">
                  <li>In your Google account, open Security and turn on 2-Step Verification.</li>
                  <li>Go to myaccount.google.com/apppasswords and create one named Assignment Rescue.</li>
                  <li>Copy the 16 letters Google shows and paste them above. Spaces are fine. It is not your normal Gmail password, and you can delete it any time.</li>
                </ol>
              </details>
            </>
          )}
          {preview}
        </>
      )}
      <div className="row">
        <button type="button" onClick={save}>Save reminder settings</button>
        {s.enabled && (s.mail || s.desktop) && <button type="button" className="secondary" disabled={testing} onClick={test}>{testing ? 'Sending…' : s.mail ? 'Send a test email' : 'Send a test notification'}</button>}
        {editing && <button type="button" className="secondary" onClick={() => { setDraft(null); setEditing(false); setError(null); }}>Cancel</button>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="muted small">With the closed-app option on, emails go out even when this app is not open, as long as your computer is on; desktop notifications need the app open. Your email addresses stay on this computer; the app password is kept in your keychain.</p>
    </>
  );
}
