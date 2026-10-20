// Timeline builder: script.json + build/voice.json -> absolute scene / line timing.
// Shared by audio.mjs and render.mjs so picture and sound are always in sync.
import fs from 'node:fs';
import path from 'node:path';

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

export function resolveAsset(projDir, rel) {
  if (fs.existsSync(path.join(projDir, rel)) && path.extname(rel)) return rel;
  for (const e of IMG_EXT) if (fs.existsSync(path.join(projDir, rel + e))) return rel + e;
  return null;
}

export function buildTimeline(projDir) {
  const script = JSON.parse(fs.readFileSync(path.join(projDir, 'script.json'), 'utf8'));
  const voicePath = path.join(projDir, 'build', 'voice.json');
  const voice = fs.existsSync(voicePath) ? JSON.parse(fs.readFileSync(voicePath, 'utf8')) : {};
  const T = { lead: 0.35, gap: 0.22, tail: 0.55, trans: 0.6, ...(script.timing || {}) };

  const scenes = [];
  const lines = [];
  let t = 0;
  for (const sc of script.scenes) {
    const lead = sc.lead ?? T.lead, gap = sc.gap ?? T.gap, tail = sc.tail ?? T.tail;
    const trans = scenes.length === 0 ? 0 : (sc.trans ?? T.trans);
    const start = t;
    const cues = [];
    let cur = start + lead;
    (sc.lines || []).forEach((ln, j) => {
      if (typeof ln === 'string') ln = { text: ln };
      const id = `${sc.id}-${j}`;
      const v = voice[id];
      // Fallback estimate (~4.6 CJK chars/sec) if TTS hasn't been run yet.
      const dur = v ? v.duration : Math.max(1.2, [...(ln.say || ln.text)].length / 4.6);
      const L = { id, scene: sc.id, text: ln.text, sub: ln.sub !== false, start: cur, end: cur + dur, file: v?.file || null };
      lines.push(L);
      cues.push({ start: cur - start, end: cur + dur - start });
      cur += dur + (ln.pauseAfter ?? gap);
    });
    let end = cues.length ? start + cues[cues.length - 1].end + tail : start + (sc.duration ?? 3);
    if (sc.minDuration) end = Math.max(end, start + sc.minDuration);
    scenes.push({
      id: sc.id, type: sc.type, chapter: sc.chapter || 0, params: sc.params || {},
      start, end, duration: end - start, trans, transType: sc.transType || 'fade', cues,
    });
    t = end;
  }
  const v = script.video || {};
  const assets = {};
  for (const [k, rel] of Object.entries(script.assets || {})) {
    const r = resolveAsset(projDir, rel);
    if (r) assets[k] = r; else console.warn(`[timeline] missing asset ${k}: ${rel}`);
  }
  return {
    title: script.title, subtitle: script.subtitle, hud: script.hud || null,
    music: script.music || null,
    width: v.width || 1920, height: v.height || 1080, fps: v.fps || 30,
    duration: t, frames: Math.ceil(t * (v.fps || 30)),
    chapters: Math.max(0, ...scenes.map(s => s.chapter)),
    scenes, lines, assets,
  };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const tl = buildTimeline(path.resolve(process.argv[2]));
  for (const s of tl.scenes) console.log(`${s.start.toFixed(2).padStart(7)}  ${s.duration.toFixed(2).padStart(6)}  ${s.id}`);
  console.log(`total ${tl.duration.toFixed(2)}s  (${(tl.duration / 60).toFixed(2)} min)  frames ${tl.frames}`);
}
