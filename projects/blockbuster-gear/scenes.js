/* blockbuster-gear — procedural scene library.
 * Every scene is a pure function (ctx, s) of scene-local time s.t, so frames
 * can be rendered by any worker in any order.
 * Written as four blocks; block 1 exports shared helpers on OV.K.
 */
// ==================================================================== BLOCK 1 · helpers + structure scenes
(() => {
  const { clamp, lerp, seg, E, rand, C, F, text, measure, reveal, cover, kenburns, rrect, glass, line, arrowHead, kicker, backdrop } = OV;
  const S = OV.scenes;
  const TAU = Math.PI * 2;

  for (const sc of OV.tl.scenes) if (['opener', 'title', 'recap', 'outro'].includes(sc.type)) OV.noSub.add(sc.id);

  // ------------------------------------------------------------ helpers
  function shade(ctx, a, color = '#000') {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp(a); ctx.fillStyle = color; ctx.fillRect(0, 0, OV.W, OV.H); ctx.restore();
  }
  function scrim(ctx, side, a = 0.75, w = 0.6) {
    const W = OV.W, H = OV.H; let g;
    if (side === 'left') g = ctx.createLinearGradient(0, 0, W * w, 0);
    else if (side === 'right') g = ctx.createLinearGradient(W, 0, W * (1 - w), 0);
    else if (side === 'bottom') g = ctx.createLinearGradient(0, H, 0, H * (1 - w));
    else g = ctx.createLinearGradient(0, 0, 0, H * w);
    g.addColorStop(0, `rgba(8,6,5,${a})`); g.addColorStop(0.55, `rgba(8,6,5,${a * 0.45})`); g.addColorStop(1, 'rgba(8,6,5,0)');
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  function grade(ctx, warm = 0.12, col = '#ffb070') {
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = warm;
    ctx.fillStyle = col; ctx.fillRect(0, 0, OV.W, OV.H); ctx.restore();
  }
  function revealSegs(ctx, segs, x, y, t, o = {}) {
    const st = o.stagger ?? 0.04;
    const total = segs.reduce((a, g) => a + measure(ctx, g.s, o), 0);
    let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x, n = 0;
    for (const g of segs) {
      reveal(ctx, g.s, cx, y, t - n * st, { ...o, align: 'left', color: g.c || o.color });
      cx += measure(ctx, g.s, o); n += [...g.s].length;
    }
  }
  function pill(ctx, s, x, y, a, o = {}) {
    if (a <= 0) return 0;
    const size = o.size || 24, padX = size * 0.75, h = size * 1.9;
    const w = measure(ctx, s, { size, weight: o.weight || 500 }) + padX * 2 + (o.dot ? 16 : 0);
    const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 12);
    rrect(ctx, x0, y - h / 2, w, h, h / 2);
    ctx.fillStyle = o.fill || 'rgba(14,11,9,0.62)'; ctx.fill();
    ctx.strokeStyle = o.stroke || 'rgba(255,230,200,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    if (o.dot) { ctx.fillStyle = o.dot; ctx.shadowColor = o.dot; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x0 + padX * 0.8, y, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    text(ctx, s, x0 + padX + (o.dot ? 16 : 0), y + size * 0.36, { size, weight: o.weight || 500, color: o.color || C.ink });
    ctx.restore();
    return w;
  }
  function kickerC(ctx, s, cx, y, t, o = {}) {
    const w = 52 + measure(ctx, s, { size: o.size || 20, font: F.ui, weight: 600, spacing: 5 });
    kicker(ctx, s, cx - w / 2, y, t, o);
  }
  function viewfinder(ctx, t, o = {}) {
    const W = OV.W, H = OV.H, a = o.alpha ?? 1;
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    const m = o.margin || 64, L = 44;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }
    ctx.globalAlpha = a * 0.12; ctx.lineWidth = 1;
    for (const k of [1, 2]) { ctx.beginPath(); ctx.moveTo(W * k / 3, m); ctx.lineTo(W * k / 3, H - m); ctx.moveTo(m, H * k / 3); ctx.lineTo(W - m, H * k / 3); ctx.stroke(); }
    ctx.globalAlpha = a;
    if (o.af) {
      const [fx, fy] = o.af, lock = clamp(o.lock ?? 1), col = o.afColor || (lock >= 1 ? '#8dffa6' : 'rgba(255,255,255,0.9)');
      const sz = (o.afSize || 80) * lerp(1.5, 1, E.out(lock)), l = sz * 0.3;
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.shadowColor = col; ctx.shadowBlur = lock >= 1 ? 12 : 0;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = fx + sx * sz / 2, cy = fy + sy * sz / 2;
        ctx.beginPath(); ctx.moveTo(cx, cy - sy * l); ctx.lineTo(cx, cy); ctx.lineTo(cx - sx * l, cy); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    if (o.info) {
      const items = o.info, y = H - m - 18;
      let x = W / 2 - items.length * 95;
      for (const it of items) { text(ctx, it, x + 95, y, { size: 26, font: F.ui, weight: 600, align: 'center', color: 'rgba(255,255,255,0.92)', spacing: 1 }); x += 190; }
    }
    if (o.rec && Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = '#ff4b3e'; ctx.beginPath(); ctx.arc(m + 22, m + 70, 8, 0, TAU); ctx.fill();
      text(ctx, 'REC', m + 40, m + 79, { size: 22, font: F.ui, weight: 700, color: '#ff6b5e' });
    }
    ctx.restore();
  }
  function blink(ctx, t, t0) {
    const d = t - t0;
    if (d < -0.08 || d > 0.14) return;
    shade(ctx, E.out(clamp(d < 0 ? 1 - (-d / 0.08) : 1 - d / 0.14)), '#000');
  }
  function letterbox(ctx, p, ratio = 2.39) {
    if (p <= 0) return;
    const W = OV.W, H = OV.H, bh = (H - W / ratio) / 2 * p;
    ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh); ctx.restore();
  }
  // place image point (u,v) at box centre, zoomed, clamped so box stays covered
  function coverAt(ctx, img, x, y, w, h, zoom, u, v) {
    if (!img) { ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h); return; }
    const s = Math.max(w / img.width, h / img.height) * zoom, dw = img.width * s, dh = img.height * s;
    const dx = clamp(x + w / 2 - u * dw, x + w - dw, x), dy = clamp(y + h / 2 - v * dh, y + h - dh, y);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return { map: (a, b) => [dx + a * dw, dy + b * dh] };
  }
  function roundImg(ctx, img, x, y, w, h, r, zoom = 1, u = 0.5, v = 0.5, filter) {
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
    if (filter) ctx.filter = filter;
    coverAt(ctx, img, x, y, w, h, zoom, u, v); ctx.restore();
  }
  const blurCache = {};
  function blurred(key, im, px) {
    const k = key + px;
    if (blurCache[k]) return blurCache[k];
    const c = document.createElement('canvas'); c.width = 960; c.height = 540;
    const g = c.getContext('2d');
    if (im) { g.filter = `blur(${px}px)`; g.drawImage(im, -20, -20, c.width + 40, c.height + 40); }
    return (blurCache[k] = c);
  }
  function cameraGlyph(ctx, x, y, s = 1, ang = 0, col = C.ink) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(20,16,13,0.9)'; ctx.strokeStyle = col; ctx.lineWidth = 2 / s;
    rrect(ctx, -46, -30, 62, 60, 8); ctx.fill(); ctx.stroke();
    rrect(ctx, -36, -42, 26, 12, 3); ctx.fill(); ctx.stroke();
    rrect(ctx, 16, -20, 34, 40, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.fillRect(48, -20, 3, 40);
    ctx.restore();
  }
  // colour utils
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixC = (a, b, t) => { a = typeof a === 'string' ? rgb(a) : a; b = typeof b === 'string' ? rgb(b) : b; return [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t); };
  const css = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
  // active-window helper: 1 while cue i is being spoken (with soft edges)
  const activeCue = (s, i, pre = 0.15) => s.t >= s.cue(i) - pre && s.t < (s.cue(i + 1) ?? s.d) - pre;

  // line-art icons, drawn in a ±30 unit box
  function icon(ctx, kind, x, y, sc = 1, col = C.gold) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2 / sc; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const P = () => ctx.beginPath();
    switch (kind) {
      case 'camera':
        rrect(ctx, -26, -14, 52, 34, 6); ctx.stroke();
        P(); ctx.moveTo(-10, -14); ctx.lineTo(-6, -22); ctx.lineTo(8, -22); ctx.lineTo(12, -14); ctx.stroke();
        P(); ctx.arc(0, 3, 10, 0, TAU); ctx.stroke(); P(); ctx.arc(0, 3, 4, 0, TAU); ctx.fill();
        P(); ctx.arc(19, -7, 2, 0, TAU); ctx.fill(); break;
      case 'lens':
        rrect(ctx, -24, -14, 38, 28, 4); ctx.stroke();
        rrect(ctx, 14, -20, 10, 40, 3); ctx.stroke();
        for (const lx of [-14, -6, 2]) { P(); ctx.moveTo(lx, -14); ctx.lineTo(lx, 14); ctx.stroke(); } break;
      case 'lens2':
        for (const r of [24, 15, 6]) { P(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
        P(); ctx.arc(-6, -6, 3, 0, TAU); ctx.fill(); break;
      case 'reflector':
        P(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
        ctx.save(); P(); ctx.arc(0, 0, 24, -Math.PI * 0.75, Math.PI * 0.25); ctx.closePath(); ctx.globalAlpha = 0.45; ctx.fill(); ctx.restore();
        for (let k = 0; k < 3; k++) { const a = -0.5 + k * 0.5; P(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); ctx.stroke(); } break;
      case 'flash':
        rrect(ctx, -16, -26, 32, 16, 3); ctx.stroke(); rrect(ctx, -10, -10, 20, 28, 3); ctx.stroke();
        P(); ctx.moveTo(3, -4); ctx.lineTo(-4, 5); ctx.lineTo(2, 5); ctx.lineTo(-3, 14); ctx.stroke();
        P(); ctx.moveTo(-12, 22); ctx.lineTo(12, 22); ctx.stroke(); break;
      case 'tripod':
        rrect(ctx, -12, -28, 24, 12, 3); ctx.stroke();
        P(); ctx.moveTo(0, -16); ctx.lineTo(0, -4); ctx.moveTo(0, -4); ctx.lineTo(-22, 28); ctx.moveTo(0, -4); ctx.lineTo(0, 28); ctx.moveTo(0, -4); ctx.lineTo(22, 28); ctx.stroke(); break;
      case 'cpl':
        P(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
        ctx.save(); P(); ctx.arc(0, 0, 18, 0, TAU); ctx.clip();
        for (let k = -3; k <= 3; k++) { P(); ctx.moveTo(k * 6, -20); ctx.lineTo(k * 6, 20); ctx.globalAlpha = 0.6; ctx.stroke(); } ctx.restore();
        P(); ctx.arc(0, 0, 31, -0.9, -0.2); ctx.stroke(); arrowHead(ctx, Math.cos(-0.2) * 31, Math.sin(-0.2) * 31, 1.37, 8, col); break;
      case 'nd': {
        const g = ctx.createLinearGradient(0, -22, 0, 22); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
        rrect(ctx, -22, -22, 44, 44, 4); ctx.save(); ctx.fillStyle = g; ctx.fill(); ctx.restore(); ctx.stroke();
        rrect(ctx, -14, -28, 44, 44, 4); ctx.save(); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.restore(); break;
      }
      case 'gimbal':
        P(); ctx.moveTo(0, 30); ctx.lineTo(0, 8); ctx.lineTo(-20, 8); ctx.lineTo(-20, -20); ctx.lineTo(-8, -20); ctx.stroke();
        rrect(ctx, -6, -28, 26, 18, 3); ctx.stroke(); P(); ctx.arc(24, -19, 4, 0, TAU); ctx.stroke();
        rrect(ctx, -5, 14, 10, 18, 3); ctx.stroke(); break;
      case 'mic':
        rrect(ctx, -8, -28, 16, 30, 8); ctx.stroke();
        P(); ctx.arc(0, -6, 16, 0.15, Math.PI - 0.15); ctx.stroke();
        P(); ctx.moveTo(0, 10); ctx.lineTo(0, 24); ctx.moveTo(-10, 24); ctx.lineTo(10, 24); ctx.stroke(); break;
      case 'monitor':
        rrect(ctx, -28, -20, 56, 36, 4); ctx.stroke();
        P(); ctx.moveTo(-20, 6); for (let k = 0; k <= 20; k++) ctx.lineTo(-20 + k * 2, 6 - Math.abs(Math.sin(k * 0.9)) * 16 - (k % 5 === 0 ? 4 : 0)); ctx.stroke();
        P(); ctx.moveTo(0, 16); ctx.lineTo(0, 26); ctx.moveTo(-10, 26); ctx.lineTo(10, 26); ctx.stroke(); break;
      case 'sun':
        P(); ctx.arc(0, 0, 10, 0, TAU); ctx.stroke();
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8; P(); ctx.moveTo(Math.cos(a) * 16, Math.sin(a) * 16); ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 24); ctx.stroke(); } break;
      case 'cube':
        P(); ctx.moveTo(0, -24); ctx.lineTo(22, -12); ctx.lineTo(22, 14); ctx.lineTo(0, 26); ctx.lineTo(-22, 14); ctx.lineTo(-22, -12); ctx.closePath(); ctx.stroke();
        P(); ctx.moveTo(-22, -12); ctx.lineTo(0, 0); ctx.lineTo(22, -12); ctx.moveTo(0, 0); ctx.lineTo(0, 26); ctx.stroke(); break;
      case 'clock':
        P(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
        P(); ctx.moveTo(0, 0); ctx.lineTo(0, -15); ctx.moveTo(0, 0); ctx.lineTo(11, 6); ctx.stroke(); break;
    }
    ctx.restore();
  }

  OV.K = { TAU, shade, scrim, grade, revealSegs, pill, kickerC, viewfinder, blink, letterbox, coverAt, roundImg, blurred, cameraGlyph, rgb, mixC, css, activeCue, icon };

  // ============================================================ OPENER
  S.opener = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1), c2 = s.cue(2), c3 = s.cue(3);
    const capY = H - 128;
    const capO = { size: 62, weight: 600, font: F.serif, shadow: 'rgba(0,0,0,0.85)', shadowBlur: 22, spacing: 2, align: 'center', stagger: 0.04, dur: 0.6 };
    const shots = [
      { img: 'portrait', a: 0, b: c1, kb: [1.2, 0.56, 0.36, 1.06, 0.55, 0.38], en: 'PORTRAIT', segs: [{ s: '有人拍出 ' }, { s: '杂志封面', c: C.goldHi }], info: ['85mm', 'ƒ1.4', '1/1000', 'ISO 100'], af: [0.555, 0.33] },
      { img: 'landscape', a: c1, b: c2, kb: [1.03, 0.5, 0.7, 1.14, 0.5, 0.4], en: 'LANDSCAPE', segs: [{ s: '有人拍出 ' }, { s: '壁纸级风光', c: C.goldHi }], info: ['16mm', 'ƒ11', '1/4 s', 'ISO 64'] },
      { img: 'cinema', a: c2, b: c3, kb: [1.14, 0.3, 0.4, 1.03, 0.4, 0.45], en: 'CINEMA', segs: [{ s: '有人拍出 ' }, { s: '电影一样的画面', c: C.goldHi }], info: ['24 fps', '1/50', 'ISO 800', 'S-Log3'], cine: true },
    ];
    if (t < c3) {
      const sh = shots.find(x => t >= x.a && t < x.b) || shots[0];
      const tt = t - sh.a, d = sh.b - sh.a;
      const m = kenburns(ctx, s.img(sh.img), tt / d, sh.kb);
      grade(ctx, 0.08);
      if (sh.cine) letterbox(ctx, E.out(seg(tt, 0, 0.7)));
      const af = sh.af ? m.map(sh.af[0], sh.af[1]) : null;
      viewfinder(ctx, t, { alpha: 0.6 * E.out(seg(tt, 0, 0.4)), info: sh.info, rec: sh.cine, af, lock: seg(tt, 0.1, 0.4) });
      kickerC(ctx, sh.en, W / 2, 160, tt - 0.1);
      scrim(ctx, 'bottom', 0.8, 0.32);
      revealSegs(ctx, sh.segs, W / 2, capY, tt - 0.05, capO);
    } else {
      const tt = t - c3;
      const keys = ['portrait', 'landscape', 'cinema'], names = ['人像', '风光', '电影'], us = [0.56, 0.5, 0.3];
      keys.forEach((k, i) => {
        const p = E.out4(seg(tt, i * 0.1, 0.8 + i * 0.1));
        const x = i * W / 3, w = W / 3;
        ctx.save(); ctx.beginPath(); ctx.rect(x + 3, 0, w - 6, H); ctx.clip();
        ctx.globalAlpha = p;
        coverAt(ctx, s.img(k), x, (1 - p) * (i % 2 ? -90 : 90), w, H, 1.05 + 0.02 * tt, us[i], 0.45);
        ctx.restore();
        pill(ctx, names[i], x + w / 2, 160, E.out(seg(tt, 0.4 + i * 0.1, 0.9 + i * 0.1)), { size: 26, align: 'center' });
      });
      shade(ctx, 0.2 + 0.4 * E.out(seg(tt, 0.6, 1.6)));
      const o = { ...capO, size: 58 };
      reveal(ctx, '他们多的，不只是器材，', W / 2, H / 2 + 10, tt - 0.2, o);
      const g = ctx.createLinearGradient(0, H / 2 + 50, 0, H / 2 + 130); g.addColorStop(0, '#fff3e0'); g.addColorStop(1, '#e8b878');
      reveal(ctx, '而是一套看不见的知识。', W / 2, H / 2 + 120, tt - 1.6, { ...o, size: 76, weight: 700, gradient: g });
    }
    blink(ctx, t, c1 - 0.04); blink(ctx, t, c2 - 0.04);
  };

  // ============================================================ TITLE
  S.title = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 5, count: 30, intensity: 0.1, cx: 0.3 });
    const keys = ['portrait', 'landscape', 'cinema'], us = [0.56, 0.42, 0.3];
    keys.forEach((k, i) => {
      const p = E.out4(seg(t, 0.15 + i * 0.15, 1.3 + i * 0.15));
      if (p <= 0) return;
      const w = 230, h = 620, x = 1110 + i * 250, y = 230 + (i === 1 ? -40 : 30) + (1 - p) * 80 - t * (4 + i * 3);
      ctx.save(); ctx.globalAlpha = p;
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; rrect(ctx, x, y, w, h, 16); ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0;
      roundImg(ctx, s.img(k), x, y, w, h, 16, 1.0 + t * 0.01, us[i], 0.45);
      rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 16); ctx.strokeStyle = 'rgba(255,225,185,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    });
    scrim(ctx, 'left', 0.9, 0.62);
    const x = 150;
    kicker(ctx, 'BLOCKBUSTER NOTES  ·  VOL.02', x, 320, t - 0.15);
    reveal(ctx, '人像  ·  风光  ·  电影', x, 410, t - 0.3, { size: 46, font: F.serif, weight: 500, color: C.gold, stagger: 0.05, spacing: 4 });
    const g = ctx.createLinearGradient(0, 450, 0, 600); g.addColorStop(0, '#fff6ea'); g.addColorStop(1, '#e7c49a');
    reveal(ctx, '三种大片', x, 590, t - 0.5, { size: 168, weight: 700, font: F.serif, gradient: g, stagger: 0.09, dur: 1.0, spacing: 10, shadow: 'rgba(0,0,0,0.6)', shadowBlur: 30 });
    line(ctx, x, 650, x + 600, 650, E.out(seg(t, 1.0, 2.0)), { color: 'rgba(232,184,120,0.6)', width: 1.2 });
    reveal(ctx, '装备清单  ×  知识地图', x, 715, t - 1.2, { size: 40, color: C.dim, stagger: 0.04, spacing: 2 });
    reveal(ctx, '今天，给你一份完整地图。', x, 830, t - s.cue(0) - 0.6, { size: 40, font: F.serif, weight: 500, color: C.goldHi, stagger: 0.06 });
  };

  // ============================================================ THESIS — light · space · time
  S.thesis = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 8, count: 20, intensity: 0.07 });
    // headline + three axis glyphs
    revealSegs(ctx, [{ s: '所有大片，都在控制  ' }, { s: '光', c: C.goldHi }, { s: ' · ' }, { s: '空间', c: C.goldHi }, { s: ' · ' }, { s: '时间', c: C.goldHi }], W / 2, 195, t - 0.2, { size: 60, font: F.serif, weight: 700, align: 'center', stagger: 0.05 });
    const cards = [
      { k: 'portrait', en: 'PORTRAIT', name: '人像', core: '控制注意力', body: '让观众只看见她', u: 0.56, v: 0.35 },
      { k: 'landscape', en: 'LANDSCAPE', name: '风光', core: '控制时间', body: '在对的光里按下快门', u: 0.5, v: 0.4 },
      { k: 'cinema', en: 'CINEMA', name: '电影', core: '控制运动与情绪', body: '让画面讲故事', u: 0.32, v: 0.4 },
    ];
    const cw = 500, gap = 60, x0 = (W - (cw * 3 + gap * 2)) / 2, y0 = 280, ch = 560;
    cards.forEach((c, i) => {
      const ta = t - s.cue(i + 1) + 0.25;
      const a = E.out(seg(ta, 0, 0.6)); if (a <= 0) return;
      const act = activeCue(s, i + 1, 0.25);
      const lift = act ? -10 : 0;
      const x = x0 + i * (cw + gap), y = y0 + (1 - a) * 50 + lift;
      ctx.save(); ctx.globalAlpha = a * (act || t > s.cue(3) + 3 ? 1 : 0.62);
      glass(ctx, x, y, cw, ch, 22, { alpha: 1, fill: act ? 'rgba(40,30,20,0.6)' : 'rgba(18,15,12,0.55)' });
      if (act) { rrect(ctx, x, y, cw, ch, 22); ctx.strokeStyle = 'rgba(255,214,160,0.75)'; ctx.lineWidth = 2; ctx.shadowColor = C.gold; ctx.shadowBlur = 20; ctx.stroke(); ctx.shadowBlur = 0; }
      const ix = x + 20, iy = y + 20, iw = cw - 40, ih = 270;
      roundImg(ctx, s.img(c.k), ix, iy, iw, ih, 14, 1.15 + 0.05 * Math.sin(t * 0.3 + i), c.u, c.v);
      ctx.save(); rrect(ctx, ix, iy, iw, ih, 14); ctx.clip();
      if (i === 0) { // attention: spotlight vignette + AF box
        const g = ctx.createRadialGradient(ix + iw * 0.5, iy + ih * 0.42, 30, ix + iw * 0.5, iy + ih * 0.42, iw * 0.55);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.75 * E.out(seg(ta, 0.5, 1.5))})`); ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeStyle = '#8dffa6'; ctx.lineWidth = 2; const bx = ix + iw * 0.5, by = iy + ih * 0.4, b = 34;
        ctx.globalAlpha *= E.out(seg(ta, 0.6, 1.0));
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(bx + sx * b, by + sy * b * 0.6); ctx.lineTo(bx + sx * b, by + sy * b); ctx.lineTo(bx + sx * b * 0.6, by + sy * b); ctx.stroke(); }
      } else if (i === 1) { // time: sun arc
        const pr = (t * 0.12) % 1, cx = ix + iw / 2, cy = iy + ih * 0.95, R = iw * 0.42;
        ctx.setLineDash([3, 7]); ctx.strokeStyle = 'rgba(255,230,190,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.PI + pr * Math.PI, sx = cx + Math.cos(ang) * R, sy = cy + Math.sin(ang) * R;
        ctx.globalCompositeOperation = 'lighter'; const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
        sg.addColorStop(0, 'rgba(255,240,200,1)'); sg.addColorStop(0.3, 'rgba(255,190,110,0.8)'); sg.addColorStop(1, 'rgba(255,150,80,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, TAU); ctx.fill();
      } else { // motion: letterbox + playhead
        ctx.fillStyle = '#000'; ctx.fillRect(ix, iy, iw, 34); ctx.fillRect(ix, iy + ih - 34, iw, 34);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(ix + 20, iy + ih - 18, iw - 40, 3);
        ctx.fillStyle = C.goldHi; ctx.fillRect(ix + 20, iy + ih - 18, (iw - 40) * ((t * 0.15) % 1), 3);
        if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff4b3e'; ctx.beginPath(); ctx.arc(ix + 26, iy + 17, 6, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
      kicker(ctx, c.en, x + 34, y + 345, ta - 0.2);
      text(ctx, c.name, x + 34, y + 420, { size: 60, font: F.serif, weight: 700 });
      text(ctx, c.core, x + 34, y + 478, { size: 34, weight: 600, color: act ? C.goldHi : C.gold });
      text(ctx, c.body, x + 34, y + 524, { size: 26, color: C.dim });
      ctx.restore();
    });
  };

  // ============================================================ CHAPTER CARD
  S.chapter = (ctx, s) => {
    const { t, W, H, params: P } = s;
    backdrop(ctx, t + s.chapter * 7, { seed: 20 + s.chapter, count: 18, intensity: 0.07, cx: 0.3 });
    const ia = E.out(seg(t, 0, 1.0));
    ctx.save(); ctx.globalAlpha = ia;
    coverAt(ctx, s.img(P.img), W * 0.4, 0, W * 0.6, H, lerp(1.2, 1.08, E.out(seg(t, 0, s.d + 1))), P.img === 'cinema' ? 0.3 : P.img === 'portrait' ? 0.56 : 0.5, 0.42);
    ctx.restore();
    // feather the image's left edge into the dark
    const fg = ctx.createLinearGradient(W * 0.4, 0, W * 0.62, 0); fg.addColorStop(0, 'rgba(10,9,8,1)'); fg.addColorStop(1, 'rgba(10,9,8,0)');
    ctx.fillStyle = fg; ctx.fillRect(W * 0.4 - 2, 0, W * 0.22 + 2, H);
    scrim(ctx, 'left', 0.85, 0.7);
    const p = E.out4(seg(t, 0, 1.1));
    ctx.save();
    ctx.font = `italic 400 400px ${F.latin}`; ctx.textAlign = 'left';
    const g = ctx.createLinearGradient(0, 300, 0, 760); g.addColorStop(0, 'rgba(255,225,185,0.95)'); g.addColorStop(1, 'rgba(200,140,80,0.3)');
    ctx.globalAlpha = p; ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.translate(lerp(60, 0, p), 0);
    ctx.strokeText(P.num, 110, 720); ctx.globalAlpha = p * 0.08; ctx.fillStyle = g; ctx.fillText(P.num, 110, 720);
    ctx.restore();
    const x = 640;
    kicker(ctx, P.en, x, 400, t - 0.25);
    reveal(ctx, P.title, x, 520, t - 0.35, { size: 110, weight: 700, font: F.serif, stagger: 0.07, dur: 0.9, spacing: 6, shadow: 'rgba(0,0,0,0.6)', shadowBlur: 24 });
    line(ctx, x, 575, x + 640, 575, E.out(seg(t, 0.6, 1.5)), { color: 'rgba(245,238,229,0.3)', width: 1 });
    reveal(ctx, P.sub, x, 640, t - 0.7, { size: 36, color: C.goldHi, stagger: 0.03 });
    const n = OV.tl.chapters;
    for (let i = 1; i <= n; i++) {
      const on = i === s.chapter, done = i < s.chapter;
      ctx.save(); ctx.globalAlpha = E.out(seg(t, 0.6 + i * 0.05, 1.2 + i * 0.05));
      ctx.fillStyle = on ? C.goldHi : done ? 'rgba(232,184,120,0.55)' : 'rgba(245,238,229,0.18)';
      if (on) { ctx.shadowColor = C.gold; ctx.shadowBlur = 14; }
      ctx.beginPath(); ctx.roundRect(x + (i - 1) * 52, 690, on ? 36 : 24, 6, 3); ctx.fill(); ctx.restore();
    }
  };

  // ============================================================ GEAR BOARD
  S.gearBoard = (ctx, s) => {
    const { t, W, H, params: P } = s;
    kenburns(ctx, s.img(P.img), t / s.d, [1.05, 0.3, 0.5, 1.13, 0.22, 0.5]);
    shade(ctx, 0.12);
    scrim(ctx, 'right', 0.95, 0.66);
    const x0 = 990, w = 820;
    kicker(ctx, 'GEAR LIST', x0, 165, t - 0.1);
    reveal(ctx, P.heading, x0, 240, t - 0.2, { size: 56, font: F.serif, weight: 700, shadow: 'rgba(0,0,0,0.6)' });
    const rowH = 104, gap = 10, y0 = 285;
    P.items.forEach((it, i) => {
      const before = P.items.slice(0, i).filter(o => o.cue === it.cue).length;
      const ta = t - s.cue(it.cue) - before * 0.55 + 0.15;
      const a = E.out(seg(ta, 0, 0.55)); if (a <= 0) return;
      const act = activeCue(s, it.cue, 0.15);
      const y = y0 + i * (rowH + gap);
      ctx.save(); ctx.translate((1 - a) * 60, 0);
      glass(ctx, x0, y, w, rowH, 16, { alpha: a, fill: act ? 'rgba(46,34,22,0.62)' : 'rgba(16,13,11,0.55)' });
      ctx.globalAlpha = a * (act ? 1 : 0.72);
      if (act) { ctx.fillStyle = C.goldHi; ctx.shadowColor = C.gold; ctx.shadowBlur = 12; ctx.fillRect(x0, y + 14, 3, rowH - 28); ctx.shadowBlur = 0; }
      ctx.beginPath(); ctx.arc(x0 + 62, y + rowH / 2, 36, 0, TAU); ctx.fillStyle = 'rgba(232,184,120,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(232,184,120,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      icon(ctx, it.icon, x0 + 62, y + rowH / 2, 0.9, act ? C.goldHi : C.gold);
      text(ctx, it.name, x0 + 124, y + 46, { size: 34, font: F.serif, weight: 700 });
      text(ctx, it.spec, x0 + 124, y + 84, { size: 24, color: C.dim });
      const must = it.tier === '必备';
      pill(ctx, it.tier, x0 + w - 28, y + rowH / 2, 1, { size: 20, align: 'right', fill: must ? 'rgba(232,184,120,0.92)' : 'rgba(14,11,9,0.6)', color: must ? '#1b1410' : C.dim, stroke: must ? 'rgba(255,240,220,0.6)' : 'rgba(255,230,200,0.3)' });
      ctx.restore();
    });
  };
})();

// ==================================================================== BLOCK 2 · portrait knowledge
(() => {
  const { clamp, lerp, seg, E, C, F, text, measure, reveal, kenburns, rrect, glass, line, arrowHead, dimension, ring, kicker, backdrop } = OV;
  const { TAU, shade, scrim, grade, pill, cameraGlyph, activeCue } = OV.K;
  const S = OV.scenes;

  // ------------------------------------------------------------ FOCAL = DISTANCE (perspective face)
  // feature depth behind the nose tip (cm); magnification m(z) = d / (d + z), normalised at the cheeks
  const Z = { nose: 0, mouth: 2.5, eye: 3, cheek: 4.5, jaw: 6.5, fringe: 5, ear: 11 };
  function drawFace(ctx, cx, cy, u, dM) {
    const d = dM * 100, k = z => (d + Z.cheek) / (d + z);
    const sN = k(Z.nose), sM = k(Z.mouth), sEy = k(Z.eye), sJ = k(Z.jaw), sE = k(Z.ear), sF = k(Z.fringe);
    const P = (x, y, s) => [cx + x * u * s, cy + y * u * s];
    ctx.save();
    // hair back + neck
    ctx.fillStyle = '#21170f'; ctx.beginPath(); ctx.ellipse(cx, cy - 0.05 * u * sE, 0.98 * u * sE, 1.18 * u * sE, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b98a6c'; ctx.fillRect(cx - 0.3 * u, cy + 0.7 * u, 0.6 * u, 0.7 * u);
    // ears
    for (const sx of [-1, 1]) {
      const [ex, ey] = P(sx * 0.84, 0.02, sE);
      ctx.fillStyle = '#c99476'; ctx.beginPath(); ctx.ellipse(ex, ey, 0.12 * u * sE, 0.22 * u * sE, 0, 0, TAU); ctx.fill();
    }
    // face
    const fg = ctx.createRadialGradient(cx - 0.1 * u, cy - 0.15 * u, 0.1 * u, cx, cy, 1.05 * u);
    fg.addColorStop(0, '#f6d9c2'); fg.addColorStop(0.7, '#e2b597'); fg.addColorStop(1, '#b8866a');
    ctx.fillStyle = fg; ctx.beginPath();
    ctx.ellipse(cx, cy - 0.02 * u, 0.78 * u * sJ, 1.0 * u * sJ, 0, 0, TAU); ctx.fill();
    // cheeks (bulge with nose magnification)
    for (const sx of [-1, 1]) {
      const [bx, by] = P(sx * 0.4, 0.28, 1);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, 0.2 * u);
      g.addColorStop(0, 'rgba(235,140,120,0.28)'); g.addColorStop(1, 'rgba(235,140,120,0)'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, 0.2 * u, 0, TAU); ctx.fill();
    }
    // brows + eyes
    for (const sx of [-1, 1]) {
      const [bx, by] = P(sx * 0.33, -0.3, sEy);
      ctx.strokeStyle = '#3a2619'; ctx.lineWidth = 0.035 * u * sEy; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx - 0.15 * u * sEy, by + 0.02 * u); ctx.quadraticCurveTo(bx, by - 0.04 * u, bx + 0.15 * u * sEy, by + 0.02 * u); ctx.stroke();
      const [ex, ey] = P(sx * 0.32, -0.12, sEy), rw = 0.14 * u * sEy, rh = 0.06 * u * sEy;
      ctx.fillStyle = '#f7f1ea'; ctx.beginPath(); ctx.ellipse(ex, ey, rw, rh, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3b2518'; ctx.beginPath(); ctx.arc(ex, ey, rh * 0.95, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + rh * 0.3, ey - rh * 0.3, rh * 0.25, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 0.02 * u; ctx.beginPath(); ctx.ellipse(ex, ey, rw, rh, 0, Math.PI, TAU); ctx.stroke();
    }
    // nose (closest → most magnified)
    const [nx, ny] = P(0, 0.22, sN), nw = 0.15 * u * sN;
    const ng = ctx.createLinearGradient(nx - nw, 0, nx + nw, 0); ng.addColorStop(0, 'rgba(150,95,70,0.45)'); ng.addColorStop(0.5, 'rgba(255,230,210,0.35)'); ng.addColorStop(1, 'rgba(150,95,70,0.25)');
    ctx.fillStyle = ng; ctx.beginPath();
    ctx.moveTo(cx - 0.05 * u * sN, cy - 0.12 * u * sN); ctx.quadraticCurveTo(nx - nw * 1.1, ny - 0.02 * u, nx - nw, ny + 0.05 * u * sN);
    ctx.quadraticCurveTo(nx, ny + 0.12 * u * sN, nx + nw, ny + 0.05 * u * sN); ctx.quadraticCurveTo(nx + nw * 1.1, ny - 0.02 * u, cx + 0.05 * u * sN, cy - 0.12 * u * sN); ctx.fill();
    ctx.fillStyle = 'rgba(90,50,35,0.7)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(nx + sx * nw * 0.45, ny + 0.06 * u * sN, nw * 0.22, nw * 0.12, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,240,225,0.5)'; ctx.beginPath(); ctx.ellipse(nx, ny - 0.01 * u, nw * 0.3, nw * 0.2, 0, 0, TAU); ctx.fill();
    // mouth
    const [mx, my] = P(0, 0.5, sM), mw = 0.19 * u * sM;
    ctx.fillStyle = '#c8665e'; ctx.beginPath();
    ctx.moveTo(mx - mw, my); ctx.quadraticCurveTo(mx - mw * 0.4, my - 0.06 * u * sM, mx, my - 0.03 * u * sM); ctx.quadraticCurveTo(mx + mw * 0.4, my - 0.06 * u * sM, mx + mw, my);
    ctx.quadraticCurveTo(mx, my + 0.09 * u * sM, mx - mw, my); ctx.fill();
    // fringe
    ctx.fillStyle = '#2a1d14'; ctx.beginPath();
    const [fx, fy] = P(0, -0.62, sF);
    ctx.moveTo(cx - 0.86 * u * sF, cy - 0.1 * u * sF);
    ctx.quadraticCurveTo(cx - 0.8 * u * sF, fy - 0.45 * u, fx, fy - 0.42 * u * sF);
    ctx.quadraticCurveTo(cx + 0.8 * u * sF, fy - 0.45 * u, cx + 0.86 * u * sF, cy - 0.1 * u * sF);
    ctx.quadraticCurveTo(cx + 0.55 * u * sF, fy - 0.05 * u, cx + 0.1 * u, fy + 0.08 * u);
    ctx.quadraticCurveTo(cx - 0.4 * u * sF, fy - 0.02 * u, cx - 0.86 * u * sF, cy - 0.1 * u * sF); ctx.fill();
    ctx.restore();
    return { nose: [nx, ny], ear: P(0.84, 0.02, sE), sN, sE, ratio: (d + Z.ear) / d };
  }

  S.focalPerspective = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 31, count: 14, intensity: 0.05, cx: 0.3 });
    const c1 = s.cue(1), d1 = s.cueEnd(1) - c1, c2 = s.cue(2);
    const pm = E.inOut(seg(t, c1 + d1 * 0.45, c1 + d1 * 0.8));
    const dist = lerp(0.4, 1.5, pm);
    const focal = Math.round(lerp(24, 85, pm));
    const app = E.out(seg(t, 0, 0.8));
    ctx.save(); ctx.globalAlpha = app;
    // soft spotlight behind the face
    const sg = ctx.createRadialGradient(500, 520, 40, 500, 520, 460); sg.addColorStop(0, 'rgba(255,210,160,0.16)'); sg.addColorStop(1, 'rgba(255,210,160,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    const f = drawFace(ctx, 500, 520, 250, dist);
    ctx.restore();
    // annotations on the face
    const bad = f.ratio > 1.15;
    const ra = E.out(seg(t, 1.0, 1.6));
    ring(ctx, f.nose[0], f.nose[1], 46 * f.sN, t - 1.0, { label: `鼻  ×${f.sN.toFixed(2)}`, ok: !bad, side: -1 });
    ring(ctx, f.ear[0], f.ear[1], 40 * f.sE, t - 1.4, { label: `耳  ×${f.sE.toFixed(2)}`, ok: true, color: C.cyan });
    text(ctx, '同样的取景 · 只改变距离', 500, 920, { size: 22, align: 'center', color: 'rgba(245,238,229,0.45)', alpha: ra });
    // top-down diagram: same framing, different distance
    const camX = 1040, axY = 330, pxm = 440, hx = camX + dist * pxm;
    const da = E.out(seg(t, 0.3, 1.1));
    ctx.save(); ctx.globalAlpha = da;
    kicker(ctx, 'TOP VIEW', camX - 40, 205, t - 0.3);
    cameraGlyph(ctx, camX - 40, axY, 0.8);
    const half = 0.2 * pxm; // 40 cm framing at subject
    ctx.save(); ctx.globalAlpha *= 0.9;
    const cg = ctx.createLinearGradient(camX, 0, hx, 0); cg.addColorStop(0, 'rgba(232,184,120,0.35)'); cg.addColorStop(1, 'rgba(232,184,120,0.06)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(camX, axY); ctx.lineTo(hx, axY - half); ctx.lineTo(hx, axY + half); ctx.closePath(); ctx.fill();
    line(ctx, camX, axY, hx, axY - half, 1, { color: C.gold, width: 1.2 }); line(ctx, camX, axY, hx, axY + half, 1, { color: C.gold, width: 1.2 });
    ctx.restore();
    ctx.fillStyle = '#e2b597'; ctx.beginPath(); ctx.arc(hx + 14, axY, 30, 0, TAU); ctx.fill();
    ctx.fillStyle = '#21170f'; ctx.beginPath(); ctx.arc(hx + 22, axY, 30, -1.2, 1.2); ctx.fill();
    ctx.fillStyle = '#e2b597'; ctx.beginPath(); ctx.moveTo(hx - 14, axY - 7); ctx.lineTo(hx - 24, axY); ctx.lineTo(hx - 14, axY + 7); ctx.fill();
    dimension(ctx, camX, axY + 120, hx - 20, axY + 120, `${dist.toFixed(2)} m`, 1, { size: 28, dy: 44, labelColor: C.ink });
    const fovDeg = 2 * Math.atan(18 / focal) * 180 / Math.PI; // vertical FOV, full frame
    text(ctx, `视角 ${fovDeg.toFixed(0)}°`, camX + 40, axY - 26, { size: 22, color: C.gold });
    ctx.restore();
    // readout panel
    const pa = E.out(seg(t, 0.6, 1.3));
    if (pa > 0) {
      const px = 1000, py = 560, pw = 800, ph = 270;
      ctx.save(); glass(ctx, px, py, pw, ph, 20, { alpha: pa }); ctx.globalAlpha = pa;
      const cols = [['焦段', `${focal} mm`, C.ink], ['拍摄距离', `${dist.toFixed(2)} m`, C.ink], ['鼻 / 耳 放大差', `+${((f.ratio - 1) * 100).toFixed(0)}%`, bad ? C.bad : C.good]];
      cols.forEach(([k, v, col], i) => {
        const x = px + 40 + i * 260;
        text(ctx, k, x, py + 70, { size: 24, color: C.dim });
        text(ctx, v, x, py + 145, { size: 60, font: F.latin, color: col });
      });
      text(ctx, '放大差 = (d + 11 cm) / d − 1   ·   透视只由距离决定', px + 40, py + 220, { size: 22, color: 'rgba(245,238,229,0.5)' });
      ctx.restore();
    }
    // conclusion
    const ca = E.out(seg(t, c2, c2 + 0.6));
    if (ca > 0) pill(ctx, '85mm 显脸小  =  它逼你退后', 1400, 150, ca, { size: 30, align: 'center', color: '#1b1410', fill: 'rgba(255,220,170,0.95)', stroke: 'rgba(255,255,255,0.6)' });
  };

  // ------------------------------------------------------------ LIGHT POSITIONS (ray-marched height-field head)
  const HG = { w: 200, h: 260 };
  let head = null;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  function heightAt(x, y) {
    const e = (x / 0.76) ** 2 + ((y - 0.02) / 1.06) ** 2;
    if (e >= 1) return -1;
    let h = 0.78 * Math.sqrt(1 - e);
    const ax = Math.abs(x);
    h += 0.2 * Math.exp(-((x / 0.075) ** 2)) * smooth(-0.3, 0.15, y) * (1 - smooth(0.2, 0.3, y));   // nose ridge
    h += 0.06 * Math.exp(-((x * x) / 0.012 + ((y - 0.2) ** 2) / 0.006));                           // nose tip
    h -= 0.08 * Math.exp(-(((ax - 0.3) ** 2) / 0.022 + ((y + 0.12) ** 2) / 0.01));                 // eye sockets
    h += 0.045 * Math.exp(-((y + 0.3) ** 2) / 0.005) * (ax < 0.55 ? 1 : 0);                        // brow ridge
    h += 0.05 * Math.exp(-(((ax - 0.42) ** 2) / 0.02 + ((y - 0.1) ** 2) / 0.03));                  // cheekbones
    h += 0.035 * Math.exp(-((x * x) / 0.035 + ((y - 0.48) ** 2) / 0.004));                         // lips
    h += 0.05 * Math.exp(-((x * x) / 0.03 + ((y - 0.84) ** 2) / 0.02));                            // chin
    return h;
  }
  function initHead() {
    const { w, h } = HG, n = w * h;
    const Hf = new Float32Array(n), N = new Float32Array(n * 3), A = new Float32Array(n * 3), M = new Float32Array(n);
    const X = i => (i / (w - 1)) * 2 - 1, Y = j => ((j / (h - 1)) * 2 - 1) * 1.3;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = heightAt(X(i), Y(j)); Hf[j * w + i] = v; }
    const dx = 2 / (w - 1), dy = 2.6 / (h - 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, v = Hf[k];
      if (v < 0) continue;
      const x = X(i), y = Y(j);
      const e = (x / 0.76) ** 2 + ((y - 0.02) / 1.06) ** 2;
      M[k] = clamp((1 - e) / 0.025);
      const hl = Hf[k - 1] >= 0 ? Hf[k - 1] : 0, hr = Hf[k + 1] >= 0 ? Hf[k + 1] : 0;
      const hu = Hf[k - w] >= 0 ? Hf[k - w] : 0, hd = Hf[k + w] >= 0 ? Hf[k + w] : 0;
      let nx = -(hr - hl) / (2 * dx), ny = -(hd - hu) / (2 * dy), nz = 1;
      const L = Math.hypot(nx, ny, nz); N[k * 3] = nx / L; N[k * 3 + 1] = ny / L; N[k * 3 + 2] = nz / L;
      let r = 0.93, g = 0.76, b = 0.65;
      const ax = Math.abs(x);
      const iris = Math.hypot(ax - 0.3, (y + 0.11) * 1.6);
      if (iris < 0.065) { r = 0.22; g = 0.14; b = 0.1; } else if (Math.hypot((ax - 0.3) / 1.0, (y + 0.11) * 2.4) < 0.12) { r = 0.95; g = 0.92; b = 0.88; }
      const browY = -0.31 + 0.5 * (ax - 0.32) ** 2;
      const brow = Math.exp(-((y - browY) ** 2) / 0.0003) * smooth(0.12, 0.18, ax) * (1 - smooth(0.44, 0.5, ax));
      r = lerp(r, 0.38, brow * 0.8); g = lerp(g, 0.26, brow * 0.8); b = lerp(b, 0.18, brow * 0.8);
      const lip = Math.exp(-((x * x) / 0.03 + ((y - 0.48) ** 2) / 0.003));
      r = lerp(r, 0.78, lip); g = lerp(g, 0.4, lip); b = lerp(b, 0.4, lip);
      A[k * 3] = r; A[k * 3 + 1] = g; A[k * 3 + 2] = b;
    }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    head = { Hf, N, A, M, cv, g: cv.getContext('2d'), img: cv.getContext('2d').createImageData(w, h), dx, dy };
  }
  function shadeHead(th, ph, soft, warm) {
    if (!head) initHead();
    const { w, h } = HG, { Hf, N, A, M, img, dx, dy } = head, D = img.data;
    const dirs = [];
    const ns = soft > 0.04 ? 7 : 1;
    for (let q = 0; q < ns; q++) {
      const ja = ns === 1 ? 0 : Math.cos(q * 2.4) * soft * 0.7, jp = ns === 1 ? 0 : Math.sin(q * 2.4) * soft * 0.5;
      const T = th + ja, Pp = ph + jp;
      dirs.push([Math.sin(T) * Math.cos(Pp), -Math.sin(Pp), Math.cos(T) * Math.cos(Pp)]);
    }
    const lc = warm ? [1.0, 0.86, 0.66] : [1.0, 0.97, 0.93];
    const amb = 0.15 + 0.12 * soft;
    const step = 0.035;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, o = k * 4;
      if (Hf[k] < 0) { D[o + 3] = 0; continue; }
      const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
      let lit = 0, spec = 0;
      for (const [lx, ly, lz] of dirs) {
        const nd = nx * lx + ny * ly + nz * lz;
        if (nd <= 0) continue;
        // march toward the light through the height field
        let x = i * dx - 1, y = (j * dy) - 1.3, z = Hf[k] + 0.01, sh = 1;
        for (let st = 0; st < 26; st++) {
          x += lx * step; y += ly * step; z += lz * step;
          if (z > 1.1) break;
          const ii = Math.round((x + 1) / dx), jj = Math.round((y + 1.3) / dy);
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) break;
          const hh = Hf[jj * w + ii];
          if (hh > z) { sh = 0; break; }
        }
        lit += nd * sh;
        if (sh) { const hx = lx, hy = ly, hz = lz + 1, hl = Math.hypot(hx, hy, hz); spec += Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 40) * sh; }
      }
      lit /= dirs.length; spec /= dirs.length;
      lit = Math.pow(lit, 0.8);
      const m = M[k];
      for (let c = 0; c < 3; c++) D[o + c] = clamp(A[k * 3 + c] * (amb + lit * 1.05 * lc[c]) + spec * 0.18) * 255;
      D[o + 3] = m * 255;
    }
    head.g.putImageData(img, 0, 0);
    return head.cv;
  }
  // light keyframes [time, azimuth°, elevation°, softness]
  function lightAt(s) {
    const t = s.t, c1 = s.cue(1), d1 = s.cueEnd(1) - c1, c2 = s.cue(2);
    const K = [[0, 45, 40, 0], [c1 + 0.2, 45, 40, 0], [c1 + 1.0, 0, 50, 0], [c1 + d1 * 0.5, 0, 50, 0], [c1 + d1 * 0.5 + 0.9, 160, 18, 0], [c2 - 0.1, 160, 18, 0], [c2 + 0.8, 45, 35, 0], [c2 + 1.4, 45, 35, 0], [c2 + 3.0, 45, 35, 0.55], [1e9, 45, 35, 0.55]];
    let a = K[0], b = K[1];
    for (let i = 0; i < K.length - 1; i++) if (t >= K[i][0] && t < K[i + 1][0]) { a = K[i]; b = K[i + 1]; break; }
    const p = E.inOut(clamp((t - a[0]) / Math.max(1e-3, b[0] - a[0])));
    return { th: lerp(a[1], b[1], p), ph: lerp(a[2], b[2], p), soft: lerp(a[3], b[3], p) };
  }
  S.lightPositions = (ctx, s) => {
    const { t, W, H } = s;
    const L = lightAt(s), rad = Math.PI / 180;
    const back = clamp((L.th - 100) / 60);
    const bg = ctx.createRadialGradient(560, 500, 40, 560, 520, 760);
    bg.addColorStop(0, `rgba(${(40 + 120 * back) | 0},${(32 + 80 * back) | 0},${(26 + 40 * back) | 0},1)`); bg.addColorStop(1, '#070605');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const cv = shadeHead(L.th * rad, L.ph * rad, L.soft, back > 0.3);
    const hw = 440, hh = hw * HG.h / HG.w, hx = 560 - hw / 2, hy = 520 - hh / 2;
    // hair cap behind
    ctx.save(); ctx.fillStyle = '#1a120d'; ctx.beginPath(); ctx.ellipse(560, hy + hh * 0.42, hw * 0.43, hh * 0.47, 0, 0, TAU); ctx.fill();
    if (back > 0.05) { // rim on hair
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = back * 0.9; ctx.strokeStyle = '#ffcf8a'; ctx.lineWidth = 6; ctx.filter = 'blur(6px)';
      ctx.beginPath(); ctx.ellipse(560, hy + hh * 0.42, hw * 0.43, hh * 0.47, 0, Math.PI * 1.05, Math.PI * 2.1); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cv, hx, hy, hw, hh); ctx.restore();
    // hair cap with an arched hairline
    ctx.save();
    ctx.beginPath(); ctx.ellipse(560, hy + hh * 0.42, hw * 0.43 + 2, hh * 0.47 + 2, 0, 0, TAU); ctx.clip();
    const hgr = ctx.createLinearGradient(0, hy, 0, hy + hh * 0.3); hgr.addColorStop(0, '#2a1d15'); hgr.addColorStop(1, '#17100b');
    ctx.fillStyle = hgr; ctx.beginPath();
    ctx.moveTo(560 - hw * 0.5, hy - 20); ctx.lineTo(560 + hw * 0.5, hy - 20); ctx.lineTo(560 + hw * 0.5, hy + hh * 0.42);
    ctx.bezierCurveTo(560 + hw * 0.36, hy + hh * 0.3, 560 + hw * 0.3, hy + hh * 0.17, 560 + hw * 0.12, hy + hh * 0.165);
    ctx.quadraticCurveTo(560, hy + hh * 0.2, 560 - hw * 0.12, hy + hh * 0.165);
    ctx.bezierCurveTo(560 - hw * 0.3, hy + hh * 0.17, 560 - hw * 0.36, hy + hh * 0.3, 560 - hw * 0.5, hy + hh * 0.42);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // Rembrandt triangle callout
    const c1 = s.cue(1), c2 = s.cue(2);
    if (t < c1 + 0.1) ring(ctx, 560 - hw * 0.16, 520 + hh * 0.04, 34, t - 1.6, { label: '三角光', side: -1 });
    // orbit diagram
    const ox = 1420, oy = 560, R = 230;
    const da = E.out(seg(t, 0.2, 1.0));
    ctx.save(); ctx.globalAlpha = da;
    ctx.strokeStyle = 'rgba(245,238,229,0.18)'; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    const zones = [[-15, 15, '蝴蝶光', C.cyan], [30, 60, '伦勃朗光', C.goldHi], [140, 180, '轮廓光', C.rose]];
    for (const [a0, a1, lab, col] of zones) {
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha *= 0.5; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ox, oy, R, Math.PI / 2 - a1 * rad, Math.PI / 2 - a0 * rad); ctx.stroke(); ctx.restore();
      const am = (a0 + a1) / 2 * rad;
      const [tx, ty] = a0 < 0 ? [ox - R * 0.62, oy + R + 34] : [ox + Math.sin(am) * (R + 62), oy + Math.cos(am) * (R + 62) + 9];
      text(ctx, lab, tx, ty, { size: 24, align: 'center', color: col, weight: 500 });
    }
    // subject (top-down) facing camera (down)
    ctx.fillStyle = '#e2b597'; ctx.beginPath(); ctx.arc(ox, oy, 30, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1e150f'; ctx.beginPath(); ctx.arc(ox, oy - 6, 30, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.fillStyle = '#e2b597'; ctx.beginPath(); ctx.moveTo(ox - 7, oy + 28); ctx.lineTo(ox, oy + 40); ctx.lineTo(ox + 7, oy + 28); ctx.fill();
    cameraGlyph(ctx, ox, oy + R + 70, 0.55, -Math.PI / 2);
    // light (softbox grows with softness)
    const lx = ox + Math.sin(L.th * rad) * R, ly = oy + Math.cos(L.th * rad) * R;
    const bw = lerp(46, 150, L.soft / 0.55), ang = Math.atan2(oy - ly, ox - lx);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(lx, ly, ox, oy); beam.addColorStop(0, 'rgba(255,220,160,0.35)'); beam.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = beam; ctx.beginPath();
    ctx.moveTo(lx - Math.sin(ang) * bw / 2, ly + Math.cos(ang) * bw / 2); ctx.lineTo(ox, oy); ctx.lineTo(lx + Math.sin(ang) * bw / 2, ly - Math.cos(ang) * bw / 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = '#fff1d6'; ctx.shadowColor = '#ffd79a'; ctx.shadowBlur = 24; ctx.fillRect(-bw / 2, -6, bw, 12); ctx.restore();
    text(ctx, `高 ${L.ph.toFixed(0)}°`, lx, ly - 26, { size: 20, align: 'center', color: C.dim });
    ctx.restore();
    // state label
    let lab;
    if (t >= c2 + 0.8) lab = ['SOFT LIGHT', '光源越大、越近，光越柔', C.goldHi];
    else if (L.th > 120) lab = ['RIM LIGHT', '轮廓光：发丝发亮', C.rose];
    else if (L.th < 15) lab = ['BUTTERFLY', '蝴蝶光：鼻下小阴影，显瘦', C.cyan];
    else lab = ['REMBRANDT', '伦勃朗光：45° 侧上方，最立体', C.goldHi];
    kicker(ctx, lab[0], 1080, 175, 1, { color: lab[2] });
    text(ctx, lab[1], 1080, 232, { size: 38, font: F.serif, weight: 700 });
  };

  // ------------------------------------------------------------ KNOW CARDS (photo + stacked knowledge)
  S.knowCards = (ctx, s) => {
    const { t, W, H, params: P } = s;
    kenburns(ctx, s.img(P.img), t / s.d, P.kb);
    grade(ctx, 0.1);
    scrim(ctx, 'left', 0.92, 0.62);
    kicker(ctx, 'SOFT SKILLS', 120, 215, t - 0.1);
    P.cards.forEach((c, i) => {
      const ta = t - s.cue(c.cue) + 0.2, a = E.out(seg(ta, 0, 0.6)); if (a <= 0) return;
      const act = activeCue(s, c.cue, 0.2);
      const x = 120, y = 250 + i * 196, w = 720, h = 172;
      ctx.save(); ctx.translate((1 - a) * -40, 0);
      glass(ctx, x, y, w, h, 18, { alpha: a, fill: act ? 'rgba(46,34,22,0.6)' : 'rgba(16,13,11,0.5)' });
      ctx.globalAlpha = a * (act ? 1 : 0.65);
      if (act) { ctx.fillStyle = C.goldHi; ctx.fillRect(x, y + 18, 3, h - 36); }
      text(ctx, `0${i + 1}`, x + 34, y + 62, { size: 30, font: F.latin, italic: true, color: C.gold });
      kicker(ctx, c.kicker, x + 90, y + 56, 1, { size: 17 });
      text(ctx, c.title, x + 34, y + 112, { size: 40, font: F.serif, weight: 700, color: act ? C.goldHi : C.ink });
      text(ctx, c.body, x + 34, y + 150, { size: 24, color: C.dim });
      ctx.restore();
    });
  };
})();

// ==================================================================== BLOCK 3 · landscape knowledge
(() => {
  const { clamp, lerp, seg, E, C, F, text, measure, reveal, cover, kenburns, rrect, glass, line, arrowHead, dimension, ring, kicker, backdrop } = OV;
  const { TAU, shade, scrim, grade, pill, viewfinder, coverAt, roundImg, blurred, cameraGlyph, mixC, css, activeCue } = OV.K;
  const S = OV.scenes;

  // ------------------------------------------------------------ LIGHT CLOCK
  const SKY = [ // [elevation°, zenith, mid, horizon]
    [-14, '#04060d', '#090f22', '#12182e'],
    [-7, '#0b1840', '#1d3570', '#3d5a96'],
    [-3, '#1b2a5a', '#4c4a7e', '#d9785c'],
    [1, '#2d4f8c', '#b4807a', '#ffa860'],
    [6, '#3a65a6', '#a7a9b8', '#ffcf8c'],
    [20, '#3d76bf', '#86b2df', '#cfe1ef'],
    [70, '#2c69b6', '#74a9df', '#c3dcf0'],
  ];
  function skyAt(e) {
    let i = 0; while (i < SKY.length - 2 && e > SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], p = clamp((e - a[0]) / (b[0] - a[0]));
    return [1, 2, 3].map(k => mixC(a[k], b[k], p));
  }
  const ELEV = [[5.5, -14], [6.3, -7], [6.8, -3], [7, 0], [7.8, 6], [9, 22], [12.5, 62], [16, 30], [18.2, 6], [19, 0], [19.2, -3], [19.7, -7], [20.5, -14]];
  function elevAt(h) {
    let i = 0; while (i < ELEV.length - 2 && h > ELEV[i + 1][0]) i++;
    const a = ELEV[i], b = ELEV[i + 1]; return lerp(a[1], b[1], clamp((h - a[0]) / (b[0] - a[0])));
  }
  const ridge = (x, seed, amp, base) => base - amp * (0.55 * Math.sin(x * 0.004 + seed) + 0.3 * Math.sin(x * 0.011 + seed * 2.3) + 0.15 * Math.sin(x * 0.027 + seed * 5.1));
  const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

  S.lightClock = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1), c2 = s.cue(2), e0 = s.cueEnd(0), e1 = s.cueEnd(1);
    let hr;
    if (t < c1) hr = lerp(18.25, 18.98, E.sine(seg(t, 0.3, e0)));
    else if (t < c2) hr = lerp(18.98, 19.62, E.sine(seg(t, c1, e1)));
    else hr = lerp(19.62, 12.7, E.inOut(seg(t, c2, c2 + 1.2)));
    const el = elevAt(hr);
    const [zen, mid, hor] = skyAt(el);
    const horizonY = 700;
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, css(zen)); g.addColorStop(0.6, css(mid)); g.addColorStop(1, css(hor));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // stars in blue hour
    const star = clamp((-el - 3) / 6);
    if (star > 0) { const r = OV.rand(4); ctx.fillStyle = '#fff'; for (let i = 0; i < 90; i++) { const x = r() * W, y = r() * 420; ctx.globalAlpha = star * (0.3 + 0.7 * r()) * (0.6 + 0.4 * Math.sin(t * 3 + i)); ctx.fillRect(x, y, 2, 2); } ctx.globalAlpha = 1; }
    // sun
    const sunX = W * (0.08 + 0.84 * (hr - 6) / 14), sunY = horizonY - Math.min(el, 48) * 8;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const warm = clamp(1 - el / 25), hr2 = lerp(260, 150, clamp(el / 50));
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, hr2);
    sg.addColorStop(0, `rgba(255,${(245 - 60 * warm) | 0},${(220 - 120 * warm) | 0},1)`); sg.addColorStop(0.08, `rgba(255,${(220 - 60 * warm) | 0},${(160 - 90 * warm) | 0},0.9)`); sg.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX, sunY, hr2, 0, TAU); ctx.fill(); ctx.restore();
    // mountain layers
    const dark = [14, 12, 16];
    const layers = [[1.3, 70, 560, 0.35], [3.1, 60, 630, 0.6], [5.7, 40, 720, 0.9]];
    layers.forEach(([seed, amp, base, k], li) => {
      let col = mixC(hor, dark, k);
      const glow = li === 0 ? clamp(1 - Math.abs(el - 2) / 5) : 0;
      if (glow > 0) col = mixC(col, [220, 120, 130], glow * 0.45);
      if (el > 20) col = mixC(col, [70, 90, 110], (1 - k) * 0.5);
      ctx.fillStyle = css(col); ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) ctx.lineTo(x, ridge(x, seed, amp, base));
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    });
    // ground figure + tree with physical shadow length
    const gx = 1180, gy = 850, ph = 110;
    const sh = el > 0.5 ? Math.min(1100, ph / Math.tan(Math.max(el, 1.2) * Math.PI / 180)) : 0;
    const dir = sunX < gx ? 1 : -1, sa = clamp(el / 1.5) * (el > 25 ? 0.75 : 0.5);
    if (sh > 0) {
      ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = '#000'; if (el < 20) ctx.filter = 'blur(2px)';
      ctx.beginPath(); ctx.moveTo(gx - 10, gy); ctx.lineTo(gx + dir * sh, gy + 8); ctx.lineTo(gx + dir * sh, gy + 26); ctx.lineTo(gx + 10, gy + 6); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#050405';
    ctx.beginPath(); ctx.arc(gx, gy - ph + 12, 12, 0, TAU); ctx.fill(); ctx.fillRect(gx - 9, gy - ph + 24, 18, ph - 24);
    const rim = clamp(1 - el / 15) * clamp(el + 2);
    if (rim > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,190,110,${0.8 * rim})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx - dir * 9, gy - ph + 24); ctx.lineTo(gx - dir * 9, gy); ctx.stroke(); ctx.restore(); }
    // time-of-day ruler
    const rx0 = 360, rx1 = 1560, ry = 168, hx = h => rx0 + (rx1 - rx0) * (h - 5) / 16;
    const ra = E.out(seg(t, 0.2, 0.9));
    ctx.save(); ctx.globalAlpha = ra;
    const bands = [[6.3, 6.9, '蓝调', '#4d6fb8'], [6.9, 7.9, '黄金', '#e8a85c'], [11, 14, '硬光', '#9aa4ad'], [18.1, 19.1, '黄金', '#e8a85c'], [19.1, 19.75, '蓝调', '#4d6fb8']];
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, rx0 - 20, ry - 44, rx1 - rx0 + 40, 88, 14); ctx.fill();
    line(ctx, rx0, ry, rx1, ry, 1, { color: 'rgba(255,255,255,0.35)' });
    for (const [a, b, lab, col] of bands) {
      ctx.fillStyle = col; ctx.globalAlpha = ra * 0.85; rrect(ctx, hx(a), ry - 5, hx(b) - hx(a), 10, 5); ctx.fill(); ctx.globalAlpha = ra;
      text(ctx, lab, (hx(a) + hx(b)) / 2, ry - 16, { size: 18, align: 'center', color: col, weight: 600 });
    }
    for (let h = 6; h <= 20; h += 2) text(ctx, `${h}:00`, hx(h), ry + 32, { size: 16, font: F.ui, align: 'center', color: 'rgba(255,255,255,0.5)' });
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(hx(hr), ry, 7, 0, TAU); ctx.fill();
    ctx.restore();
    // readout panel
    const state = t >= c2 + 0.6 ? 2 : t >= c1 ? 1 : 0;
    const info = [['GOLDEN HOUR', '黄金时刻', '低 · 暖 · 长影', C.goldHi], ['BLUE HOUR', '蓝调时刻', '冷 · 静 · 深蓝丝绸', C.cyan], ['HARSH NOON', '正午硬光', '硬 · 平 · 只适合踩点', C.bad]][state];
    const pa = E.out(seg(t, 0.4, 1.0));
    const px = 110, py = 300, pw = 560, ph2 = 330;
    ctx.save(); glass(ctx, px, py, pw, ph2, 20, { alpha: pa, fill: 'rgba(10,10,14,0.5)' }); ctx.globalAlpha = pa;
    kicker(ctx, info[0], px + 34, py + 58, 1, { color: info[3] });
    text(ctx, hhmm(hr), px + 34, py + 150, { size: 84, font: F.latin, color: C.ink });
    text(ctx, info[1], px + 300, py + 140, { size: 44, font: F.serif, weight: 700, color: info[3] });
    text(ctx, `太阳高度  ${el.toFixed(1)}°`, px + 34, py + 210, { size: 26, color: C.dim });
    text(ctx, el > 0.5 ? `影长 ≈ ${(1 / Math.tan(Math.max(el, 1.2) * Math.PI / 180)).toFixed(1)} × 身高` : '太阳在地平线下 · 无直射影', px + 34, py + 252, { size: 26, color: C.dim });
    text(ctx, info[2], px + 34, py + 300, { size: 28, weight: 600, color: info[3] });
    ctx.restore();
  };

  // ------------------------------------------------------------ DYNAMIC RANGE
  S.dynamicRange = (ctx, s) => {
    const { t, W, H, params: P } = s;
    backdrop(ctx, t, { seed: 52, count: 12, intensity: 0.05 });
    const c1 = s.cue(1), d1 = s.cueEnd(1) - c1;
    const pg = E.inOut(seg(t, c1 + 0.3, c1 + 1.5));            // GND applied
    const pb = E.out(seg(t, c1 + d1 * 0.5, c1 + d1 * 0.5 + 0.8)); // bracketing
    const bx = 110, by = 190, bw = 1000, bh = 563;
    const im = s.img(P.img);
    const app = E.out(seg(t, 0, 0.7));
    ctx.save(); ctx.globalAlpha = app;
    ctx.save(); rrect(ctx, bx, by, bw, bh, 16); ctx.clip();
    coverAt(ctx, im, bx, by, bw, bh, 1.04 + 0.02 * t / s.d, 0.5, 0.5);
    // unmanaged exposure: blown sky, crushed shadows
    const un = 1 - pg;
    let gg = ctx.createLinearGradient(0, by, 0, by + bh * 0.42);
    gg.addColorStop(0, `rgba(255,250,240,${0.85 * un})`); gg.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = gg; ctx.fillRect(bx, by, bw, bh);
    gg = ctx.createLinearGradient(0, by + bh * 0.62, 0, by + bh); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, `rgba(0,0,0,${0.75 * un})`);
    ctx.fillStyle = gg; ctx.fillRect(bx, by, bw, bh);
    if (un > 0.02) { // zebra on the sky
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh * 0.22); ctx.clip(); ctx.globalAlpha = 0.45 * un; ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
      const off = (t * 40) % 24; for (let x = bx - bh + off; x < bx + bw; x += 24) { ctx.beginPath(); ctx.moveTo(x, by + bh * 0.22); ctx.lineTo(x + bh * 0.22, by); ctx.stroke(); }
      ctx.restore();
    }
    // GND filter sliding down
    if (pg > 0) {
      const fy = lerp(by - bh * 0.5, by, pg);
      const gd = ctx.createLinearGradient(0, fy, 0, fy + bh * 0.55); gd.addColorStop(0, 'rgba(10,8,14,0.55)'); gd.addColorStop(0.6, 'rgba(10,8,14,0.25)'); gd.addColorStop(1, 'rgba(10,8,14,0)');
      ctx.fillStyle = gd; ctx.fillRect(bx, fy, bw, bh * 0.55);
      line(ctx, bx, fy + bh * 0.42, bx + bw, fy + bh * 0.42, 1, { color: 'rgba(255,220,170,0.6)', dash: [8, 8] });
      pill(ctx, 'GND 0.9  ·  天空 −3 档', bx + bw - 30, fy + bh * 0.42 - 34, pg, { size: 22, align: 'right' });
    }
    ctx.restore();
    rrect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 16); ctx.strokeStyle = 'rgba(255,230,200,0.25)'; ctx.stroke();
    if (un > 0.1) {
      pill(ctx, '✕  天空过曝 · 死白', bx + 30, by + 50, E.out(seg(t, 1.2, 1.8)) * un, { size: 22, color: '#ffd9d2', stroke: 'rgba(239,122,104,0.7)' });
      pill(ctx, '✕  暗部欠曝 · 死黑', bx + 30, by + bh - 50, E.out(seg(t, 1.6, 2.2)) * un, { size: 22, color: '#ffd9d2', stroke: 'rgba(239,122,104,0.7)' });
    }
    ctx.restore();
    // stop scale
    const x0 = 1250, top = 200, bot = 760, n = 16, sp = (bot - top) / n;
    const sceneTop = lerp(16, 14.5, pg), sceneBot = lerp(0, 1.5, pg);
    const senTop = 14.5, senBot = 1.5;
    const sa = E.out(seg(t, 0.5, 1.2));
    ctx.save(); ctx.globalAlpha = sa;
    for (let k = 0; k <= n; k += 2) { text(ctx, String(k), x0 - 20, bot - k * sp + 7, { size: 18, font: F.ui, align: 'right', color: C.dim }); line(ctx, x0 - 10, bot - k * sp, x0, bot - k * sp, 1, { color: C.faint }); }
    const ys = v => bot - v * sp;
    const sgr = ctx.createLinearGradient(0, ys(sceneTop), 0, ys(sceneBot)); sgr.addColorStop(0, '#fffaf0'); sgr.addColorStop(0.5, '#a08a74'); sgr.addColorStop(1, '#0a0806');
    ctx.fillStyle = sgr; rrect(ctx, x0 + 20, ys(sceneTop), 70, ys(sceneBot) - ys(sceneTop), 8); ctx.fill();
    text(ctx, '场景', x0 + 55, top - 30, { size: 24, align: 'center', color: C.ink });
    text(ctx, `${(sceneTop - sceneBot).toFixed(0)} 档`, x0 + 55, top - 2, { size: 20, align: 'center', color: C.dim });
    const fits = sceneTop <= senTop + 0.05 && sceneBot >= senBot - 0.55;
    const sc = fits ? C.good : C.gold;
    ctx.strokeStyle = sc; ctx.lineWidth = 2.5; ctx.shadowColor = sc; ctx.shadowBlur = 12;
    rrect(ctx, x0 + 120, ys(senTop), 70, ys(senBot) - ys(senTop), 8); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(232,184,120,0.08)'; ctx.fill();
    text(ctx, '传感器', x0 + 155, top - 30, { size: 24, align: 'center' });
    text(ctx, '≈ 13 档', x0 + 155, top - 2, { size: 20, align: 'center', color: C.dim });
    // clipped zones
    const over = Math.max(0, sceneTop - senTop), under = Math.max(0, senBot - sceneBot);
    if (over > 0.05) { ctx.fillStyle = 'rgba(239,122,104,0.35)'; ctx.fillRect(x0 + 20, ys(sceneTop), 70, ys(senTop) - ys(sceneTop)); text(ctx, '溢出', x0 + 220, ys(senTop + over / 2) + 8, { size: 22, color: C.bad }); }
    if (under > 0.05) { ctx.fillStyle = 'rgba(239,122,104,0.35)'; ctx.fillRect(x0 + 20, ys(senBot), 70, ys(sceneBot) - ys(senBot)); text(ctx, '溢出', x0 + 220, ys(senBot - under / 2) + 8, { size: 22, color: C.bad }); }
    if (fits) text(ctx, '✓ 装得下', x0 + 220, ys(8) + 8, { size: 26, color: C.good, weight: 600, alpha: E.out(seg(t, c1 + 1.3, c1 + 1.8)) });
    ctx.restore();
    // bracketing thumbnails → HDR
    if (pb > 0) {
      const evs = [['−2 EV', 'brightness(0.55)'], ['0 EV', 'none'], ['+2 EV', 'brightness(1.7)']];
      ctx.save(); ctx.globalAlpha = pb;
      evs.forEach(([lab, f], i) => {
        const w = 150, h = 84, x = 110 + i * 166, y = 772 + (1 - pb) * 20;
        roundImg(ctx, im, x, y, w, h, 8, 1.1, 0.5, 0.5, f);
        text(ctx, lab, x + 10, y + h - 10, { size: 16, font: F.ui, weight: 600, color: '#fff', shadow: 'rgba(0,0,0,0.9)', shadowBlur: 6 });
      });
      line(ctx, 610, 814, 660, 814, pb, { color: C.gold, width: 1.5 }); arrowHead(ctx, 662, 814, 0, 10, C.gold);
      ctx.restore();
      pill(ctx, '包围曝光  →  HDR 合成', 684, 814, pb, { size: 24, dot: C.good });
    }
  };

  // ------------------------------------------------------------ ND LONG EXPOSURE
  S.ndLong = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1), e1 = s.cueEnd(1);
    const short = s.img('seaShort'), long = s.img('seaLong');
    const z = lerp(1.03, 1.1, t / s.d);
    cover(ctx, short, 0, 0, W, H, z, 0.5, 0.5);
    const wp = E.inOut(seg(t, c1, c1 + 2.6));
    const wx = lerp(W, 0, wp);
    if (wp > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(wx, 0, W - wx, H); ctx.clip();
      if (long) cover(ctx, long, 0, 0, W, H, z, 0.5, 0.5); else ctx.drawImage(blurred('seaShort', short, 10), 0, 0, W, H);
      ctx.restore();
      if (wp < 1) line(ctx, wx, 0, wx, H, 1, { color: C.goldHi, width: 2, glow: 16 });
    }
    grade(ctx, 0.08);
    // calculator panel (cue 0)
    const pa = E.out(seg(t, 0.2, 0.8)) * (1 - E.inOut(seg(t, c1 + 2.6, c1 + 3.3)));
    if (pa > 0) {
      const px = 110, py = 200, pw = 640, ph = 460;
      ctx.save(); glass(ctx, px, py, pw, ph, 22, { alpha: pa, fill: 'rgba(10,8,8,0.55)' }); ctx.globalAlpha = pa;
      kicker(ctx, 'ND1000  ·  −10 STOPS', px + 36, py + 60, t - 0.2);
      const fill = clamp((t - 0.6) / Math.max(1, s.cueEnd(0) - 1.2)) * 10;
      for (let k = 0; k < 10; k++) {
        const on = fill > k, x = px + 36 + k * 56, y = py + 95;
        ctx.fillStyle = on ? `rgba(20,16,14,${0.4 + k * 0.06})` : 'rgba(255,255,255,0.06)';
        rrect(ctx, x, y, 46, 46, 6); ctx.fill(); ctx.strokeStyle = on ? C.gold : 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.2; ctx.stroke();
        text(ctx, String(k + 1), x + 23, y + 30, { size: 18, font: F.ui, align: 'center', color: on ? C.goldHi : C.dim });
      }
      text(ctx, '1/30 s', px + 36, py + 230, { size: 56, font: F.latin, color: C.ink, alpha: E.out(seg(t, 0.8, 1.3)) });
      text(ctx, '×  2¹⁰ = 1024', px + 250, py + 228, { size: 40, font: F.latin, color: C.gold, alpha: E.out(seg(t, 1.8, 2.3)) });
      const g = ctx.createLinearGradient(0, py + 280, 0, py + 380); g.addColorStop(0, '#fff3e0'); g.addColorStop(1, '#e8b878');
      reveal(ctx, '≈ 34 秒', px + 36, py + 360, t - 2.8, { size: 96, font: F.serif, weight: 700, gradient: g });
      text(ctx, '时间被拉长 1000 倍', px + 36, py + 420, { size: 26, color: C.dim, alpha: E.out(seg(t, 3.2, 3.8)) });
      ctx.restore();
    }
    // exposure timer (cue 1)
    const ta = E.out(seg(t, c1, c1 + 0.4)) * (1 - E.out(seg(t, c1 + 3.0, c1 + 3.6)));
    if (ta > 0) {
      const cx = W - 220, cy = 230, r = 80, sec = 34 * seg(t, c1, c1 + 2.6);
      ctx.save(); ctx.globalAlpha = ta;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(cx, cy, r + 16, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = C.goldHi; ctx.shadowColor = C.gold; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * sec / 34); ctx.stroke(); ctx.shadowBlur = 0;
      text(ctx, `${sec.toFixed(0)}"`, cx, cy + 18, { size: 54, font: F.latin, align: 'center' });
      text(ctx, 'BULB', cx, cy + 50, { size: 16, font: F.ui, align: 'center', spacing: 4, color: C.dim });
      ctx.restore();
    }
    const la = E.out(seg(t, c1 + 2.0, c1 + 2.6));
    pill(ctx, '海浪  →  雾', 120, 760, la, { size: 30, dot: C.cyan });
    pill(ctx, '云  →  线', 120, 840, E.out(seg(t, c1 + 2.4, c1 + 3.0)), { size: 30, dot: C.goldHi });
    text(ctx, '1/30 s', 140, 170, { size: 22, font: F.ui, weight: 600, color: 'rgba(255,255,255,0.8)', alpha: wp > 0 ? 1 - wp : 0 });
    if (wp > 0.5) text(ctx, 'ND1000 · 34 s', W - 120, H - 230, { size: 24, font: F.ui, weight: 600, align: 'right', color: 'rgba(255,255,255,0.85)', alpha: E.out(seg(wp, 0.5, 1)) });
  };

  // ------------------------------------------------------------ HYPERFOCAL + LAYERS + FOCUS STACK
  function dof(s, f, N, c = 0.03) { // s in metres
    const Hm = (f * f / (N * c) + f) / 1000, fm = f / 1000;
    const near = s * (Hm - fm) / (Hm + s - 2 * fm), far = s < Hm ? s * (Hm - fm) / (Hm - s) : Infinity;
    return { near, far, H: Hm };
  }
  S.hyperfocal = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1), c2 = s.cue(2), e1 = s.cueEnd(1);
    const im = s.img('landscape');
    // phase A: layered composition on the photo
    const pA = 1 - E.inOut(seg(t, c1 - 0.3, c1 + 0.6));
    kenburns(ctx, im, t / s.d, [1.04, 0.5, 0.6, 1.1, 0.5, 0.55]);
    if (pA > 0) {
      const bands = [[0.0, 0.42, '远景 · 雪山', 'BACKGROUND'], [0.42, 0.72, '中景 · 湖与森林', 'MIDGROUND'], [0.72, 1.0, '前景 · 岩石与花', 'FOREGROUND']];
      bands.forEach(([a, b, lab, en], i) => {
        const ba = E.out(seg(t, 0.6 + i * 0.6, 1.2 + i * 0.6)) * pA;
        if (ba <= 0) return;
        ctx.save(); ctx.globalAlpha = ba;
        line(ctx, 0, H * b, W, H * b, 1, { color: 'rgba(255,230,200,0.5)', dash: [10, 10] });
        ctx.restore();
        pill(ctx, `${lab}`, 110, H * (a + b) / 2, ba, { size: 26, dot: [C.cyan, C.good, C.goldHi][i] });
      });
      // leading line drawn into depth
      const lp = E.inOut(seg(t, 2.6, 4.2)) * pA;
      if (lp > 0) {
        ctx.save(); ctx.globalAlpha = pA; ctx.strokeStyle = C.goldHi; ctx.lineWidth = 4; ctx.shadowColor = C.gold; ctx.shadowBlur = 18; ctx.setLineDash([2, 12]); ctx.lineCap = 'round';
        const pts = [[0.62, 1.0], [0.6, 0.82], [0.52, 0.66], [0.48, 0.5], [0.44, 0.3]];
        ctx.beginPath(); const nseg = (pts.length - 1) * lp;
        for (let i = 0; i <= Math.floor(nseg); i++) { const [x, y] = pts[i]; i === 0 ? ctx.moveTo(x * W, y * H) : ctx.lineTo(x * W, y * H); }
        const k = Math.floor(nseg); if (k < pts.length - 1) { const f = nseg - k; ctx.lineTo(lerp(pts[k][0], pts[k + 1][0], f) * W, lerp(pts[k][1], pts[k + 1][1], f) * H); }
        ctx.stroke(); ctx.restore();
        pill(ctx, '引导线 → 视线进入深处', W * 0.66, H * 0.6, E.out(seg(t, 3.6, 4.2)) * pA, { size: 24 });
      }
    }
    // phase B/C: diagram
    const pB = E.inOut(seg(t, c1 - 0.3, c1 + 0.6));
    if (pB <= 0) return;
    ctx.save(); ctx.globalAlpha = pB * 0.86; ctx.fillStyle = '#0a0908'; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalAlpha = pB;
    const gy = 690, xL = 300, xR = 1580, xInf = 1720;
    const xOf = d => (d === Infinity || d > 200) ? xInf : xL + (xR - xL) * Math.log10(d / 0.4) / Math.log10(200 / 0.4);
    line(ctx, 140, gy, 1800, gy, 1, { color: 'rgba(245,238,229,0.3)' });
    for (const d of [0.5, 1, 2, 5, 10, 50]) { line(ctx, xOf(d), gy, xOf(d), gy + 10, 1, { color: C.dim }); text(ctx, d < 1 ? `${d} m` : `${d} m`, xOf(d), gy + 38, { size: 18, font: F.ui, align: 'center', color: C.dim }); }
    text(ctx, '∞', xInf, gy + 42, { size: 30, font: F.latin, align: 'center', color: C.dim });
    cameraGlyph(ctx, 190, gy - 60, 0.8);
    // focus state
    const stack = t >= c2 - 0.2;
    let near, far, sF;
    if (!stack) {
      sF = lerp(7, 1.8, E.inOut(seg(t, c1 + 1.6, c1 + 4.4)));
      ({ near, far } = dof(sF, 24, 11));
    }
    const objs = [[0.9, '前景岩石', 'rock'], [12, '中景树林', 'tree'], [Infinity, '远山', 'mtn']];
    const inF = d => stack ? E.out(seg(t, c2 + 3.2, c2 + 3.8)) > 0.5 || d > 2 : d >= near - 0.005 && d <= far;
    // DOF band(s)
    const band = (n, f, a, col = 'rgba(232,184,120,') => {
      const x1 = xOf(n), x2 = xOf(f);
      const g = ctx.createLinearGradient(x1, 0, x2, 0); g.addColorStop(0, col + (0.1 * a) + ')'); g.addColorStop(0.5, col + (0.26 * a) + ')'); g.addColorStop(1, col + (0.1 * a) + ')');
      ctx.fillStyle = g; ctx.fillRect(x1, 330, x2 - x1, gy - 330);
      line(ctx, x1, 330, x1, gy, a, { color: C.gold, width: 1.4, glow: 8 });
    };
    if (!stack) {
      band(near, far, 1);
      line(ctx, xOf(sF), 310, xOf(sF), gy, 1, { color: C.goldHi, width: 2, dash: [6, 6] });
      text(ctx, `对焦 ${sF.toFixed(1)} m`, xOf(sF), 296, { size: 22, align: 'center', color: C.goldHi });
      text(ctx, `清晰  ${near.toFixed(2)} m  →  ∞`, (xOf(near) + xInf) / 2, 360, { size: 26, align: 'center', color: C.ink, weight: 600 });
    } else {
      const shots = [0.55, 0.95, 2.4, 8].map(x => dof(x, 24, 5.6));
      const merge = E.inOut(seg(t, c2 + 2.6, c2 + 3.6));
      shots.forEach((d, i) => { const a = E.out(seg(t, c2 + 0.2 + i * 0.5, c2 + 0.6 + i * 0.5)) * (1 - merge * 0.7); if (a > 0) band(d.near, d.far, a, ['rgba(159,208,224,', 'rgba(168,220,176,', 'rgba(232,184,120,', 'rgba(232,162,150,'][i]); });
      if (merge > 0) band(shots[0].near, Infinity, merge);
      text(ctx, merge > 0.5 ? `合成后  ${shots[0].near.toFixed(2)} m → ∞  全部清晰` : '每张对焦一段 · F5.6 画质最佳', 980, 360, { size: 26, align: 'center', color: C.ink, weight: 600 });
    }
    // objects
    objs.forEach(([d, lab, kind]) => {
      const x = xOf(d), ok = inF(d);
      ctx.save(); if (!ok) ctx.filter = 'blur(5px)';
      ctx.fillStyle = ok ? '#cdbfae' : '#6e655c';
      ctx.beginPath();
      if (kind === 'rock') { ctx.moveTo(x - 60, gy); ctx.lineTo(x - 40, gy - 60); ctx.lineTo(x + 10, gy - 80); ctx.lineTo(x + 55, gy - 30); ctx.lineTo(x + 62, gy); }
      else if (kind === 'tree') { for (const o of [-34, 0, 34]) { ctx.moveTo(x + o - 22, gy); ctx.lineTo(x + o, gy - 110 - (o === 0 ? 20 : 0)); ctx.lineTo(x + o + 22, gy); } }
      else { ctx.moveTo(x - 130, gy); ctx.lineTo(x - 50, gy - 190); ctx.lineTo(x - 10, gy - 150); ctx.lineTo(x + 30, gy - 230); ctx.lineTo(x + 110, gy); }
      ctx.closePath(); ctx.fill(); ctx.restore();
      text(ctx, `${ok ? '✓' : '✕'} ${lab}`, x, gy + 80, { size: 24, align: 'center', color: ok ? C.good : C.bad, weight: 600 });
    });
    // formula panel
    if (!stack) {
      const fa = E.out(seg(t, c1 + 0.6, c1 + 1.2));
      ctx.save(); glass(ctx, 1160, 120, 640, 150, 18, { alpha: fa * pB }); ctx.globalAlpha = fa * pB;
      kicker(ctx, 'HYPERFOCAL', 1190, 160, 1, { size: 17 });
      text(ctx, 'H = f² / (N·c) = 24² / (11 × 0.03) ≈ 1.75 m', 1190, 212, { size: 26, font: F.latin, color: C.ink });
      text(ctx, '对焦在 H 附近  →  H/2 到 ∞ 都清晰', 1190, 250, { size: 22, color: C.dim });
      ctx.restore();
    } else {
      pill(ctx, 'FOCUS STACKING  ·  焦点堆栈', 1480, 190, E.out(seg(t, c2, c2 + 0.5)) * pB, { size: 24, align: 'center' });
    }
    ctx.restore();
  };
})();

