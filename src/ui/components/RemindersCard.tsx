import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { PushSettings } from '../../core/schedule';
import { prettyDate } from '../../core/schedule';
import { hasSecret, setSecret } from '../aiClient';
import { notifyDesktop, sendSms } from '../notifier';
import { errorMessage } from '../format';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ h, label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? 'PM' : 'AM'}` }));
const mask = (p: string) => (p.replace(/\D/g, '').length >= 4 ? `•••• ${p.replace(/\D/g, '').slice(-4)}` : p);

/** Semester setup step 06: where and when reminders go. The phone number stays on this computer. */
export function RemindersCard() {
  const { service, version, refresh, today, toast } = useApp();
  const { data } = useAsync(async () => {
    const s = await service.pushSettings();
    const plan = await service.reminderPlan();
    const next = plan.find((r) => r.sendOn >= today);
    const day = next ? plan.filter((r) => r.sendOn === next.sendOn) : [];
    return { s, hasToken: await hasSecret('twilio'), nextDay: next?.sendOn ?? null, preview: day.length ? await service.messagesFor(day) : [] };
  }, [version, today]);
  const [draft, setDraft] = useState<PushSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  if (!data) return null;
  const s = draft ?? data.s;
  const set = (patch: Partial<PushSettings>) => setDraft({ ...s, ...patch });
  const configured = data.s.enabled && (data.s.sms || data.s.desktop);

  const preview = data.nextDay && data.preview.length > 0 && (
    <details className="reminder-preview">
      <summary>Preview the next reminder ({prettyDate(data.nextDay)})</summary>
      {data.preview.map((m, i) => <pre key={i}>{m}</pre>)}
    </details>
  );

  if (!editing && configured) {
    return (
      <>
        <dl className="saved-values">
          <div><dt>Reminders</dt><dd>On, every day at {HOURS[data.s.hour].label}</dd></div>
          <div><dt>Channels</dt><dd>{[data.s.desktop && 'Desktop notification', data.s.sms && `Text to ${mask(data.s.phone)}`].filter(Boolean).join(' and ')}</dd></div>
        </dl>
        <p className="muted small">Day before and day of; every day for five days before big work; the first discussion post gets its own reminder. They go out while this app is open.</p>
        {preview}
        <button type="button" className="modify" onClick={() => { setDraft(data.s); setEditing(true); }}>Modify</button>
      </>
    );
  }

  const save = async () => {
    setError(null);
    try {
      if (s.enabled && s.sms) {
        if (s.phone.replace(/\D/g, '').length < 10) throw new Error('Enter the phone number to text, with area code.');
        if (!s.twilioSid.trim().startsWith('AC')) throw new Error('Enter your Twilio Account SID (it starts with AC).');
        if (!s.twilioFrom.trim()) throw new Error('Enter your Twilio phone number (the one texts are sent from).');
        if (token.trim()) await setSecret('twilio', token.trim());
        else if (!data.hasToken) throw new Error('Paste your Twilio auth token.');
      }
      await service.savePushSettings({ ...s, twilioSid: s.twilioSid.trim(), twilioFrom: s.twilioFrom.trim(), phone: s.phone.trim() });
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
      const sample = data.preview[0] ?? 'Assignment Rescue\nThis is a test reminder. Real ones will show your course, teacher, assignment and what to do.';
      if (s.sms) {
        if (token.trim()) await setSecret('twilio', token.trim());
        await sendSms(s.twilioSid.trim(), s.twilioFrom.trim(), s.phone.trim(), `TEST\n${sample}`);
        toast('Test text sent');
      } else {
        await notifyDesktop('Assignment Rescue', sample.split('\n').slice(1).join('\n').slice(0, 220));
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
            <label>Phone number to text
              <input type="tel" value={s.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="10 digits" autoComplete="off" />
            </label>
          </div>
          <label className="consent"><input type="checkbox" checked={s.desktop} onChange={(e) => set({ desktop: e.target.checked })} /><span>Desktop notification</span></label>
          <label className="consent"><input type="checkbox" checked={s.sms} onChange={(e) => set({ sms: e.target.checked })} /><span>Text message through my Twilio account (a Twilio trial is free but can only text numbers you verify there)</span></label>
          {s.sms && (
            <div className="grid">
              <label>Twilio Account SID<input value={s.twilioSid} onChange={(e) => set({ twilioSid: e.target.value })} placeholder="AC…" autoComplete="off" spellCheck={false} /></label>
              <label>Twilio phone number (from)<input type="tel" value={s.twilioFrom} onChange={(e) => set({ twilioFrom: e.target.value })} placeholder="+1…" autoComplete="off" /></label>
              <label>Twilio auth token {data.hasToken ? '(saved; paste a new one to replace it)' : ''}
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
              </label>
            </div>
          )}
          {preview}
        </>
      )}
      <div className="row">
        <button type="button" onClick={save}>Save reminder settings</button>
        {s.enabled && (s.sms || s.desktop) && <button type="button" className="secondary" disabled={testing} onClick={test}>{testing ? 'Sending…' : s.sms ? 'Send a test text' : 'Send a test notification'}</button>}
        {editing && <button type="button" className="secondary" onClick={() => { setDraft(null); setEditing(false); setError(null); }}>Cancel</button>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="muted small">Reminders go out while this app is open on your computer. Your phone number and Twilio details stay on this computer; the auth token is kept in your keychain.</p>
    </>
  );
}
