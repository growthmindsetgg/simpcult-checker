"use client";

/**
 * Tiny Web Audio synth for the machine. No audio files (CSP allows media from
 * 'self' only, and synthesised sound is a few hundred bytes). The context is
 * created lazily on the first user gesture, so browsers never block it.
 */

type Ctx = { ac: AudioContext; out: GainNode; noise: AudioBuffer };

let ctx: Ctx | null = null;
let muted = false;
let whir: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

const MUTE_KEY = "simp-slot-muted";

export function loadMuted(): boolean {
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    muted = false;
  }
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {}
  if (ctx) ctx.out.gain.setTargetAtTime(m ? 0 : 0.7, ctx.ac.currentTime, 0.02);
  if (m) stopWhir();
}

/** Call from a click handler. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.ac.state === "suspended") void ctx.ac.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ac = new AC();
  const out = ac.createGain();
  out.gain.value = muted ? 0 : 0.7;
  const comp = ac.createDynamicsCompressor();
  out.connect(comp).connect(ac.destination);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ctx = { ac, out, noise };
}

function live(): Ctx | null {
  return ctx && !muted ? ctx : null;
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, peak: number, glideTo?: number) {
  const c = live();
  if (!c) return;
  const t = c.ac.currentTime + at;
  const o = c.ac.createOscillator();
  const g = c.ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseBurst(at: number, dur: number, freq: number, q: number, peak: number, sweepTo?: number) {
  const c = live();
  if (!c) return;
  const t = c.ac.currentTime + at;
  const src = c.ac.createBufferSource();
  src.buffer = c.noise;
  const f = c.ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = c.ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  press() {
    tone(420, 0, 0.06, "square", 0.05, 260);
  },
  spinStart() {
    noiseBurst(0, 0.35, 600, 1.2, 0.22, 2400);
    tone(180, 0, 0.18, "triangle", 0.12, 90);
    startWhir();
  },
  reelStop(i: number) {
    tone(150 - i * 12, 0, 0.16, "sine", 0.5, 55);
    noiseBurst(0, 0.05, 2500, 2, 0.18);
  },
  anticipation(dur: number) {
    tone(260, 0, dur, "sawtooth", 0.05, 980);
    tone(390, 0, dur, "triangle", 0.06, 1470);
    for (let t = 0; t < dur - 0.1; t += 0.28) tone(70, t, 0.12, "sine", 0.22, 50); // heartbeat under the riser
  },
  win(tier: "nice" | "big" | "mega") {
    const notes = tier === "nice" ? [659, 784, 988] : tier === "big" ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    notes.forEach((n, i) => {
      tone(n, i * 0.085, 0.32, "triangle", 0.22);
      tone(n * 2, i * 0.085, 0.18, "sine", 0.05);
    });
    if (tier !== "nice") noiseBurst(notes.length * 0.085, 0.6, 6000, 0.8, 0.06);
  },
  smallWin() {
    tone(880, 0, 0.14, "triangle", 0.12);
  },
  countTick() {
    tone(1400 + Math.random() * 300, 0, 0.03, "sine", 0.04);
  },
  /** the lever: a ratchet click on the way down, a heavy clunk when it bottoms out */
  lever() {
    noiseBurst(0, 0.05, 3200, 3, 0.12);
    noiseBurst(0.07, 0.04, 2800, 3, 0.1);
    tone(92, 0.2, 0.22, "sine", 0.55, 48);
    noiseBurst(0.2, 0.09, 900, 1.4, 0.25);
  },
  /** one symbol passing the window (the 3D reels call this, rate-limited) */
  reelTick(i = 0) {
    noiseBurst(0, 0.018, 4200 - i * 300, 6, 0.05);
  },
  /** coins pouring into the tray; length scales with the win */
  coinShower(tier: "big" | "mega") {
    const n = tier === "mega" ? 34 : 18;
    for (let k = 0; k < n; k++) {
      const at = 0.05 + (k / n) * (tier === "mega" ? 2.2 : 1.3) + Math.random() * 0.05;
      const f = 2200 + Math.random() * 2600;
      tone(f, at, 0.09, "sine", 0.05 + Math.random() * 0.04, f * 0.92);
      tone(f * 1.51, at + 0.004, 0.06, "sine", 0.025);
    }
    noiseBurst(0.05, tier === "mega" ? 2.4 : 1.5, 5200, 0.7, 0.035);
  },
  error() {
    tone(220, 0, 0.12, "square", 0.05, 160);
    tone(160, 0.1, 0.16, "square", 0.05, 110);
  },
  stopWhir,
};

function startWhir() {
  const c = live();
  if (!c || whir) return;
  const src = c.ac.createBufferSource();
  src.buffer = c.noise;
  src.loop = true;
  const f = c.ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 900;
  f.Q.value = 0.9;
  const g = c.ac.createGain();
  const t = c.ac.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.25);
  src.connect(f).connect(g).connect(c.out);
  src.start();
  whir = { src, gain: g };
}

function stopWhir() {
  if (!whir || !ctx) return;
  const { src, gain } = whir;
  whir = null;
  const t = ctx.ac.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  src.stop(t + 0.2);
}
