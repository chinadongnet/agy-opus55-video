// Parallel renderer: N headless Chrome workers (GPU-accelerated canvas, one CPU core each)
// -> JPEG frames -> N concurrent NVENC encoders -> lossless concat -> mux with audio.
//
//   node engine/render.mjs projects/50mm-portrait                # full render
//   node engine/render.mjs projects/50mm-portrait --stills 3,12.5 # preview stills
//   node engine/render.mjs projects/50mm-portrait --from 40 --to 70 --workers 6
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { buildTimeline } from './timeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const projArg = argv.find(a => !a.startsWith('--') && fs.existsSync(path.resolve(a, 'script.json')));
if (!projArg) { console.error('usage: node engine/render.mjs <projectDir> [--workers N] [--stills t1,t2] [--from s --to s]'); process.exit(1); }
const PROJ = path.resolve(projArg);
const NAME = path.basename(PROJ);
const BUILD = path.join(PROJ, 'build');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

function hasEncoder(name) {
  try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(name); } catch { return false; }
}
function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => (err += d));
    p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}: ${err.slice(-1500)}`))));
  });
}
// puppeteer's browser.close() occasionally never resolves on Windows -> bounded close + hard kill
async function closeBrowser(browser) {
  const pid = browser.process()?.pid;
  const ok = await Promise.race([browser.close().then(() => true, () => false), new Promise(r => setTimeout(() => r(false), 5000))]);
  if (!ok && pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
}

// ---- 1. asset prep: lanczos upscale + light sharpen (parallel, CPU) so Ken Burns zooms stay crisp
async function prepareAssets(tl) {
  const out = path.join(BUILD, 'img'); fs.mkdirSync(out, { recursive: true });
  await Promise.all(Object.entries(tl.assets).map(async ([k, rel]) => {
    const src = path.join(PROJ, rel), dst = path.join(out, k + '.jpg');
    if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', "scale='max(2560,iw)':-2:flags=lanczos,unsharp=5:5:0.55:5:5:0", '-q:v', '2', dst]);
    }
    tl.assets[k] = `build/img/${k}.jpg`;
  }));
}

// ---- 2. static server (canvas needs same-origin images to stay untainted)
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function openWorker(port, tl) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb',
      '--font-render-hinting=none', `--window-size=${tl.width},${tl.height}`],
    defaultViewport: { width: tl.width, height: tl.height, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [page]', m.text()); });
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/engine/runtime/player.html?project=projects/${NAME}`);
  await page.waitForFunction('window.OV && OV.ready', { timeout: 120000 });
  return { browser, page };
}

