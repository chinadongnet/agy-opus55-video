// One-command pipeline:  node engine/build.mjs projects/<name> [--workers N] [--force-tts]
//   1. TTS   (python, network-bound, 8 concurrent requests, content-hash cached)
//   2. render (N Chrome GPU-canvas workers + N NVENC encoders)
//      └─ audio.mjs runs concurrently on CPU (score synth + SFX + voice mix)
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const proj = argv.find(a => !a.startsWith('--'));
if (!proj) { console.error('usage: node engine/build.mjs projects/<name> [--workers N] [--force-tts]'); process.exit(1); }

const step = (cmd, args) => new Promise((res, rej) => {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const p = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT });
  p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

const t0 = Date.now();
await step('python', [path.join('engine', 'tts.py'), proj, ...(argv.includes('--force-tts') ? ['--force'] : [])]);
const wi = argv.indexOf('--workers');
await step('node', [path.join('engine', 'render.mjs'), proj, ...(wi >= 0 ? ['--workers', argv[wi + 1]] : [])]);
console.log(`\n✔ build finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
