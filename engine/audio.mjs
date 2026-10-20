// Audio pipeline: Opus-style procedural chamber score (or external BGM) + SFX + voice mix -> build/mix.wav
// Usage:
//   node engine/audio.mjs projects/50mm-portrait
//   node engine/audio.mjs projects/50mm-portrait --music assets/music/opus_bgm.mp3
// Runs on CPU in parallel with the GPU video render (render.mjs spawns it).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildTimeline } from './timeline.mjs';

const SR = 48000;
const AUDIO_EXTS = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aac'];

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    const out = []; let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('close', c => (c === 0 ? res(Buffer.concat(out)) : rej(new Error(`${cmd} ${c}\n${err.slice(-2000)}`))));
  });
}

async function decodeMono(file) {
  const buf = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

async function decodeStereo(file) {
  const buf = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-']);
  const interleaved = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const frames = Math.floor(interleaved.length / 2);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = interleaved[i * 2];
    R[i] = interleaved[i * 2 + 1];
  }
  return [L, R];
}

function writeWav(file, channels) {
  const n = channels[0].length, ch = channels.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    b.writeInt16LE((v * 32767) | 0, o); o += 2;
  }
  fs.writeFileSync(file, b);
}

// ---------- deterministic RNG & pitch helpers ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ---------- Scheme 2: External Opus BGM Resolver & Loader ----------
export function resolveExternalMusic(projDir, tlMusic, cliMusic) {
  const spec = cliMusic ? { file: cliMusic } : (typeof tlMusic === 'string' ? { file: tlMusic } : (tlMusic && typeof tlMusic === 'object' ? { ...tlMusic } : {}));
  if (spec.file && spec.file !== 'procedural' && spec.file !== 'opus') {
    const candidates = [
      path.resolve(projDir, spec.file),
      path.resolve(spec.file),
      ...AUDIO_EXTS.map(ext => path.resolve(projDir, spec.file + ext)),
    ];
    const found = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (found) return { ...spec, resolvedPath: found };
    console.warn(`[audio] external music file not found (${spec.file}), falling back to Opus procedural chamber score.`);
  }
  // Auto-discover assets/music.(wav|mp3|flac|m4a|ogg) if present and not explicitly forced to procedural
  if (spec.file !== 'procedural') {
    for (const sub of ['assets/music', 'assets/audio/music', 'assets/bgm']) {
      for (const ext of AUDIO_EXTS) {
        const p = path.join(projDir, sub + ext);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return { ...spec, resolvedPath: p };
        }
      }
    }
  }
  return null;
}

