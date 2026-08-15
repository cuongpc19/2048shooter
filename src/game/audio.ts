// Sound, synthesised. No audio files at all.
//
// ⚠ Deliberate, not a placeholder. The whole soundtrack of this game is "a merge happened, and
// it was the Nth in a row" — a pitch that climbs with the chain. Sampling that means shipping a
// dozen near-identical blips and still being unable to voice the fourteenth merge of a combo;
// an oscillator just plays the note. It also keeps the bundle at zero audio bytes, which is
// most of what a first load on a phone costs.

import { save } from "./save";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers refuse to start an AudioContext that was not created inside a gesture, and a context
 * created before the first tap boots into `suspended`. Called from the first pointer event.
 */
export function unlockAudio(): void {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

function tone(freq: number, ms: number, type: OscillatorType, gain: number): void {
  if (save.muted) return;
  const a = audio();
  if (!a || a.state !== "running") return;
  const now = a.currentTime;
  const osc = a.createOscillator();
  const vol = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  vol.gain.setValueAtTime(0.0001, now);
  vol.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(vol).connect(a.destination);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.02);
}

export const sfx = {
  shoot(): void {
    tone(320, 90, "triangle", 0.06);
  },
  land(): void {
    tone(200, 70, "sine", 0.07);
  },
  /**
   * One merge. `step` is its index in the chain, so a long combo walks up a scale — that rising
   * run is the only feedback telling you a shot is still paying out.
   */
  merge(step: number): void {
    const semitone = Math.min(step, 14);
    tone(440 * Math.pow(2, semitone / 12), 120, "square", 0.05);
  },
  combo(): void {
    tone(880, 180, "triangle", 0.07);
  },
  buy(): void {
    tone(660, 110, "sine", 0.08);
  },
  deny(): void {
    tone(140, 160, "sawtooth", 0.05);
  },
  over(): void {
    tone(220, 400, "sawtooth", 0.07);
    setTimeout(() => tone(160, 500, "sawtooth", 0.07), 160);
  },
};
