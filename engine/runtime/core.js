/* Opus Video runtime — deterministic canvas renderer.
 * Every pixel is a pure function of time t, so any frame can be rendered
 * by any worker in any order (this is what makes parallel rendering possible).
 */
(() => {
  const OV = (window.OV = { scenes: {}, img: {}, ready: false });

  // ---------------------------------------------------------------- math
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    lin: t => t,
    in: t => t * t * t,
    out: t => 1 - Math.pow(1 - t, 3),
    out4: t => 1 - Math.pow(1 - t, 4),
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    expo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    back: t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  function rand(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  // in/out window: fades in over [a, a+fi], out over [b-fo, b]
  const win = (t, a, b, fi = 0.4, fo = 0.4) => Math.min(E.out(seg(t, a, a + fi)), 1 - E.inOut(seg(t, b - fo, b)));

  // ---------------------------------------------------------------- style
  const C = {
    bg: '#0b0a09', bg2: '#16120f', ink: '#f5eee5', dim: 'rgba(245,238,229,0.62)', faint: 'rgba(245,238,229,0.16)',
    line: 'rgba(245,238,229,0.32)', gold: '#e8b878', goldHi: '#ffdcaa', rose: '#e8a296', bad: '#ef7a68', good: '#a8dcb0', cyan: '#9fd0e0',
  };
  const F = {
    serif: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
    sans: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
    latin: 'Georgia, "Noto Serif", serif',
    ui: '"Segoe UI", "Noto Sans", sans-serif',
  };

  // ---------------------------------------------------------------- drawing helpers
  function font(o) { return `${o.italic ? 'italic ' : ''}${o.weight || 400} ${o.size || 40}px ${o.font || F.sans}`; }
  function text(ctx, s, x, y, o = {}) {
    ctx.save();
    ctx.font = font(o);
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.letterSpacing = (o.spacing || 0) + 'px';
    if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.shadowBlur ?? 18; }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth || 1; ctx.strokeText(s, x, y); }
    else ctx.fillText(s, x, y);
    ctx.restore();
  }
  function measure(ctx, s, o = {}) {
    ctx.save(); ctx.font = font(o); ctx.letterSpacing = (o.spacing || 0) + 'px';
    const w = ctx.measureText(s).width; ctx.restore(); return w;
  }
  /* Per-character cinematic reveal: rise + fade + de-blur, staggered. t = seconds since start.
     o.out = time (relative) when it starts leaving; o.fill can be a gradient. */
  function reveal(ctx, s, x, y, t, o = {}) {
    if (t <= 0) return;
    const chars = [...s];
    const st = o.stagger ?? 0.04, dur = o.dur ?? 0.8, rise = o.rise ?? (o.size || 40) * 0.35;
    const total = measure(ctx, s, o);
    let x0 = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    let outA = 1;
    if (o.out != null) outA = 1 - E.inOut(seg(t, o.out, o.out + (o.outDur ?? 0.5)));
    if (outA <= 0) return;
    ctx.save();
    ctx.font = font(o); ctx.letterSpacing = (o.spacing || 0) + 'px';
    ctx.textAlign = 'left'; ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.shadowBlur ?? 18; }
    let acc = '';
    chars.forEach((ch, i) => {
      const cx = x0 + ctx.measureText(acc).width; acc += ch;
      const p = E.out4(seg(t, i * st, i * st + dur));
      if (p <= 0) return;
      ctx.globalAlpha = (o.alpha ?? 1) * p * outA;
      ctx.fillStyle = o.color || C.ink;
      if (o.gradient) ctx.fillStyle = o.gradient;
      const blur = (1 - p) * (o.blur ?? 10);
      ctx.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
      ctx.fillText(ch, cx, y + (1 - p) * rise);
    });
    ctx.restore();
  }
  function cover(ctx, img, x, y, w, h, zoom = 1, fx = 0.5, fy = 0.5) {
    if (!img) { ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h); return { map: (u, v) => [x + u * w, y + v * h], s: 1 }; }
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * s, dh = img.height * s;
    const dx = x + (w - dw) * fx, dy = y + (h - dh) * fy;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { map: (u, v) => [dx + u * dw, dy + v * dh], s, dx, dy, dw, dh };
  }
  // Ken Burns: kb = [z0,fx0,fy0,z1,fx1,fy1]
  function kenburns(ctx, img, p, kb = [1.05, 0.5, 0.5, 1.15, 0.5, 0.5], box) {
    const e = E.sine(clamp(p));
    const [x, y, w, h] = box || [0, 0, OV.W, OV.H];
    return cover(ctx, img, x, y, w, h, lerp(kb[0], kb[3], e), lerp(kb[1], kb[4], e), lerp(kb[2], kb[5], e));
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  // frosted glass panel: blurs what is already on the canvas behind it
  function glass(ctx, x, y, w, h, r = 18, o = {}) {
    ctx.save();
    rrect(ctx, x, y, w, h, r); ctx.clip();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.filter = `blur(${o.blur ?? 22}px) saturate(1.2)`;
    ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
    ctx.filter = 'none';
    ctx.fillStyle = o.fill || 'rgba(18,15,12,0.48)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = (o.alpha ?? 1) * 0.9;
    rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255,240,220,0.35)'); g.addColorStop(0.5, 'rgba(255,240,220,0.08)'); g.addColorStop(1, 'rgba(255,240,220,0.22)');
    ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  function line(ctx, x1, y1, x2, y2, p = 1, o = {}) {
    if (p <= 0) return;
    ctx.save(); ctx.strokeStyle = o.color || C.line; ctx.lineWidth = o.width || 1.5; ctx.globalAlpha *= o.alpha ?? 1;
    if (o.dash) ctx.setLineDash(o.dash);
    if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = o.glow; }
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(lerp(x1, x2, p), lerp(y1, y2, p)); ctx.stroke(); ctx.restore();
  }
  function arrowHead(ctx, x, y, ang, size = 10, color = C.ink) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, -size * 0.45); ctx.lineTo(-size * 0.75, 0); ctx.lineTo(-size, size * 0.45); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function dimension(ctx, x1, y1, x2, y2, label, p = 1, o = {}) {
    const col = o.color || C.dim;
    line(ctx, x1, y1, x2, y2, p, { color: col, width: 1.2 });
    if (p > 0.98) {
      const a = Math.atan2(y2 - y1, x2 - x1);
      arrowHead(ctx, x2, y2, a, 9, col); arrowHead(ctx, x1, y1, a + Math.PI, 9, col);
    }
    if (label) text(ctx, label, (x1 + x2) / 2 + (o.dx || 0), (y1 + y2) / 2 + (o.dy ?? -14), { size: o.size || 24, color: o.labelColor || C.ink, align: 'center', font: o.font || F.sans, alpha: E.out(seg(p, 0.5, 1)), weight: o.weight || 400 });
  }
  // animated ring annotation with label + check / cross
  function ring(ctx, x, y, r, t, o = {}) {
    if (t <= 0) return;
    const col = o.ok === false ? C.bad : o.color || C.gold;
    const p = E.out(seg(t, 0, 0.9));
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(x, y, r * lerp(1.25, 1, p), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
    ctx.globalAlpha = 0.35 * p; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r * lerp(1.25, 1, p) + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (o.label) {
      const side = o.side || 1;
      const lx = x + side * (r + 30), ly = y - r * 0.55;
      const q = E.out(seg(t, 0.4, 1.1));
      line(ctx, x + side * r * 0.72, y - r * 0.7, lx, ly, q, { color: col, width: 1.2 });
      line(ctx, lx, ly, lx + side * 46, ly, E.out(seg(t, 0.8, 1.2)), { color: col, width: 1.2 });
      const mark = o.ok === false ? '✕' : '✓';
      const label = `${mark}  ${o.label}`;
      const tw = measure(ctx, label, { size: 30, weight: 500 });
      const tx = side > 0 ? lx + 58 : lx - 58 - tw;
      text(ctx, label, tx, ly + 10, { size: 30, weight: 500, color: C.ink, alpha: E.out(seg(t, 0.8, 1.4)), shadow: 'rgba(0,0,0,0.8)', shadowBlur: 12 });
    }
  }
  function kicker(ctx, s, x, y, t, o = {}) {
    const a = E.out(seg(t, 0, 0.6)) * (o.alpha ?? 1);
    const w = E.out(seg(t, 0, 0.8)) * 36;
    line(ctx, x, y - 8, x + w, y - 8, 1, { color: o.color || C.gold, width: 1.5 });
    text(ctx, s, x + 52, y, { size: o.size || 20, font: F.ui, weight: 600, spacing: 5, color: o.color || C.gold, alpha: a });
  }

  // bokeh sprites (pre-rendered for speed)
  const spriteCache = {};
  function bokehSprite(color, ring = 0.35) {
    const key = color + ring;
    if (spriteCache[key]) return spriteCache[key];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 124);
    gr.addColorStop(0, color.replace('A', '0.55')); gr.addColorStop(0.78, color.replace('A', '0.62'));
    gr.addColorStop(0.9, color.replace('A', String(0.62 + ring))); gr.addColorStop(0.97, color.replace('A', '0.35')); gr.addColorStop(1, color.replace('A', '0'));
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    return (spriteCache[key] = c);
  }
  function bokeh(ctx, x, y, r, color = 'rgba(255,200,140,A)', alpha = 1, soft = 0) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.globalCompositeOperation = 'lighter';
    if (soft) ctx.filter = `blur(${soft}px)`;
    ctx.drawImage(bokehSprite(color), x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  // warm dark backdrop with drifting bokeh field
  function backdrop(ctx, t, o = {}) {
    const W = OV.W, H = OV.H;
    const g = ctx.createRadialGradient(W * (o.cx ?? 0.5), H * (o.cy ?? 0.42), 50, W * 0.5, H * 0.5, W * 0.75);
    g.addColorStop(0, o.c0 || '#221a14'); g.addColorStop(0.55, o.c1 || '#110e0c'); g.addColorStop(1, '#060505');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = rand(o.seed ?? 11), n = o.count ?? 26;
    for (let i = 0; i < n; i++) {
      const bx = r() * W, by = r() * H, rad = 30 + r() * 110, sp = 4 + r() * 10, ph = r() * 6.28;
      const x = (bx + Math.sin(t * 0.13 + ph) * 40 + t * sp * (r() > 0.5 ? 1 : -1)) % (W + 300) - 150;
      const y = by - t * sp * 0.6 + Math.cos(t * 0.17 + ph) * 25;
      const yy = ((y % (H + 300)) + H + 300) % (H + 300) - 150;
      const col = r() > 0.35 ? 'rgba(255,196,130,A)' : 'rgba(255,160,150,A)';
      bokeh(ctx, x, yy, rad, col, (o.intensity ?? 0.09) * (0.5 + r()), 2 + r() * 6);
    }
  }

  // ---------------------------------------------------------------- post FX
  let grain = [], vignette = null;
  function initFX() {
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); const id = g.createImageData(256, 256); const r = rand(1000 + k);
      for (let i = 0; i < id.data.length; i += 4) { const v = (r() * 255) | 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0); grain.push(c);
    }
    vignette = document.createElement('canvas'); vignette.width = OV.W; vignette.height = OV.H;
    const v = vignette.getContext('2d');
    const gr = v.createRadialGradient(OV.W / 2, OV.H / 2, OV.H * 0.45, OV.W / 2, OV.H / 2, OV.W * 0.72);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = gr; v.fillRect(0, 0, OV.W, OV.H);
  }
  function post(ctx, frame) {
    ctx.save();
    ctx.drawImage(vignette, 0, 0);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07;
    const pat = ctx.createPattern(grain[frame % grain.length], 'repeat');
    const r = rand(frame * 7 + 3);
    ctx.translate(-r() * 256, -r() * 256);
    ctx.fillStyle = pat; ctx.fillRect(0, 0, OV.W + 256, OV.H + 256);
    ctx.restore();
  }

  // ---------------------------------------------------------------- overlays
  function subtitles(ctx, t) {
    const L = OV.tl.lines.find(l => t >= l.start - 0.05 && t < l.end + 0.25);
    if (!L || !L.sub || OV.noSub.has(L.scene)) return;
    const a = Math.min(E.out(seg(t, L.start - 0.05, L.start + 0.15)), 1 - E.out(seg(t, L.end + 0.05, L.end + 0.25)));
    const W = OV.W, H = OV.H;
    ctx.save();
    ctx.globalAlpha = a * 0.75;
    const g = ctx.createLinearGradient(0, H - 210, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, H - 210, W, 210);
    ctx.restore();
    let s = L.text.replace(/[。；，]$/, '');
    let size = 38;
    while (measure(ctx, s, { size, weight: 500, spacing: 1 }) > W - 260 && size > 26) size -= 1;
    text(ctx, s, W / 2, H - 74, { size, weight: 500, spacing: 1, align: 'center', alpha: a, shadow: 'rgba(0,0,0,0.9)', shadowBlur: 14 });
  }
  function hud(ctx, t, sc, alpha) {
    if (alpha <= 0.01) return;
    const W = OV.W;
    ctx.save(); ctx.globalAlpha = alpha;
    const ch = sc.chapter, n = OV.tl.chapters;
    const chScene = OV.tl.scenes.find(s => s.type === 'chapter' && s.chapter === ch);
    const H0 = OV.tl.hud || {};
    text(ctx, H0.label || 'PORTRAIT NOTES', 72, 66, { size: 15, font: F.ui, weight: 600, spacing: 5, color: C.dim });
    text(ctx, chScene?.params?.tag || H0.tag || '50mm  ƒ/1.2', 72, 92, { size: 18, font: F.latin, italic: true, color: C.gold });
    const title = chScene?.params?.title || '';
    text(ctx, title, W - 72, 92, { size: 20, align: 'right', color: C.dim, weight: 400 });
    text(ctx, `${String(ch).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, W - 72, 66, { size: 18, font: F.latin, italic: true, align: 'right', color: C.gold });
    ctx.restore();
  }
  function progressBar(ctx, t) {
    const W = OV.W, p = t / OV.tl.duration;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, W, 3);
    const g = ctx.createLinearGradient(0, 0, W * p, 0);
    g.addColorStop(0, 'rgba(232,184,120,0.2)'); g.addColorStop(1, 'rgba(255,220,170,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * p, 3);
    ctx.restore();
  }

  // ---------------------------------------------------------------- compositor
  let main, buf, bufCtx;
  function sceneState(sc, t) {
    const cues = sc.cues;
    return {
      t, d: sc.duration, p: t / sc.duration, params: sc.params, id: sc.id, chapter: sc.chapter,
      cue: i => (cues[i] ? cues[i].start : sc.duration),
      cueEnd: i => (cues[i] ? cues[i].end : sc.duration),
      since: i => t - (cues[i] ? cues[i].start : sc.duration),
      W: OV.W, H: OV.H, img: k => OV.img[k], seed: hash(sc.id),
    };
  }
  function drawScene(ctx, sc, t) {
    const fn = OV.scenes[sc.type];
    ctx.save();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, OV.W, OV.H);
    if (fn) fn(ctx, sceneState(sc, t));
    else text(ctx, `missing scene: ${sc.type}`, 100, 100, { size: 40, color: 'red' });
    ctx.restore();
  }
  const hudAlpha = (sc, tin) => (sc.chapter > 0 && sc.type !== 'chapter' ? 1 : 0);

  function renderAt(t) {
    const ctx = main, S = OV.tl.scenes;
    let k = 0;
    for (let i = 0; i < S.length; i++) if (S[i].start <= t) k = i;
    const cur = S[k], tin = t - cur.start;
    let hudA = hudAlpha(cur, tin);
    if (k > 0 && tin < cur.trans) {
      const prev = S[k - 1];
      const p = E.inOut(tin / cur.trans);
      drawScene(ctx, prev, t - prev.start);
      bufCtx.clearRect(0, 0, OV.W, OV.H);
      drawScene(bufCtx, cur, tin);
      ctx.save();
      if (cur.transType === 'flash') {
        ctx.globalAlpha = p; ctx.drawImage(buf, 0, 0);
        ctx.globalAlpha = Math.sin(Math.PI * p) * 0.85; ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffe2bd'; ctx.fillRect(0, 0, OV.W, OV.H);
      } else {
        const z = lerp(1.035, 1, p);
        ctx.globalAlpha = p;
        ctx.translate(OV.W / 2, OV.H / 2); ctx.scale(z, z); ctx.translate(-OV.W / 2, -OV.H / 2);
        ctx.drawImage(buf, 0, 0);
      }
      ctx.restore();
      hudA = lerp(hudAlpha(prev, 0), hudA, p);
    } else {
      drawScene(ctx, cur, tin);
    }
    hud(ctx, t, cur.chapter ? cur : S[Math.max(0, k - 1)], hudA * 0.95);
    subtitles(ctx, t);
    progressBar(ctx, t);
    post(ctx, Math.round(t * OV.tl.fps));
    // global fade in / out
    const fade = Math.min(seg(t, 0, 0.35), 1 - seg(t, OV.tl.duration - 1.4, OV.tl.duration));
    if (fade < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fade})`; ctx.fillRect(0, 0, OV.W, OV.H); }
  }

  OV.frame = (i, type = 'image/jpeg', q = 0.94) => {
    renderAt(i / OV.tl.fps);
    return main.canvas.toDataURL(type, q);
  };
  OV.renderAt = renderAt;

  OV.boot = async (project, opt = {}) => {
    const base = `/${project}/`;
    OV.base = base;
    OV.tl = await (await fetch(base + 'build/timeline.json?' + Date.now())).json();
    OV.W = OV.tl.width; OV.H = OV.tl.height;
    OV.noSub = new Set(OV.tl.scenes.filter(s => s.params.noSub).map(s => s.id));
    const cv = document.getElementById('c');
    cv.width = OV.W; cv.height = OV.H;
    main = cv.getContext('2d', { alpha: false, willReadFrequently: false });
    buf = document.createElement('canvas'); buf.width = OV.W; buf.height = OV.H; bufCtx = buf.getContext('2d');
    main.imageSmoothingQuality = 'high'; bufCtx.imageSmoothingQuality = 'high';
    await Promise.all(Object.entries(OV.tl.assets).map(([k, rel]) => new Promise(res => {
      const im = new Image(); im.onload = () => { OV.img[k] = im; res(); }; im.onerror = () => { console.warn('img fail', rel); res(); };
      im.src = base + rel;
    })));
    await Promise.all(Object.values(OV.img).map(im => im.decode().catch(() => {})));
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = base + 'scenes.js?' + Date.now(); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    for (const w of [300, 400, 500, 600, 700]) {
      await document.fonts.load(`${w} 40px "Noto Serif SC"`, '字'); await document.fonts.load(`${w} 40px "Noto Sans SC"`, '字');
    }
    await document.fonts.ready;
    initFX();
    OV.ready = true;
  };

  Object.assign(OV, { clamp, lerp, seg, E, rand, hash, win, C, F, text, measure, reveal, cover, kenburns, rrect, glass, line, arrowHead, dimension, ring, kicker, bokeh, bokehSprite, backdrop });
})();
