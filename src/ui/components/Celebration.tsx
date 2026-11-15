import { useEffect, useMemo } from 'react';
import { playFanfare } from '../sound';

export interface CelebrationSettings { sound: boolean; message: string }
export const DEFAULT_CELEBRATION: CelebrationSettings = { sound: true, message: '' };

const LINES = [
  'Done and dusted.',
  'That one is behind you.',
  'One less thing. Nicely done.',
  'Submitted. Go enjoy a break.',
  'Finished, and you did it on your own terms.',
];

const COLORS = ['#b7e35b', '#ffd166', '#ef476f', '#4cc9f0', '#c77dff', '#ff9f1c'];

/** Confetti and a fanfare when an assignment is marked done. The message is yours if you set one in Semester setup. */
export function Celebration({ title, name, settings, onClose }: { title: string; name: string; settings: CelebrationSettings; onClose: () => void }) {
  const line = useMemo(() => settings.message.trim() || `${LINES[Math.floor(Math.random() * LINES.length)]}${name ? ` Well done, ${name}.` : ''}`, [settings.message, name]);
  const bits = useMemo(() => Array.from({ length: 48 }, (_, i) => ({
    left: Math.round(Math.random() * 100), delay: Math.round(Math.random() * 600), dur: 1800 + Math.round(Math.random() * 1400),
    color: COLORS[i % COLORS.length], rot: Math.round(Math.random() * 360), size: 6 + Math.round(Math.random() * 8),
  })), []);
  useEffect(() => {
    if (settings.sound) playFanfare();
    const t = setTimeout(onClose, 5200);
    return () => clearTimeout(t);
  }, [settings.sound, onClose]);
  return (
    <div className="celebrate" role="status" aria-live="polite" onClick={onClose}>
      <div className="confetti" aria-hidden="true">
        {bits.map((b, i) => <span key={i} style={{ left: `${b.left}%`, background: b.color, width: b.size, height: b.size * 0.5, animationDelay: `${b.delay}ms`, animationDuration: `${b.dur}ms`, transform: `rotate(${b.rot}deg)` }} />)}
      </div>
      <div className="celebrate-card">
        <div className="celebrate-check" aria-hidden="true">✓</div>
        <h2>{line}</h2>
        <p className="muted">“{title}” is marked as done.</p>
      </div>
    </div>
  );
}