async function loadExternalScore(extCfg, dur, tl) {
  console.log(`[audio] loading external Opus BGM: ${extCfg.resolvedPath}`);
  const [srcL, srcR] = await decodeStereo(extCfg.resolvedPath);
  const n = Math.ceil((dur + 2) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const vol = extCfg.volume ?? 0.85;
  const offsetSamples = Math.max(0, Math.floor((extCfg.start || 0) * SR));
  const availL = srcL.subarray(Math.min(offsetSamples, srcL.length));
  const availR = srcR.subarray(Math.min(offsetSamples, srcR.length));
  if (availL.length === 0) return [L, R];

  const xfade = Math.min(Math.floor(2.5 * SR), Math.floor(availL.length / 4));
  const step = Math.max(1, availL.length - xfade);
  let pos = 0;
  while (pos < n) {
    for (let i = 0; i < availL.length && pos + i < n; i++) {
      let w = 1;
      if (pos > 0 && i < xfade) w = Math.sin(0.5 * Math.PI * (i / xfade));
      if (pos + step < n && i >= availL.length - xfade) {
        const u = (availL.length - i) / xfade;
        w *= Math.sin(0.5 * Math.PI * clamp(u));
      }
      L[pos + i] += availL[i] * w * vol;
      R[pos + i] += availR[i] * w * vol;
    }
    if (extCfg.loop === false) break;
    pos += step;
  }

  // Subtle narrative breath on chapter transitions so external tracks feel edited to the timeline
  for (const s of tl.scenes) {
    if (s.type === 'chapter') {
      const i0 = Math.max(0, Math.floor((s.start - 0.3) * SR));
      const i1 = Math.min(n, Math.floor((s.end + 0.2) * SR));
      for (let i = i0; i < i1; i++) {
        const t = i / SR;
        const dip = 1 - 0.28 * Math.sin(Math.PI * clamp((t - (s.start - 0.3)) / (s.duration + 0.5)));
        L[i] *= dip; R[i] *= dip;
      }
    }
  }
  return [L, R];
}

// ---------- Scheme 1: Opus Procedural Chamber Score (Felt Piano + Cello + Strings + Marimba) ----------
const ANALYTICAL_TYPES = new Set([
  'dofDiagram', 'perspective', 'cameraHeight', 'shutterStops', 'bgDistance', 'sunOrbit',
  'focalPerspective', 'lightPositions', 'lightClock', 'dynamicRange', 'ndLong', 'hyperfocal',
  'shutter180', 'logGrade', 'gearBoard', 'thesis',
]);

function getSceneProfile(t, tl) {
  let sc = tl.scenes[0];
  for (const s of tl.scenes) {
    if (t >= s.start) sc = s; else break;
  }
  if (!sc) return { mode: 'lyrical', energy: 0.85, chapter: 0, tin: 0, scDur: 6 };
  const tin = t - sc.start;
  const type = sc.type;
  if (type === 'hook' || type === 'opener') return { mode: 'hook', energy: 0.88, chapter: 0, tin, scDur: sc.duration };
  if (type === 'title') return { mode: 'title', energy: 0.92, chapter: 0, tin, scDur: sc.duration };
  if (type === 'chapter') return { mode: 'chapter', energy: 0.58, chapter: sc.chapter || 1, tin, scDur: sc.duration };
  if (type === 'recap') return { mode: 'recap', energy: 1.0, chapter: sc.chapter || 7, tin, scDur: sc.duration };
  if (type === 'outro') return { mode: 'outro', energy: 0.78, chapter: sc.chapter || 7, tin, scDur: sc.duration };
  if (ANALYTICAL_TYPES.has(type)) return { mode: 'analytical', energy: 0.94, chapter: sc.chapter || 1, tin, scDur: sc.duration };
  return { mode: 'lyrical', energy: 0.86, chapter: sc.chapter || 1, tin, scDur: sc.duration };
}

function synthOpusScore(dur, tl, cfg = {}) {
  const n = Math.ceil((dur + 2.5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(cfg.seed ?? 55);
  const bpm = cfg.bpm || 76;
  const beat = 60 / bpm, bar = beat * 4, chordLen = bar * 2;

  // Two complementary Opus / Olafur Arnalds / Nils Frahm style harmonic progressions in D major / B minor:
  // Palette A (Contemplative & Intimate): Bm9 -> Gmaj9 -> Dadd9 -> Asus4/Aadd9
  const progA = [
    { bass: 35, cello: 47, pad: [54, 57, 61, 62, 66], arp: [59, 62, 66, 69, 73, 74] }, // Bm9
    { bass: 31, cello: 43, pad: [50, 54, 57, 59, 62], arp: [55, 59, 62, 66, 69, 74] }, // Gmaj9
    { bass: 38, cello: 50, pad: [54, 57, 62, 64, 66], arp: [57, 62, 64, 66, 69, 74] }, // Dadd9
    { bass: 33, cello: 45, pad: [52, 57, 61, 62, 64], arp: [57, 61, 62, 64, 69, 73] }, // Aadd9sus4
  ];
  // Palette B (Warm, Clarifying & Inspiring): Gmaj7#11 -> A6sus4 -> Bm11 -> Dmaj9/F#
  const progB = [
    { bass: 31, cello: 43, pad: [50, 54, 57, 61, 62], arp: [59, 62, 66, 69, 73, 74] }, // Gmaj7#11
    { bass: 33, cello: 45, pad: [52, 54, 57, 59, 64], arp: [57, 62, 64, 66, 69, 73] }, // A6sus4
    { bass: 35, cello: 47, pad: [54, 57, 61, 62, 66], arp: [59, 62, 64, 66, 69, 74] }, // Bm11
    { bass: 30, cello: 42, pad: [50, 57, 61, 64, 66], arp: [57, 61, 62, 66, 69, 73] }, // Dmaj9/F#
  ];

  // 1. Intimate Felt Piano (close-miked felt hammer thump + stiff-string inharmonicity + warm dynamic low-pass)
  const addFeltPiano = (t0, len, midi, vel = 0.06, pan = 0) => {
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    if (i0 >= n || i1 <= 0) return;
    const freq = mtof(midi);
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    // Stiff string inharmonicity coefficient B
    const B = 0.00015 + 0.00012 * clamp((midi - 55) / 36);
    const w1 = 2 * Math.PI * freq / SR;
    const w1b = 2 * Math.PI * (freq * 1.00055) / SR; // unison string slight detune
    const w2 = 2 * Math.PI * freq * 2 * Math.sqrt(1 + 4 * B) / SR;
    const w3 = 2 * Math.PI * freq * 3 * Math.sqrt(1 + 9 * B) / SR;
    const w4 = 2 * Math.PI * freq * 4 * Math.sqrt(1 + 16 * B) / SR;
    const w5 = 2 * Math.PI * freq * 5 * Math.sqrt(1 + 25 * B) / SR;
    // Wood & felt hammer thump resonance (~115 Hz and ~245 Hz)
    const wThump1 = 2 * Math.PI * 115 / SR;
    const wThump2 = 2 * Math.PI * 245 / SR;
    const baseDecay = 1.45 + freq / 950;
    // Dynamic 1-pole warm low-pass coefficient (mellow wool felt dampening)
    const fc = clamp((950 + vel * 14000 + (midi - 48) * 18) / SR, 0.04, 0.32);
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * fc);
    let lp = 0;

    for (let i = Math.max(0, i0); i < i1; i++) {
      const k = i - i0;
      const t = k / SR;
      // Soft felt attack (8ms) + natural piano soundboard decay + smooth damper release
      const att = Math.min(1, t / 0.0075);
      const rel = Math.min(1, (len - t) / 0.12);
      const env1 = Math.exp(-t * baseDecay);
      const env2 = Math.exp(-t * baseDecay * 1.65);
      const env3 = Math.exp(-t * baseDecay * 2.5);
      const env4 = Math.exp(-t * baseDecay * 3.8);

      // Unison fundamental + warm low partials
      let sig =
        0.54 * (Math.sin(w1 * k) + 0.78 * Math.sin(w1b * k + 0.25)) * env1 +
        0.34 * Math.sin(w2 * k + 0.4) * env2 +
        0.14 * Math.sin(w3 * k + 1.1) * env3 +
        0.045 * Math.sin(w4 * k + 1.9) * env4 +
        0.015 * Math.sin(w5 * k + 2.7) * env4 * env2;

      // Felt hammer mechanical wood thump (first 35ms)
      if (t < 0.045) {
        const thEnv = Math.exp(-t * 78) * Math.min(1, t / 0.002);
        const thump = (0.65 * Math.sin(wThump1 * k) + 0.35 * Math.sin(wThump2 * k)) * thEnv * 0.22;
        sig += thump;
      }

      lp += lpAlpha * (sig - lp);
      const v = lp * att * rel * vel;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  // 2. Solo Bowed Cello (warm low/tenor voice with delayed natural vibrato & body formant)
  const addCello = (t0, len, midi, amp = 0.038, pan = -0.18) => {
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    if (i0 >= n || i1 <= 0) return;
    const freq = mtof(midi);
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * Math.min(1150, freq * 5.2) / SR);
    let ph = 0, lp = 0;

    for (let i = Math.max(0, i0); i < i1; i++) {
      const t = (i - i0) / SR;
      // Bow envelope: expressive slow swell in & out
      const att = Math.min(1, t / Math.min(0.45, len * 0.28));
      const rel = Math.min(1, (len - t) / Math.min(0.65, len * 0.32));
      const swell = 0.78 + 0.22 * Math.sin(Math.PI * clamp(t / len));
      const env = (att * rel) ** 1.35 * swell;

      // Natural cello vibrato (5.2 Hz, blooms after 0.25s)
      const vibDepth = 0.0032 * clamp((t - 0.22) / 0.45);
      const instFreq = freq * (1 + vibDepth * Math.sin(2 * Math.PI * 5.2 * t));
      ph += 2 * Math.PI * instFreq / SR;

      // Bowed string harmonic spectrum with warm wood formant
      const raw =
        Math.sin(ph) +
        0.52 * Math.sin(2 * ph + 0.3) +
        0.28 * Math.sin(3 * ph + 0.8) +
        0.14 * Math.sin(4 * ph + 1.5) +
        0.07 * Math.sin(5 * ph + 2.1) +
        0.03 * Math.sin(6 * ph + 2.8);

      lp += lpAlpha * (raw - lp);
      const v = lp * env * amp;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  // 3. Con Sordino Chamber String Section (warm muted violas & cellos breathing pad)
  const addStringPad = (t0, len, midi, amp = 0.02, pan = 0) => {
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    if (i0 >= n || i1 <= 0) return;
    const freq = mtof(midi);
    const wA = 2 * Math.PI * (freq * 0.9987) / SR;
    const wB = 2 * Math.PI * (freq * 1.0013) / SR;
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * 1050 / SR);
    let lp = 0;

    for (let i = Math.max(0, i0); i < i1; i++) {
      const k = i - i0;
      const t = k / SR;
      const a = Math.min(1, t / 1.8), rel = Math.min(1, (len - t) / 1.9);
      const swell = 0.72 + 0.28 * Math.sin(Math.PI * clamp(t / len));
      const env = Math.max(0, Math.min(a, rel)) ** 1.45 * swell;

      const phA = wA * k + 0.22 * Math.sin(2 * Math.PI * 0.27 * t);
      const phB = wB * k - 0.22 * Math.sin(2 * Math.PI * 0.33 * t + 1.2);
      const raw =
        0.55 * (Math.sin(phA) + Math.sin(phB)) +
        0.24 * (Math.sin(2 * phA + 0.4) + Math.sin(2 * phB + 0.9)) +
        0.09 * (Math.sin(3 * phA + 1.1) + Math.sin(3 * phB + 1.7));

      lp += lpAlpha * (raw - lp);
      const v = lp * env * amp;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  // 4. Warm Rosewood Marimba / Muted Ostinato Pulse (for analytical & hook sections)
  const addMarimba = (t0, midi, amp = 0.028, pan = 0) => {
    const len = 0.65;
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    if (i0 >= n || i1 <= 0) return;
    const freq = mtof(midi);
    const w1 = 2 * Math.PI * freq / SR;
    const w4 = 2 * Math.PI * (freq * 3.98) / SR; // Rosewood bar 4th harmonic tuning
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);

    for (let i = Math.max(0, i0); i < i1; i++) {
      const k = i - i0;
      const t = k / SR;
      const att = Math.min(1, t / 0.0045);
      const s1 = Math.sin(w1 * k) * Math.exp(-t * 8.8);
      const s4 = 0.26 * Math.sin(w4 * k + 0.3) * Math.exp(-t * 34);
      const v = (s1 + s4) * att * amp;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  // ---------- Timeline-Aware Bar-by-Bar Scoring ----------
  for (let t = 0, idx = 0; t < dur + 0.5; t += chordLen, idx++) {
    const prof = getSceneProfile(t + chordLen * 0.35, tl);
    const useProgB = (prof.chapter % 2 === 0 && prof.chapter > 0) || prof.mode === 'recap' || prof.mode === 'title' || prof.mode === 'outro';
    const palette = useProgB ? progB : progA;
    const ch = palette[idx % 4];
    const energy = prof.energy;

    // A) Warm Con Sordino Chamber Strings (always provides a gentle velvet cushion, quieter on chapter drop-outs)
    const padGain = prof.mode === 'chapter' ? 0.015 : 0.018 * energy;
    ch.pad.forEach((m, vIdx) => {
      const pan = ((vIdx / (ch.pad.length - 1)) - 0.5) * 1.1;
      addStringPad(t, chordLen + 1.8, m, padGain, pan);
    });

    // B) Deep Sub & Solo Bowed Cello Line
    addStringPad(t, chordLen + 1.2, ch.bass, 0.032 * energy, 0);
    if (prof.mode === 'chapter') {
      // During chapter card: single expressive cello swell in the negative space
      addCello(t + 0.15, chordLen * 0.85, ch.cello, 0.042, -0.22);
    } else if (prof.mode === 'hook') {
      // Hook: tense rhythmic cello pedal pulse
      addCello(t, bar * 0.95, ch.cello, 0.044, -0.2);
      addCello(t + bar, bar * 0.95, ch.cello + (idx % 2 === 0 ? 0 : 2), 0.044, -0.2);
    } else {
      // Two-bar lyrical cello bass & tenor movement
      addCello(t, bar * 1.05, ch.cello, 0.038 * energy, -0.24);
      const secondCello = ch.pad[0] - 12;
      addCello(t + bar, bar * 1.05, secondCello, 0.036 * energy, -0.18);
    }

    // C) Intimate Felt Piano & Wooden Marimba Ostinato (adapts to narrative mode)
    if (prof.mode === 'chapter') {
      // OPUS DROP-OUT: leave silence for the first beat, then play one warm resonant interval
      addFeltPiano(t + beat * 1.5, 4.2, ch.arp[1], 0.052, -0.15);
      addFeltPiano(t + beat * 2.25, 4.5, ch.arp[4], 0.048, 0.2);
      continue;
    }

    if (prof.mode === 'hook') {
      // Driving staccato felt piano pulse + subtle wooden marimba (Anthropic launch video vibe)
      const hookPattern = [0, 2, 1, 3, 0, 2, 4, 3];
      for (let s = 0; s < 16; s++) {
        const stepT = t + s * (beat / 2) + (r() - 0.5) * 0.008;
        if (stepT > dur) break;
        const note = ch.arp[hookPattern[s % 8] % ch.arp.length];
        const accent = (s % 4 === 0) ? 1.18 : (s % 2 === 0 ? 0.92 : 0.72);
        addFeltPiano(stepT, 1.35, note, 0.056 * accent, ((s % 3) - 1) * 0.28);
        if (s % 2 === 0) {
          addMarimba(stepT, note - 12, 0.022 * accent, ((s % 4) - 1.5) * 0.25);
        }
      }
      continue;
    }

    if (prof.mode === 'title') {
      // Warm chordal bloom + crystalline high felt piano motif
      addFeltPiano(t + 0.04, 4.5, ch.arp[0], 0.065, -0.25);
      addFeltPiano(t + 0.14, 4.5, ch.arp[2], 0.062, 0.0);
      addFeltPiano(t + 0.24, 4.8, ch.arp[4], 0.068, 0.25);
      const motif = [74, 73, 69, 66]; // D5 -> C#5 -> A4 -> F#4
      motif.forEach((m, j) => {
        addFeltPiano(t + beat * (2 + j * 1.25), 3.6, m, 0.058, (j - 1.5) * 0.2);
      });
      continue;
    }

    if (prof.mode === 'outro') {
      // Spacious, tender resolution: slow arpeggiated chords & high bell tones
      const outroSteps = [0, 1, 2, 4, 3, 5];
      for (let s = 0; s < outroSteps.length; s++) {
        const stepT = t + s * beat * 1.25 + (r() - 0.5) * 0.018;
        if (stepT > dur) break;
        const note = ch.arp[outroSteps[s]];
        addFeltPiano(stepT, 4.2, note, 0.052 * (1 - 0.05 * s), (r() - 0.5) * 0.5);
      }
      continue;
    }

    // Analytical / Lyrical / Recap sections:
    // Neoclassical repeating arpeggio pattern (Olafur Arnalds / Nils Frahm style)
    const arpOrder = [0, 1, 3, 2, 1, 3, 4, 2, 0, 2, 3, 5, 1, 4, 3, 2];
    const density = prof.mode === 'recap' ? 0.94 : (prof.mode === 'analytical' ? 0.85 : 0.68);

    for (let s = 0; s < 16; s++) {
      // Check if we are right inside a chapter card transition mid-bar
      const stepT = t + s * (beat / 2) + (r() - 0.5) * 0.014;
      if (stepT > dur) break;
      const stepProf = getSceneProfile(stepT, tl);
      if (stepProf.mode === 'chapter' && stepProf.tin < stepProf.scDur - 0.3) continue;

      const isDownbeat = (s % 4 === 0);
      if (isDownbeat || r() < density) {
        const m = ch.arp[arpOrder[s] % ch.arp.length];
        const vel = (isDownbeat ? 0.062 : 0.044 + r() * 0.014) * energy;
        const pan = ((s % 5) - 2) * 0.18 + (r() - 0.5) * 0.15;
        addFeltPiano(stepT, 2.9, m, vel, pan);
      }

      // Add warm rosewood marimba thinking-pulse on analytical & recap sections
      if ((stepProf.mode === 'analytical' || stepProf.mode === 'recap') && (s % 2 === 0) && r() < 0.78) {
        const mPulse = ch.arp[(arpOrder[s] + 2) % 4];
        addMarimba(stepT, mPulse, 0.018 * energy * (isDownbeat ? 1.15 : 0.8), ((s % 3) - 1) * 0.3);
      }
    }

    // Sparse high-register contemplative melody notes on beats 3 and 7 (Nils Frahm right-hand droplets)
    if (r() < 0.75) {
      const melNote1 = ch.arp[4] + 12;
      const melNote2 = ch.arp[3] + 12;
      addFeltPiano(t + beat * 2.5 + (r() - 0.5) * 0.02, 3.6, melNote1, 0.046 * energy, 0.28);
      if (r() < 0.65) {
        addFeltPiano(t + beat * 6.0 + (r() - 0.5) * 0.02, 3.8, melNote2, 0.042 * energy, 0.18);
      }
    }
  }

  return [L, R];
}

// ---------- SFX ----------
function addSfx(L, R, tl) {
  const r = rng(99);
  const n = L.length;
  const noiseBurst = (t0, len, amp, fFrom, fTo, q = 0.7, pan = 0) => {
    let lp = 0, bp = 0;
    const i0 = Math.floor(t0 * SR), cnt = Math.floor(len * SR);
    for (let k = 0; k < cnt; k++) {
      const i = i0 + k; if (i < 0 || i >= n) continue;
      const x = k / cnt;
      const f = fFrom * Math.pow(fTo / fFrom, x);
      const F = 2 * Math.sin(Math.PI * f / SR);
      const inp = r() * 2 - 1;
      lp += F * bp; const hp = inp - lp - q * bp; bp += F * hp;
      const env = Math.sin(Math.PI * Math.min(1, x * 1.4)) ** 2 * (1 - x * 0.3);
      const v = bp * env * amp;
      L[i] += v * (1 - pan); R[i] += v * (1 + pan);
    }
  };
  const boom = (t0, amp) => {
    const i0 = Math.floor(t0 * SR);
    for (let k = 0; k < SR * 2.5; k++) {
      const i = i0 + k; if (i >= n) break;
      const t = k / SR, f = 38 + 50 * Math.exp(-t * 6);
      const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 1.6) * Math.min(1, t / 0.004) * amp;
      L[i] += v; R[i] += v;
    }
  };
  const shutter = (t0, amp) => {
    noiseBurst(t0, 0.035, amp, 3500, 2500, 0.4);
    noiseBurst(t0 + 0.075, 0.05, amp * 0.8, 2200, 1800, 0.4);
  };
  for (const s of tl.scenes) {
    if (s.type === 'chapter') noiseBurst(s.start - 0.45, 0.9, 0.28, 280, 4200, 0.65, (r() - 0.5) * 0.4);
    if (s.type === 'title') { boom(s.start + 0.05, 0.45); noiseBurst(s.start - 0.6, 0.7, 0.26, 500, 7500, 0.55); }
    if (s.type === 'hook' && s.cues.length >= 3) {
      shutter(s.start + s.cues[1].start - 0.05, 0.48);
      shutter(s.start + s.cues[2].start - 0.05, 0.48);
      boom(s.start + s.cues[2].start, 0.24);
    }
    if (s.type === 'directing' && s.cues[1]) {
      for (let k = 0; k < 6; k++) shutter(s.start + s.cues[1].start + 0.9 + k * 0.16, 0.2);
    }
    // Generic declarative SFX: params.sfx = [{ kind, cue?, dt?, amp? }]
    for (const fx of s.params.sfx || []) {
      const at = s.start + (fx.cue != null && s.cues[fx.cue] ? s.cues[fx.cue].start : 0) + (fx.dt || 0);
      const a = fx.amp ?? 1;
      if (fx.kind === 'shutter') shutter(at, 0.45 * a);
      else if (fx.kind === 'boom') boom(at, 0.4 * a);
      else if (fx.kind === 'whoosh') noiseBurst(at - 0.4, 0.8, 0.26 * a, 360, 5800, 0.58, (r() - 0.5) * 0.5);
      else if (fx.kind === 'tick') noiseBurst(at, 0.02, 0.32 * a, 4800, 3800, 0.35);
    }
  }
}

// ---------- Warm Acoustic Hall Reverb & Analog Tape Saturation ----------
function reverb(x, seedOff, wet = 0.34) {
  const preDelay = Math.round(0.018 * SR);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(d => Math.round((d + seedOff) * SR / 44100));
  const aps = [556, 441, 341, 225].map(d => Math.round((d + seedOff) * SR / 44100));
  const out = new Float32Array(x.length);
  for (const d of combs) {
    const buf = new Float32Array(d); let idx = 0, lp = 0;
    for (let i = 0; i < x.length; i++) {
      const src = i >= preDelay ? x[i - preDelay] : 0;
      const y = buf[idx];
      // Warm high-frequency damping inside the reverb tank
      lp = y * 0.52 + lp * 0.48;
      buf[idx] = src + lp * 0.875;
      idx = (idx + 1) % d;
      out[i] += y / combs.length;
    }
  }
  for (const d of aps) {
    const buf = new Float32Array(d); let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx], v = out[i];
      const y = -v + b;
      buf[idx] = v + b * 0.5;
      idx = (idx + 1) % d;
      out[i] = y;
    }
  }
  // Soft analog tape saturation + wet/dry mix
  for (let i = 0; i < x.length; i++) {
    const mixed = x[i] * (1 - wet) + out[i] * wet * 2.15;
    out[i] = Math.tanh(mixed * 1.18) / 1.12;
  }
  return out;
}

export async function buildAudio(projDir, opts = {}) {
  const t0 = Date.now();
  const tl = buildTimeline(projDir);
  const build = path.join(projDir, 'build');
  fs.mkdirSync(build, { recursive: true });
  const n = Math.ceil((tl.duration + 0.5) * SR);

  // 1. Voice: decode all lines concurrently, place at exact timeline positions
  const voice = new Float32Array(n);
  await Promise.all(tl.lines.filter(l => l.file).map(async l => {
    const pcm = await decodeMono(path.join(projDir, l.file));
    const o = Math.floor(l.start * SR);
    for (let i = 0; i < pcm.length && o + i < n; i++) voice[o + i] += pcm[i];
  }));
  writeWav(path.join(build, 'voice.wav'), [voice]);

  // 2. Score: External Opus BGM (Scheme 2) or Opus Procedural Chamber Engine (Scheme 1)
  const extMusic = resolveExternalMusic(projDir, tl.music, opts.music);
  let L, R;
  if (extMusic) {
    [L, R] = await loadExternalScore(extMusic, tl.duration, tl);
    addSfx(L, R, tl);
    L = reverb(L, 0, 0.14);
    R = reverb(R, 23, 0.14);
  } else {
    console.log(`[audio] synthesizing Opus-style chamber score (Felt Piano + Solo Cello + Con Sordino Strings + Rosewood Marimba)...`);
    const scoreCfg = (tl.music && typeof tl.music === 'object') ? tl.music : {};
    [L, R] = synthOpusScore(tl.duration, tl, scoreCfg);
    addSfx(L, R, tl);
    L = reverb(L, 0, 0.34);
    R = reverb(R, 29, 0.34);
  }

  // Stereo cross-feed for natural room width + master fade in/out + peak normalize
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (tl.duration + 0.35 - t) / 3.8));
    const l0 = L[i], r0 = R[i];
    L[i] = (l0 * 0.92 + r0 * 0.08) * g;
    R[i] = (r0 * 0.92 + l0 * 0.08) * g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const k = 0.72 / (peak || 1);
  writeWav(path.join(build, 'music.wav'), [L.subarray(0, n).map(v => v * k), R.subarray(0, n).map(v => v * k)]);

  // 3. Master Mix: voice EQ/compression + musical sidechain ducking + broadcast -15 LUFS normalization
  await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(build, 'voice.wav'), '-i', path.join(build, 'music.wav'),
    '-filter_complex',
    '[0:a]highpass=f=80,equalizer=f=3500:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=3:attack=5:release=120,aformat=channel_layouts=stereo,asplit=2[v1][v2];' +
    '[1:a]highpass=f=32,equalizer=f=3200:t=q:w=1.2:g=-2.5,volume=0.58[m];' +
    '[m][v2]sidechaincompress=threshold=0.018:ratio=4.5:attack=25:release=680:makeup=1[md];' +
    '[v1][md]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[out]',
    '-map', '[out]', '-c:a', 'pcm_s16le', path.join(build, 'mix.wav')]);
  console.log(`[audio] mix.wav ready (${tl.duration.toFixed(1)}s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const argv = process.argv.slice(2);
  const projArg = argv.find(a => !a.startsWith('--'));
  const mi = argv.indexOf('--music');
  const musicOpt = mi >= 0 ? argv[mi + 1] : undefined;
  buildAudio(path.resolve(projArg), { music: musicOpt }).catch(e => { console.error(e); process.exit(1); });
}
