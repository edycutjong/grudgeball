/**
 * Procedural SFX for Grudgeball — Web Audio synthesis, zero asset files.
 *
 * Why synthesis and not .mp3s: this project ships with `devvit.json`
 * `http.enable:false` (empty fetch allowlist), so every byte must be
 * same-origin and bundled. Oscillator/noise one-shots are generated at runtime
 * — nothing to fetch, nothing to bundle, trivially offline. It also matches the
 * brass/red arcade tone (see AUDIO.md).
 *
 * Autoplay policy: audio cannot start before a user gesture. `unlock()` resumes
 * the context on the first tap; every cue is a no-op until then, and a no-op
 * forever if the context is muted or Web Audio is unavailable (SSR / tests).
 */

type Ctor = typeof AudioContext;

const AudioCtor: Ctor | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext)
    : undefined;

const MUTE_KEY = 'gb_muted';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function getCtx(): AudioContext | null {
  if (AudioCtor === undefined) return null;
  if (ctx === null) {
    try {
      ctx = new AudioCtor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Resume the context inside a user-gesture handler (also needed on iOS). */
export function unlock(): void {
  const c = getCtx();
  if (c !== null && c.state === 'suspended') void c.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    sessionStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* storage may be blocked; in-memory flag still holds for the session */
  }
}

type ToneOpts = {
  type: OscillatorType;
  freq: number;
  slideTo?: number;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
};

function tone(o: ToneOpts): void {
  const c = getCtx();
  if (c === null || muted) return;
  const now = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, now);
  if (o.slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), now + o.dur);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + o.dur + 0.03);
}

type NoiseOpts = {
  dur: number;
  gain?: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterTo?: number;
  delay?: number;
};

function noise(o: NoiseOpts): void {
  const c = getCtx();
  if (c === null || muted) return;
  const now = c.currentTime + (o.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = o.filterType ?? 'bandpass';
  filt.frequency.setValueAtTime(o.filterFreq ?? 800, now);
  if (o.filterTo !== undefined) {
    filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.filterTo), now + o.dur);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(now);
  src.stop(now + o.dur + 0.03);
}

// ── cues (mapped to AUDIO.md's SFX table) ────────────────────────────────────

/** Marble dies on a trap — the magic-moment beat. Heavy thud + a sharp crack. */
export function kill(): void {
  tone({ type: 'sine', freq: 190, slideTo: 52, dur: 0.3, gain: 0.38 });
  noise({ dur: 0.14, filterType: 'highpass', filterFreq: 1900, gain: 0.16 });
}

/** Marble survives / banks depth — a small positive two-note chime. */
export function survive(): void {
  tone({ type: 'triangle', freq: 523.25, dur: 0.12, gain: 0.18 });
  tone({ type: 'triangle', freq: 783.99, dur: 0.16, gain: 0.16, delay: 0.09 });
}

/** Placement planted (PLANT) — a low sealed "thunk" confirming the commit. */
export function plant(): void {
  tone({ type: 'square', freq: 150, slideTo: 78, dur: 0.16, gain: 0.26 });
  noise({ dur: 0.05, filterType: 'lowpass', filterFreq: 420, gain: 0.12 });
}

/** Grudge Report modal opens — a rising reveal sting under the body-count. */
export function reveal(): void {
  tone({ type: 'sawtooth', freq: 280, slideTo: 860, dur: 0.5, gain: 0.13 });
}

/** Mounts a small mute toggle into the given HUD element (inline flex item). */
export function mountMuteButton(mount: HTMLElement | null): void {
  if (mount === null || typeof document === 'undefined') return;
  if (document.getElementById('audio-mute') !== null) return;
  const btn = document.createElement('button');
  btn.id = 'audio-mute';
  btn.type = 'button';
  btn.style.cssText =
    'appearance:none;border:1px solid rgba(255,255,255,0.25);background:rgba(0,0,0,0.35);' +
    'color:#fff;font-size:14px;line-height:1;width:26px;height:26px;border-radius:50%;' +
    'cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;';
  const paint = (): void => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    btn.setAttribute('aria-pressed', String(muted));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMuted(!muted);
    paint();
    if (!muted) {
      unlock();
      survive();
    }
  });
  paint();
  mount.appendChild(btn);
}
