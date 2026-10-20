// Audio pipeline: voice placement + procedural score + SFX -> build/mix.wav
// Usage: node engine/audio.mjs projects/50mm-portrait
// Runs on CPU in parallel with the GPU video render (render.mjs spawns it).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildTimeline } from './timeline.mjs';

const SR = 48000;

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

// ---------- deterministic RNG ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------- score ----------
function synthScore(dur, tl) {
  const n = Math.ceil((dur + 2) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(7);
  const bpm = 72, beat = 60 / bpm, bar = beat * 4, chordLen = bar * 2;
  // D major, airy: Dmaj9, Bm11, Gmaj7#11, A6sus
  const chords = [
    [50, 57, 61, 64, 66, 69], // D A C# E F# A
    [47, 54, 57, 61, 62, 66], // B F# A C# D F#
    [43, 50, 54, 57, 61, 62], // G D F# A C# D
    [45, 52, 54, 57, 59, 64], // A E F# A B E
  ];
  const introEnd = tl.scenes.find(s => s.id === 'title')?.start ?? 8;
  const outroStart = tl.scenes.find(s => s.type === 'outro')?.start ?? dur - 10;

  const addTone = (t0, len, freq, amp, pan, kind) => {
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    const w = 2 * Math.PI * freq / SR;
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = Math.max(0, i0); i < i1; i++) {
      const t = (i - i0) / SR;
      let env, s;
      if (kind === 'pad') {
        const a = Math.min(1, t / 2.2), rel = Math.min(1, (len - t) / 2.0);
        env = Math.max(0, Math.min(a, rel)) ** 1.5;
        s = Math.sin(w * (i - i0)) + 0.18 * Math.sin(2 * w * (i - i0) + 0.3) + 0.06 * Math.sin(3 * w * (i - i0));
        s *= 1 + 0.15 * Math.sin(2 * Math.PI * 0.21 * t + freq);
      } else { // soft felt piano
        env = Math.min(1, t / 0.006) * Math.exp(-t * (2.2 + freq / 900)) * Math.min(1, (len - t) / 0.05);
        const ph = w * (i - i0);
        s = Math.sin(ph) + 0.42 * Math.exp(-t * 4) * Math.sin(2 * ph) + 0.16 * Math.exp(-t * 7) * Math.sin(3 * ph) + 0.05 * Math.exp(-t * 9) * Math.sin(4.01 * ph);
      }
      const v = s * env * amp;
      L[i] += v * gl; R[i] += v * gr;
    }
  };

  for (let t = 0, k = 0; t < dur + 1; t += chordLen, k++) {
    const ch = chords[k % 4];
    const energy = t < introEnd ? 0.75 : t > outroStart ? 0.8 : 1;
    // pad (two detuned voices, wide)
    for (const m of ch.slice(1)) {
      addTone(t, chordLen + 2.2, mtof(m) * 1.0012, 0.022 * energy, -0.6, 'pad');
      addTone(t, chordLen + 2.2, mtof(m) * 0.9988, 0.022 * energy, 0.6, 'pad');
    }
    // sub
    addTone(t, chordLen + 1, mtof(ch[0] - 12), 0.05 * energy, 0, 'pad');
    // arpeggio 8ths, sparse & humanized
    const arp = [ch[1] + 12, ch[3] + 12, ch[4] + 12, ch[2] + 24, ch[5] + 12, ch[3] + 24];
    for (let s = 0; s < 16; s++) {
      if (t < introEnd * 0.5) break;
      if (r() < (s % 4 === 0 ? 0.92 : 0.5)) {
        const m = arp[(s * 3 + k) % arp.length];
        const tt = t + s * beat / 2 + (r() - 0.5) * 0.02;
        addTone(tt, 3.2, mtof(m), (0.05 + r() * 0.03) * energy, (r() - 0.5) * 0.8, 'piano');
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
    // swept resonant band-pass on white noise (state-variable filter)
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
      L[i] += v * (1 - pan) ; R[i] += v * (1 + pan);
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
    if (s.type === 'chapter') noiseBurst(s.start - 0.45, 0.9, 0.35, 300, 5000, 0.6, (r() - 0.5) * 0.4);
    if (s.type === 'title') { boom(s.start + 0.05, 0.5); noiseBurst(s.start - 0.6, 0.7, 0.3, 600, 9000, 0.5); }
    if (s.type === 'hook') { shutter(s.start + s.cues[1].start - 0.05, 0.5); shutter(s.start + s.cues[2].start - 0.05, 0.5); boom(s.start + s.cues[2].start, 0.25); }
    if (s.type === 'directing') for (let k = 0; k < 6; k++) shutter(s.start + s.cues[1].start + 0.9 + k * 0.16, 0.22);
    // generic declarative SFX: params.sfx = [{ kind, cue?, dt?, amp? }]
    for (const fx of s.params.sfx || []) {
      const at = s.start + (fx.cue != null && s.cues[fx.cue] ? s.cues[fx.cue].start : 0) + (fx.dt || 0);
      const a = fx.amp ?? 1;
      if (fx.kind === 'shutter') shutter(at, 0.45 * a);
      else if (fx.kind === 'boom') boom(at, 0.4 * a);
      else if (fx.kind === 'whoosh') noiseBurst(at - 0.4, 0.8, 0.3 * a, 400, 7000, 0.55, (r() - 0.5) * 0.5);
      else if (fx.kind === 'tick') noiseBurst(at, 0.02, 0.35 * a, 5000, 4000, 0.3);
    }
  }
}

// ---------- reverb (Schroeder/Freeverb style) ----------
function reverb(x, seedOff, wet = 0.28) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map(d => Math.round((d + seedOff) * SR / 44100));
  const aps = [556, 441, 341].map(d => Math.round((d + seedOff) * SR / 44100));
  const out = new Float32Array(x.length);
  for (const d of combs) {
    const buf = new Float32Array(d); let idx = 0, lp = 0;
    for (let i = 0; i < x.length; i++) {
      const y = buf[idx]; lp = y * 0.6 + lp * 0.4;
      buf[idx] = x[i] + lp * 0.86; idx = (idx + 1) % d; out[i] += y / combs.length;
    }
  }
  for (const d of aps) {
    const buf = new Float32Array(d); let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx], v = out[i]; const y = -v + b; buf[idx] = v + b * 0.5; idx = (idx + 1) % d; out[i] = y;
    }
  }
  for (let i = 0; i < x.length; i++) out[i] = x[i] * (1 - wet) + out[i] * wet * 2.2;
  return out;
}

