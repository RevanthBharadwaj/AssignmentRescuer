/** A short rising fanfare made with the browser's own audio, so there is no sound file and nothing to download. */
export function playFanfare(): void {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    const note = (freq: number, start: number, dur: number, type: OscillatorType = 'triangle') => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(1, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(master);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.05);
    };
    // C major climbing, then a held chord.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.11, 0.35));
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f) => note(f, 0.5, 1.1, 'sine'));
    setTimeout(() => void ctx.close(), 2200);
  } catch { /* no sound available: the celebration still shows */ }
}
