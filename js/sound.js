// Soft, synthesised sounds. Off by default; unlocked by a tap.

let ctx = null;
let on = false;
let noise = null;
let keepAlive = null;
let lastFlap = 0;

export const isOn = () => on;

function silentWav(seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  b.fill(128, 44);
  let s = "";
  b.forEach((x) => (s += String.fromCharCode(x)));
  return "data:audio/wav;base64," + btoa(s);
}

/** Must be called from a tap/click handler. */
export async function enable() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!ctx) ctx = new AC();

  // iPhone: ask for "playback" so the ring/silent switch doesn't mute us (iOS 17+)…
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  // …and for older iOS, a looping silent <audio> element does the same job.
  if (!keepAlive) {
    keepAlive = new Audio(silentWav());
    keepAlive.loop = true;
    keepAlive.setAttribute("playsinline", "");
    keepAlive.preload = "auto";
  }
  keepAlive.play().catch(() => {});

  // Play one silent sample inside the gesture: this is what unlocks Web Audio on iOS.
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  if (ctx.state !== "running") { try { await ctx.resume(); } catch {} }

  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  on = true;
  // a quick test: one flap, then the stamp
  flap(0.9, true);
  setTimeout(() => thud(), 520);
  return true;
}

export function disable() {
  on = false;
  keepAlive?.pause();
}

/** A few soft, filtered noise beats, like wings. */
export function flap(vol = 0.6, force = false) {
  if (!on || !ctx) return;
  const now = performance.now();
  if (!force && now - lastFlap < 260) return;
  lastFlap = now;
  const t0 = ctx.currentTime + 0.01;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.11;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700 + Math.random() * 500;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const peak = 0.11 * vol * (1 - i * 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.3, 0.12);
  }
}

/** A low, short thud: the postmark landing. */
export function thud() {
  if (!on || !ctx) return;
  const t = ctx.currentTime + 0.01;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.35);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.18, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(lp).connect(g2).connect(ctx.destination);
  src.start(t, 0, 0.08);
}