async function main() {
  const t0 = Date.now();
  const tl = buildTimeline(PROJ);
  fs.mkdirSync(BUILD, { recursive: true });
  await prepareAssets(tl);
  fs.writeFileSync(path.join(BUILD, 'timeline.json'), JSON.stringify(tl, null, 1));
  console.log(`[render] ${NAME}: ${tl.duration.toFixed(1)}s, ${tl.frames} frames @${tl.fps}fps, ${tl.scenes.length} scenes`);
  const srv = await serve();
  const port = srv.address().port;

  // ---- stills mode (fast visual QA)
  if (flag('stills')) {
    const times = String(flag('stills')).split(',').map(Number);
    const dir = path.join(BUILD, 'stills'); fs.mkdirSync(dir, { recursive: true });
    const W = Math.min(times.length, Number(flag('workers', 6)));
    const queue = [...times];
    await Promise.all(Array.from({ length: W }, async () => {
      const { browser, page } = await openWorker(port, tl);
      while (queue.length) {
        const t = queue.shift();
        const b64 = await page.evaluate(i => OV.frame(i, 'image/jpeg', 0.9), Math.round(t * tl.fps));
        const f = path.join(dir, `t${t.toFixed(2).padStart(7, '0')}.jpg`);
        fs.writeFileSync(f, Buffer.from(b64.split(',')[1], 'base64'));
        console.log('  still', f);
      }
      await closeBrowser(browser);
    }));
    srv.close(); return;
  }

  const f0 = Math.floor(Number(flag('from', 0)) * tl.fps);
  const f1 = Math.min(tl.frames, Math.ceil(Number(flag('to', tl.duration)) * tl.fps));
  const total = f1 - f0;
  const workers = Math.max(1, Math.min(Number(flag('workers', Math.min(12, Math.floor(os.cpus().length / 2)))), Math.ceil(total / 30)));
  const enc = hasEncoder('h264_nvenc') ? 'h264_nvenc' : 'libx264';
  console.log(`[render] frames ${f0}..${f1} | ${workers} Chrome workers (GPU canvas) | encoder ${enc} x${workers}`);

  // audio is pure CPU work: run it concurrently with the GPU-heavy video render
  const musicFlag = flag('music');
  const audioArgs = [path.join(ROOT, 'engine', 'audio.mjs'), PROJ, ...(musicFlag ? ['--music', String(musicFlag)] : [])];
  const audioJob = flag('no-audio') ? Promise.resolve() : run('node', audioArgs);

  const chunkDir = path.join(BUILD, 'chunks'); fs.rmSync(chunkDir, { recursive: true, force: true }); fs.mkdirSync(chunkDir, { recursive: true });
  const per = Math.ceil(total / workers);
  let done = 0; const tick = setInterval(() => {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${done}/${total} frames  ${(done / el).toFixed(1)} fps  ${(100 * done / total).toFixed(1)}%   `);
  }, 1000);

  const chunks = await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = f0 + w * per, b = Math.min(f1, a + per);
    if (a >= b) return null;
    const file = path.join(chunkDir, `chunk_${String(w).padStart(3, '0')}.mp4`);
    const vEnc = enc === 'h264_nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '17', '-b:v', '0', '-maxrate', '40M', '-bufsize', '80M', '-spatial-aq', '1', '-profile:v', 'high']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17'];
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(tl.fps), '-c:v', 'mjpeg', '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', ...vEnc, '-g', String(tl.fps * 2),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], { stdio: ['pipe', 'ignore', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg chunk ' + w)))));
    const { browser, page } = await openWorker(port, tl);
    for (let i = a; i < b; i++) {
      const b64 = await page.evaluate(i => OV.frame(i), i);
      const ok = ff.stdin.write(Buffer.from(b64.slice(b64.indexOf(',') + 1), 'base64'));
      if (!ok) await new Promise(r => ff.stdin.once('drain', r));
      done++;
    }
    ff.stdin.end();
    await closeBrowser(browser);
    await closed;
    return file;
  }));
  clearInterval(tick);
  const tv = (Date.now() - t0) / 1000;
  console.log(`\n[render] video frames done in ${tv.toFixed(1)}s (${(total / tv).toFixed(1)} fps)`);

  const list = path.join(chunkDir, 'list.txt');
  fs.writeFileSync(list, chunks.filter(Boolean).map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const silent = path.join(BUILD, 'video.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  await audioJob;

  const outDir = path.join(ROOT, 'output'); fs.mkdirSync(outDir, { recursive: true });
  const partial = f0 > 0 || f1 < tl.frames;
  const outFlag = flag('out');
  const out = outFlag ? path.resolve(String(outFlag)) : path.join(outDir, `${NAME}${partial ? `_${(f0 / tl.fps).toFixed(0)}-${(f1 / tl.fps).toFixed(0)}` : ''}.mp4`);
  const mix = path.join(BUILD, 'mix.wav');
  if (fs.existsSync(mix) && !flag('no-audio')) {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-ss', String(f0 / tl.fps), '-i', mix, '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out]);
  } else fs.copyFileSync(silent, out);
  srv.close();
  console.log(`[render] DONE -> ${out}  (total ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