// ==================================================================== BLOCK 4 · cinema knowledge + recap + outro
(() => {
  const { clamp, lerp, seg, E, C, F, text, measure, reveal, cover, kenburns, rrect, glass, line, arrowHead, dimension, ring, kicker, backdrop } = OV;
  const { TAU, shade, scrim, grade, pill, revealSegs, viewfinder, letterbox, coverAt, roundImg, blurred, cameraGlyph, activeCue } = OV.K;
  const S = OV.scenes;

  // ------------------------------------------------------------ 180° SHUTTER
  S.shutter180 = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 61, count: 12, intensity: 0.05 });
    const c1 = s.cue(1), c2 = s.cue(2);
    // rotary shutter disc
    const cx = 420, cy = 450, R = 165, rot = t * TAU * 0.35;
    const da = E.out(seg(t, 0, 0.8));
    ctx.save(); ctx.globalAlpha = da;
    // film gate behind
    ctx.fillStyle = 'rgba(255,220,170,0.9)'; ctx.shadowColor = '#ffd79a'; ctx.shadowBlur = 30; ctx.fillRect(cx - 50, cy - R + 18, 100, 70); ctx.shadowBlur = 0;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    const mg = ctx.createLinearGradient(-R, -R, R, R); mg.addColorStop(0, '#3a332d'); mg.addColorStop(1, '#16120f');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(232,184,120,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(245,238,229,0.25)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
    text(ctx, '180° 开角', cx, cy + R + 50, { size: 28, align: 'center', color: C.goldHi, weight: 600 });
    ctx.restore();
    // formula
    const fa = E.out(seg(t, 0.8, 1.4));
    ctx.save(); ctx.globalAlpha = fa;
    text(ctx, '快门 = 1 / (2 × 帧率)', 130, 780, { size: 34, font: F.serif, weight: 700 });
    [['24 fps', '1/50 s'], ['30 fps', '1/60 s'], ['60 fps', '1/120 s']].forEach(([a, b], i) => {
      const y = 840 + i * 0; const x = 130 + i * 220;
      text(ctx, a, x, 845, { size: 24, font: F.ui, color: i === 0 ? C.goldHi : C.dim, weight: 600 });
      text(ctx, b, x, 880, { size: 28, font: F.latin, color: i === 0 ? C.goldHi : C.ink });
    });
    ctx.restore();
    // right: motion-blur comparison, quantized to 24 fps
    const pR = 1 - E.inOut(seg(t, c2 - 0.2, c2 + 0.5));
    const pa = E.out(seg(t, c1 - 1.5, c1 - 0.6)) * pR;
    const x0 = 860, w = 940, hB = 230;
    const tq = Math.floor(t * 24) / 24, loop = 0.55;
    const pos = tt => x0 + 60 + (w - 120) * (((tt % loop) + loop) % loop) / loop;
    if (pa > 0) {
      [[260, 1 / 48, '1/50 s  ·  自然的运动模糊', true], [560, 1 / 1000, '1/1000 s  ·  一卡一卡，像监控', false]].forEach(([y, exp, lab, ok], i) => {
        const a = pa * E.out(seg(t, c1 - 1.5 + i * 0.6, c1 - 0.8 + i * 0.6 + (i ? c1 * 0 + 0.0 : 0)));
        ctx.save(); glass(ctx, x0, y, w, hB, 18, { alpha: a, fill: 'rgba(10,9,8,0.6)' }); ctx.globalAlpha = a;
        ctx.save(); rrect(ctx, x0, y, w, hB, 18); ctx.clip();
        for (let k = 0; k < 12; k++) line(ctx, x0 + k * 80, y, x0 + k * 80, y + hB, 1, { color: 'rgba(255,255,255,0.04)' });
        const xa = pos(tq), xb = pos(tq + exp), cyb = y + hB / 2 + 10;
        ctx.globalCompositeOperation = 'lighter';
        if (exp > 0.01 && xb > xa) {
          const g = ctx.createLinearGradient(xa, 0, xb, 0); g.addColorStop(0, 'rgba(255,200,130,0.25)'); g.addColorStop(1, 'rgba(255,220,160,0.95)');
          ctx.fillStyle = g; rrect(ctx, xa - 26, cyb - 26, xb - xa + 52, 52, 26); ctx.fill();
        } else {
          for (let gk = 3; gk >= 1; gk--) { const gx = pos(tq - gk / 24); if (gx < xa) { ctx.fillStyle = `rgba(255,225,170,${0.12 * (4 - gk)})`; ctx.beginPath(); ctx.arc(gx, cyb, 26, 0, TAU); ctx.fill(); } }
          ctx.fillStyle = 'rgba(255,225,170,1)'; ctx.shadowColor = '#ffd79a'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(xa, cyb, 26, 0, TAU); ctx.fill();
        }
        ctx.restore();
        text(ctx, lab, x0 + 30, y + 46, { size: 26, weight: 600, color: ok ? C.good : C.bad });
        text(ctx, ok ? '✓' : '✕', x0 + w - 40, y + 46, { size: 30, align: 'right', color: ok ? C.good : C.bad });
        ctx.restore();
      });
      text(ctx, '同一段 24fps 回放', x0 + w / 2, 850, { size: 22, align: 'center', color: 'rgba(245,238,229,0.45)', alpha: pa });
    }
    // sunny-16 → ND calculation
    const pN = E.inOut(seg(t, c2 - 0.1, c2 + 0.6));
    if (pN > 0) {
      const px = 860, py = 230, pw = 940, ph = 600;
      ctx.save(); glass(ctx, px, py, pw, ph, 22, { alpha: pN, fill: 'rgba(12,10,9,0.6)' }); ctx.globalAlpha = pN;
      kicker(ctx, 'SUNNY 16  →  ND', px + 40, py + 64, t - c2);
      const rows = [['晴天基准', 'ISO 100 · F16 · 1/100 s', '正确曝光', C.dim], ['F16 → F2.8', '光圈开大', '+5 档', C.bad], ['1/100 → 1/50', '守住 180° 快门', '+1 档', C.bad]];
      rows.forEach(([a, b, c, col], i) => {
        const ra = E.out(seg(t, c2 + 0.5 + i * 0.7, c2 + 1.0 + i * 0.7)); const y = py + 140 + i * 80;
        text(ctx, a, px + 40, y, { size: 32, font: F.latin, alpha: ra });
        text(ctx, b, px + 340, y, { size: 26, color: C.dim, alpha: ra });
        text(ctx, c, px + pw - 40, y, { size: 32, align: 'right', color: col, weight: 600, alpha: ra });
      });
      const ta = E.out(seg(t, c2 + 2.8, c2 + 3.3));
      line(ctx, px + 40, py + 360, px + pw - 40, py + 360, ta, { color: C.faint });
      // stop ladder: 6 red cells, then the ND dial clears them
      const ndp = E.inOut(seg(t, c2 + 5.0, c2 + 6.6));
      for (let k = 0; k < 8; k++) {
        const on = k < 6, cleared = on && ndp * 6 > k;
        ctx.fillStyle = !on ? 'rgba(255,255,255,0.06)' : cleared ? 'rgba(168,220,176,0.55)' : 'rgba(239,122,104,0.75)';
        rrect(ctx, px + 40 + k * 62, py + 400, 52, 52, 8); ctx.globalAlpha = pN * ta; ctx.fill(); ctx.globalAlpha = pN;
      }
      text(ctx, ndp > 0.98 ? '曝光正确 ✓' : '≈ 过曝 6 档', px + 40 + 8 * 62 + 20, py + 438, { size: 34, weight: 700, color: ndp > 0.98 ? C.good : C.bad, alpha: ta });
      // dial
      const dx = px + pw - 120, dy = py + 500, dr = 62, da2 = E.out(seg(t, c2 + 4.2, c2 + 4.8));
      ctx.globalAlpha = pN * da2;
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(dx, dy, dr, 0, TAU); ctx.stroke();
      for (let k = 0; k < 24; k++) { const a = k * TAU / 24; line(ctx, dx + Math.cos(a) * (dr - 8), dy + Math.sin(a) * (dr - 8), dx + Math.cos(a) * dr, dy + Math.sin(a) * dr, 1, { color: C.gold, width: 1 }); }
      const ang = -Math.PI * 0.75 + ndp * Math.PI * 1.1;
      line(ctx, dx, dy, dx + Math.cos(ang) * (dr - 14), dy + Math.sin(ang) * (dr - 14), 1, { color: C.goldHi, width: 4 });
      text(ctx, `可变 ND  ${(2 + ndp * 4).toFixed(0)} 档`, dx - dr - 30, dy + 10, { size: 30, align: 'right', weight: 600, color: C.goldHi });
      ctx.restore();
    }
  };

  // ------------------------------------------------------------ LOG → GRADE with live waveform
  let LG = null;
  function initLog(im) {
    const sw = 320, sh = 180, c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const g = c.getContext('2d', { willReadFrequently: true });
    const s = Math.max(sw / im.width, sh / im.height); g.drawImage(im, (sw - im.width * s) / 2, (sh - im.height * s) / 2, im.width * s, im.height * s);
    const d = g.getImageData(0, 0, sw, sh).data;
    const lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    const scope = f => {
      const WH = 200, acc = new Float32Array(sw * WH);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const v = clamp(f(lum[y * sw + x])); acc[Math.round((1 - v) * (WH - 1)) * sw + x] += 1; }
      const cv = document.createElement('canvas'); cv.width = sw; cv.height = WH; const cg = cv.getContext('2d'); const id = cg.createImageData(sw, WH);
      for (let i = 0; i < acc.length; i++) { const a = clamp(Math.log1p(acc[i]) / 2.6); id.data[i * 4] = 150; id.data[i * 4 + 1] = 240; id.data[i * 4 + 2] = 170; id.data[i * 4 + 3] = a * 255; }
      cg.putImageData(id, 0, 0); return cv;
    };
    // zebra mask (highlights ≥ ~90%)
    const mk = document.createElement('canvas'); mk.width = sw; mk.height = sh; const mg = mk.getContext('2d'); const md = mg.createImageData(sw, sh);
    for (let i = 0; i < sw * sh; i++) { md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = lum[i] > 0.62 ? 255 : 0; }
    mg.putImageData(md, 0, 0);
    LG = { log: scope(v => (0.5 + (v - 0.5) * 0.55) * 1.12 + 0.02), rec: scope(v => 0.5 + (v - 0.5) * 1.12), mask: mk, tmp: document.createElement('canvas') };
  }
  S.logGrade = (ctx, s) => {
    const { t, W, H, params: P } = s;
    backdrop(ctx, t, { seed: 71, count: 10, intensity: 0.04 });
    const im = s.img(P.img);
    if (im && !LG) initLog(im);
    const c1 = s.cue(1), c2 = s.cue(2);
    const bx = 100, by = 200, bw = 1180, bh = 664;
    const wp = E.inOut(seg(t, c1 + 0.1, c1 + 1.6));
    const split = lerp(bx + bw, bx + bw * 0.5, wp);
    const z = 1.04 + 0.03 * t / s.d;
    const app = E.out(seg(t, 0, 0.6));
    ctx.save(); ctx.globalAlpha = app;
    ctx.save(); rrect(ctx, bx, by, bw, bh, 14); ctx.clip();
    ctx.save(); ctx.filter = 'contrast(0.55) saturate(0.45) brightness(1.12)'; coverAt(ctx, im, bx, by, bw, bh, z, 0.45, 0.45); ctx.restore();
    if (wp > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(split, by, bx + bw - split, bh); ctx.clip();
      ctx.filter = 'contrast(1.12) saturate(1.18)'; coverAt(ctx, im, bx, by, bw, bh, z, 0.45, 0.45); ctx.filter = 'none';
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.18; ctx.fillStyle = '#ff9a50'; ctx.fillRect(bx, by, bw, bh);
      // zebra on graded side
      const za = E.out(seg(t, c2 + 0.2, c2 + 0.7));
      if (za > 0 && LG) {
        const tc = LG.tmp; tc.width = bw; tc.height = bh; const tg = tc.getContext('2d');
        tg.clearRect(0, 0, bw, bh); tg.imageSmoothingEnabled = true;
        const sc = Math.max(bw / 320, bh / 180) * z; // match coverAt geometry (approx centre crop)
        const dw = 320 * sc, dh = 180 * sc;
        tg.drawImage(LG.mask, clamp(bw / 2 - 0.45 * dw, bw - dw, 0), clamp(bh / 2 - 0.45 * dh, bh - dh, 0), dw, dh);
        tg.globalCompositeOperation = 'source-in'; tg.strokeStyle = 'rgba(0,0,0,0.85)'; tg.lineWidth = 5;
        const off = (t * 30) % 18;
        for (let x = -bh + off; x < bw; x += 18) { tg.beginPath(); tg.moveTo(x, bh); tg.lineTo(x + bh, 0); tg.stroke(); }
        tg.globalCompositeOperation = 'source-over';
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = za * 0.7; ctx.drawImage(tc, bx, by);
      }
      ctx.restore();
      line(ctx, split, by, split, by + bh, 1, { color: C.goldHi, width: 2, glow: 14 });
    }
    ctx.restore();
    // letterbox inside the monitor frame
    ctx.fillStyle = '#000'; const lb = (bh - bw / 2.39) / 2; ctx.fillRect(bx, by, bw, lb); ctx.fillRect(bx, by + bh - lb, bw, lb);
    pill(ctx, 'S-LOG3  ·  10-bit', bx + 24, by + lb + 40, E.out(seg(t, 0.5, 1.0)), { size: 22, dot: '#9aa4ad' });
    pill(ctx, 'LUT → Rec.709  +  分级', bx + bw - 24, by + lb + 40, E.out(seg(t, c1 + 1.2, c1 + 1.8)), { size: 22, align: 'right', dot: C.goldHi });
    const ca = E.out(seg(t, c1 + 2.4, c1 + 3.0));
    pill(ctx, '暖 · 肤色与灯', bx + bw - 24, by + bh - lb - 90, ca, { size: 22, align: 'right', color: '#ffd9a8' });
    pill(ctx, '冷 · 阴影与夜', bx + bw - 24, by + bh - lb - 40, E.out(seg(t, c1 + 2.8, c1 + 3.4)), { size: 22, align: 'right', color: C.cyan });
    ctx.restore();
    // waveform scope
    const sx = 1340, sy = 200, sw = 480, sh = 330;
    const sa = E.out(seg(t, 0.6, 1.2));
    ctx.save(); glass(ctx, sx, sy, sw, sh, 16, { alpha: sa, fill: 'rgba(6,8,7,0.82)' }); ctx.globalAlpha = sa;
    kicker(ctx, 'WAVEFORM', sx + 24, sy + 40, t - 0.6, { size: 16 });
    const gx = sx + 50, gy = sy + 62, gw = sw - 74, gh = sh - 92;
    for (const [v, lab] of [[1, '100'], [0.5, '50'], [0, '0']]) { line(ctx, gx, gy + (1 - v) * gh, gx + gw, gy + (1 - v) * gh, 1, { color: 'rgba(255,255,255,0.12)' }); text(ctx, lab, gx - 10, gy + (1 - v) * gh + 6, { size: 14, font: F.ui, align: 'right', color: C.dim }); }
    if (LG) {
      const fr = (split - bx) / bw;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
      if (fr > 0) ctx.drawImage(LG.log, 0, 0, 320 * fr, 200, gx, gy, gw * fr, gh);
      if (fr < 1) ctx.drawImage(LG.rec, 320 * fr, 0, 320 * (1 - fr), 200, gx + gw * fr, gy, gw * (1 - fr), gh);
      ctx.restore();
    }
    const za2 = E.out(seg(t, c2 + 0.2, c2 + 0.7));
    if (za2 > 0) { line(ctx, gx, gy + 0.05 * gh, gx + gw, gy + 0.05 * gh, za2, { color: C.bad, dash: [6, 5], width: 1.5 }); text(ctx, '95%', gx + gw, gy + 0.05 * gh - 8, { size: 14, font: F.ui, align: 'right', color: C.bad, alpha: za2 }); }
    ctx.restore();
    // notes under the scope
    const na = E.out(seg(t, 1.2, 1.8));
    ctx.save(); glass(ctx, sx, 560, sw, 304, 16, { alpha: na }); ctx.globalAlpha = na;
    const notes = t < c1 ? [['LOG', '画面发灰 = 宽容度被保住'], ['', '亮部、暗部都没丢']] : t < c2 ? [['GRADE', '还原对比 → 建立情绪'], ['', '暖肤色 · 冷阴影']] : [['EXPOSE', '别信屏幕亮度'], ['', '看波形 · 开斑马纹']];
    kicker(ctx, notes[0][0], sx + 24, 610, 1, { size: 16 });
    text(ctx, notes[0][1], sx + 24, 680, { size: 32, font: F.serif, weight: 700 });
    text(ctx, notes[1][1], sx + 24, 730, { size: 26, color: C.dim });
    ctx.restore();
  };

  // ------------------------------------------------------------ SHOT LANGUAGE
  S.shotLanguage = (ctx, s) => {
    const { t, W, H, params: P } = s;
    backdrop(ctx, t, { seed: 81, count: 12, intensity: 0.05 });
    const im = s.img(P.img), c1 = s.cue(1), c2 = s.cue(2), d1 = s.cueEnd(1) - c1;
    const fx = 0.3, fy = 0.22; // the man's head in the frame
    // A — shot sizes storyboard
    const pA = 1 - E.inOut(seg(t, c1 - 0.3, c1 + 0.3));
    if (pA > 0) {
      ctx.save(); ctx.globalAlpha = pA;
      kicker(ctx, 'SHOT SIZE  ·  景别', 140, 250, t - 0.1);
      const shots = [[1.0, 0.5, 0.45, '远景', '交代环境'], [2.1, fx, 0.42, '中景', '交代关系'], [5.0, fx, fy + 0.02, '特写', '交代情绪']];
      shots.forEach(([zm, u, v, a, b], i) => {
        const ta = t - s.cue(0) - 1.2 - i * 1.4, al = E.out(seg(ta, 0, 0.6)); if (al <= 0) return;
        const w = 520, h = 218, x = 140 + i * 560, y = 330 + (1 - al) * 30;
        ctx.save(); ctx.globalAlpha = pA * al;
        roundImg(ctx, im, x, y, w, h, 10, zm, u, v);
        rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10); ctx.strokeStyle = 'rgba(255,230,200,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        text(ctx, `0${i + 1}`, x, y + h + 56, { size: 30, font: F.latin, italic: true, color: C.gold });
        text(ctx, a, x + 60, y + h + 56, { size: 40, font: F.serif, weight: 700 });
        text(ctx, b, x + 160, y + h + 54, { size: 28, color: C.dim });
        ctx.restore();
      });
      ctx.restore();
    }
    // B — push / pull
    const pB = E.inOut(seg(t, c1 - 0.3, c1 + 0.3)) * (1 - E.inOut(seg(t, c2 - 0.3, c2 + 0.3)));
    if (pB > 0) {
      const w = 1400, h = w / 2.39, x = (W - w) / 2, y = 230;
      const half = c1 + d1 * 0.48, push = t < half;
      const zm = push ? lerp(1.0, 2.6, E.inOut(seg(t, c1, half))) : lerp(2.6, 1.0, E.inOut(seg(t, half, c2)));
      ctx.save(); ctx.globalAlpha = pB;
      roundImg(ctx, im, x, y, w, h, 12, zm, lerp(0.5, fx, clamp((zm - 1) / 1.6)), lerp(0.45, fy + 0.08, clamp((zm - 1) / 1.6)), push ? 'none' : `saturate(${lerp(1, 0.55, seg(t, half, c2))}) brightness(0.9)`);
      // corner arrows
      const inward = push;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ox = x + w / 2 + sx * (w / 2 - 60), oy = y + h / 2 + sy * (h / 2 - 50);
        const ang = Math.atan2(-sy, -sx) + (inward ? 0 : Math.PI);
        const ph = (t * 1.5) % 1;
        const ax = ox + Math.cos(ang) * 30 * ph, ay = oy + Math.sin(ang) * 30 * ph;
        line(ctx, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30, ax, ay, 1, { color: C.goldHi, width: 3 });
        arrowHead(ctx, ax, ay, ang, 14, C.goldHi);
      }
      ctx.restore();
      pill(ctx, push ? '推  ·  走进内心' : '拉  ·  抽离与孤独', W / 2, y + h + 60, pB, { size: 32, align: 'center', color: '#1b1410', fill: push ? 'rgba(255,220,170,0.95)' : 'rgba(180,215,230,0.95)' });
      kicker(ctx, 'CAMERA MOVE  ·  运镜要有动机', x, y - 30, t - c1 + 0.3);
    }
    // C — 180° axis + edit rhythm
    const pC = E.inOut(seg(t, c2 - 0.3, c2 + 0.3));
    if (pC > 0) {
      ctx.save(); ctx.globalAlpha = pC;
      kicker(ctx, '180° RULE  ·  轴线', 140, 230, t - c2 + 0.3);
      const ax = 180, ay = 470, bxp = 820;
      const A = [380, ay], B = [640, ay];
      ctx.fillStyle = 'rgba(168,220,176,0.1)'; ctx.fillRect(ax, ay, bxp - ax, 260);
      ctx.fillStyle = 'rgba(239,122,104,0.08)'; ctx.fillRect(ax, ay - 200, bxp - ax, 200);
      line(ctx, ax, ay, bxp, ay, 1, { color: C.goldHi, width: 2, dash: [10, 8] });
      text(ctx, '轴线', bxp + 10, ay + 8, { size: 22, color: C.goldHi });
      for (const [[x, y], lab, col] of [[A, 'A', C.cyan], [B, 'B', C.rose]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.fill(); text(ctx, lab, x, y + 9, { size: 26, align: 'center', color: '#141110', weight: 700 }); }
      const cams = [[300, 660], [510, 700], [720, 660]];
      cams.forEach(([x, y]) => cameraGlyph(ctx, x, y, 0.5, Math.atan2(ay - y, 510 - x), C.good));
      cameraGlyph(ctx, 510, 320, 0.5, Math.PI / 2, C.bad);
      text(ctx, '✕ 越轴：人物方向突然反转', 510, 290 - 20, { size: 22, align: 'center', color: C.bad });
      text(ctx, '✓ 机位都在同一侧', 510, 790, { size: 22, align: 'center', color: C.good });
      // edit rhythm timeline
      const tx = 1000, ty = 360, tw = 780;
      kicker(ctx, 'EDIT RHYTHM  ·  剪辑跟情绪', tx, 300, t - c2);
      const clips = [70, 40, 30, 24, 20, 18, 22, 160, 220];
      let x = tx; const tot = clips.reduce((a, b) => a + b, 0);
      clips.forEach((cw, i) => {
        const ww = cw / tot * tw, a = E.out(seg(t, c2 + 0.4 + i * 0.12, c2 + 0.7 + i * 0.12));
        ctx.save(); ctx.globalAlpha = pC * a; ctx.fillStyle = i < 7 ? 'rgba(239,122,104,0.55)' : 'rgba(159,208,224,0.5)';
        rrect(ctx, x + 2, ty, ww - 4, 90, 6); ctx.fill(); ctx.restore(); x += ww;
      });
      const ph = tx + tw * ((t - c2) * 0.12 % 1);
      line(ctx, ph, ty - 16, ph, ty + 106, 1, { color: '#fff', width: 2 });
      text(ctx, '紧张 → 短切', tx, ty + 140, { size: 24, color: C.bad });
      text(ctx, '抒情 → 长镜头', tx + tw, ty + 140, { size: 24, align: 'right', color: C.cyan });
      const g = ctx.createLinearGradient(0, 640, 0, 720); g.addColorStop(0, '#fff3e0'); g.addColorStop(1, '#e8b878');
      reveal(ctx, '每个镜头，都有理由。', tx, 720, t - s.cueEnd(2) + 2.6, { size: 60, font: F.serif, weight: 700, gradient: g, stagger: 0.06 });
      ctx.restore();
    }
  };

  // ------------------------------------------------------------ RECAP MATRIX
  S.recap = (ctx, s) => {
    const { t, W, H, params: P } = s;
    ctx.drawImage(blurred('cinema', s.img('cinema'), 16), 0, 0, W, H);
    shade(ctx, 0.72);
    reveal(ctx, '一张图带走', W / 2, 130, t - 0.1, { size: 52, font: F.serif, weight: 700, align: 'center' });
    const cw = 520, gap = 50, x0 = (W - cw * 3 - gap * 2) / 2, y0 = 175, ch = 740;
    const us = [0.56, 0.5, 0.3];
    P.cols.forEach((c, i) => {
      const ta = t - s.cue(i + 1) + 0.3, a = E.out(seg(ta, 0, 0.6)); if (a <= 0) return;
      const act = activeCue(s, i + 1, 0.3), done = t > s.cueEnd(3) + 0.3;
      const x = x0 + i * (cw + gap), y = y0 + (1 - a) * 40;
      ctx.save(); glass(ctx, x, y, cw, ch, 20, { alpha: a, fill: act ? 'rgba(42,32,22,0.66)' : 'rgba(16,13,11,0.6)' });
      ctx.globalAlpha = a * (act || done ? 1 : 0.6);
      if (act) { rrect(ctx, x, y, cw, ch, 20); ctx.strokeStyle = 'rgba(255,214,160,0.75)'; ctx.lineWidth = 2; ctx.stroke(); }
      roundImg(ctx, s.img(c.img), x + 18, y + 18, cw - 36, 200, 12, 1.1, us[i], 0.4);
      kicker(ctx, c.en, x + 34, y + 270, ta - 0.2, { size: 17 });
      text(ctx, c.name, x + cw - 34, y + 278, { size: 52, font: F.serif, weight: 700, align: 'right', color: act ? C.goldHi : C.ink });
      text(ctx, '装备', x + 34, y + 345, { size: 22, color: C.gold, weight: 600, spacing: 4 });
      c.gear.forEach((g, k) => text(ctx, g, x + 34, y + 395 + k * 46, { size: 32, weight: 500 }));
      line(ctx, x + 34, y + 470, x + cw - 34, y + 470, 1, { color: C.faint });
      text(ctx, '知识', x + 34, y + 520, { size: 22, color: C.gold, weight: 600, spacing: 4 });
      c.know.forEach((g, k) => text(ctx, `· ${g}`, x + 34, y + 570 + k * 50, { size: 32, color: act ? C.ink : C.dim }));
      ctx.restore();
    });
  };

  // ------------------------------------------------------------ OUTRO
  S.outro = (ctx, s) => {
    const { t, W, H } = s;
    const keys = ['portrait', 'landscape', 'cinema'], us = [0.56, 0.5, 0.3];
    keys.forEach((k, i) => {
      ctx.save(); ctx.beginPath();
      const x = i * W / 3, sk = 80;
      ctx.moveTo(x + (i ? sk : 0), 0); ctx.lineTo(x + W / 3 + sk + 4, 0); ctx.lineTo(x + W / 3 + 4, H); ctx.lineTo(x - (i ? 0 : sk), H); ctx.closePath(); ctx.clip();
      coverAt(ctx, s.img(k), x - 40, 0, W / 3 + 160, H, 1.05 + 0.04 * t / s.d, us[i], 0.45);
      ctx.restore();
    });
    shade(ctx, 0.62);
    scrim(ctx, 'bottom', 0.8, 0.6);
    const c1 = s.cue(1);
    const g = ctx.createLinearGradient(0, 330, 0, 430); g.addColorStop(0, '#fff3e0'); g.addColorStop(1, '#e8b878');
    revealSegs(ctx, [{ s: '装备决定' }, { s: '下限', c: C.dim }, { s: '，知识决定' }, { s: '上限', c: C.goldHi }, { s: '。' }], W / 2, 420, t - s.cue(0), { size: 72, font: F.serif, weight: 700, align: 'center', stagger: 0.05, shadow: 'rgba(0,0,0,0.7)' });
    const parts = [['人像', '拍的是人'], ['风光', '拍的是等待'], ['电影', '拍的是时间']];
    const dl = s.cueEnd(1) - c1;
    parts.forEach(([a, b], i) => {
      const x = W / 6 + i * W / 3, ta = t - c1 - i * dl * 0.3;
      reveal(ctx, a, x, 640, ta, { size: 40, align: 'center', color: C.gold, font: F.serif, weight: 600 });
      reveal(ctx, b, x, 712, ta - 0.25, { size: 52, align: 'center', font: F.serif, weight: 700, shadow: 'rgba(0,0,0,0.7)' });
    });
    const ea = E.out(seg(t, s.cueEnd(1) + 0.4, s.cueEnd(1) + 1.4));
    text(ctx, 'BLOCKBUSTER NOTES  ·  VOL.02', W / 2, H - 120, { size: 22, font: F.ui, weight: 600, spacing: 6, align: 'center', color: C.gold, alpha: ea });
  };
})();