export async function buildAudio(projDir) {
  const t0 = Date.now();
  const tl = buildTimeline(projDir);
  const build = path.join(projDir, 'build');
  fs.mkdirSync(build, { recursive: true });
  const n = Math.ceil((tl.duration + 0.5) * SR);

  // voice: decode all lines concurrently, place at exact timeline positions
  const voice = new Float32Array(n);
  await Promise.all(tl.lines.filter(l => l.file).map(async l => {
    const pcm = await decodeMono(path.join(projDir, l.file));
    const o = Math.floor(l.start * SR);
    for (let i = 0; i < pcm.length && o + i < n; i++) voice[o + i] += pcm[i];
  }));
  writeWav(path.join(build, 'voice.wav'), [voice]);

  let [L, R] = synthScore(tl.duration, tl);
  addSfx(L, R, tl);
  L = reverb(L, 0); R = reverb(R, 23);
  // fade in/out + normalize
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 1.5) * Math.min(1, Math.max(0, (tl.duration + 0.3 - t) / 4));
    L[i] *= g; R[i] *= g; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const k = 0.7 / (peak || 1);
  writeWav(path.join(build, 'music.wav'), [L.subarray(0, n).map(v => v * k), R.subarray(0, n).map(v => v * k)]);

  // mix: duck music under voice, gentle voice EQ, loudness normalize
  await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(build, 'voice.wav'), '-i', path.join(build, 'music.wav'),
    '-filter_complex',
    '[0:a]highpass=f=80,equalizer=f=3500:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=3:attack=5:release=120,aformat=channel_layouts=stereo,asplit=2[v1][v2];' +
    '[1:a]volume=0.55[m];[m][v2]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=600:makeup=1[md];' +
    '[v1][md]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[out]',
    '-map', '[out]', '-c:a', 'pcm_s16le', path.join(build, 'mix.wav')]);
  console.log(`[audio] mix.wav ready (${tl.duration.toFixed(1)}s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  buildAudio(path.resolve(process.argv[2])).catch(e => { console.error(e); process.exit(1); });
}
