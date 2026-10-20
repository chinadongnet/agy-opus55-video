/* 50mm-portrait — procedural scene library.
 * Every scene is a pure function (ctx, s) of scene-local time s.t, so frames
 * can be rendered by any worker in any order.
 */
(() => {
  const { clamp, lerp, seg, E, rand, win, C, F, text, measure, reveal, cover, kenburns, rrect, glass, line, arrowHead, dimension, ring, kicker, bokeh, backdrop } = OV;
  const S = OV.scenes;
  const TAU = Math.PI * 2;

  // scenes that draw their own typography -> no bottom subtitles
  for (const sc of OV.tl.scenes) if (['hook', 'title', 'recap', 'outro'].includes(sc.type)) OV.noSub.add(sc.id);

  // ------------------------------------------------------------ helpers
  function shade(ctx, a, color = '#000') {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp(a); ctx.fillStyle = color; ctx.fillRect(0, 0, OV.W, OV.H); ctx.restore();
  }
  function scrim(ctx, side, a = 0.75, w = 0.6) {
    const W = OV.W, H = OV.H;
    ctx.save();
    let g;
    if (side === 'left') { g = ctx.createLinearGradient(0, 0, W * w, 0); }
    else if (side === 'right') { g = ctx.createLinearGradient(W, 0, W * (1 - w), 0); }
    else if (side === 'bottom') { g = ctx.createLinearGradient(0, H, 0, H * (1 - w)); }
    else { g = ctx.createLinearGradient(0, 0, 0, H * w); }
    g.addColorStop(0, `rgba(8,6,5,${a})`); g.addColorStop(0.55, `rgba(8,6,5,${a * 0.45})`); g.addColorStop(1, 'rgba(8,6,5,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // warm cinematic grade over a photo
  function grade(ctx, warm = 0.12) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = warm;
    ctx.fillStyle = '#ffb070'; ctx.fillRect(0, 0, OV.W, OV.H);
    ctx.restore();
  }
  // multi-colour cinematic text reveal; segs = [{s, c}]
  function revealSegs(ctx, segs, x, y, t, o = {}) {
    const st = o.stagger ?? 0.04;
    const total = segs.reduce((a, g) => a + measure(ctx, g.s, o), 0);
    let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    let n = 0;
    for (const g of segs) {
      reveal(ctx, g.s, cx, y, t - n * st, { ...o, align: 'left', color: g.c || o.color });
      cx += measure(ctx, g.s, o); n += [...g.s].length;
    }
  }
  // pill label
  function pill(ctx, s, x, y, a, o = {}) {
    if (a <= 0) return;
    const size = o.size || 24, padX = size * 0.75, h = size * 1.9;
    const w = measure(ctx, s, { size, weight: o.weight || 500 }) + padX * 2;
    const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.translate(0, (1 - a) * 12);
    rrect(ctx, x0, y - h / 2, w, h, h / 2);
    ctx.fillStyle = o.fill || 'rgba(14,11,9,0.62)'; ctx.fill();
    ctx.strokeStyle = o.stroke || 'rgba(255,230,200,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    if (o.dot) { ctx.fillStyle = o.dot; ctx.shadowColor = o.dot; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x0 + padX * 0.75, y, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    ctx.restore();
    text(ctx, s, x0 + padX + (o.dot ? 10 : 0), y + size * 0.36, { size, weight: o.weight || 500, color: o.color || C.ink, alpha: a });
    return w;
  }
  // camera viewfinder overlay
  function viewfinder(ctx, t, o = {}) {
    const W = OV.W, H = OV.H, a = o.alpha ?? 1;
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    const m = 64, L = 44;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }
    // rule-of-thirds hint
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
    if (o.rec) {
      const blink = Math.floor(t * 2) % 2 === 0;
      if (blink) { ctx.fillStyle = '#ff4b3e'; ctx.beginPath(); ctx.arc(m + 22, m + 70, 8, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
  // shutter blink: black curtain at time t0 (0.16 s)
  function blink(ctx, t, t0) {
    const d = t - t0;
    if (d < -0.08 || d > 0.14) return;
    const a = d < 0 ? 1 - (-d / 0.08) : 1 - d / 0.14;
    shade(ctx, E.out(clamp(a)), '#000');
  }
  // simple camera glyph (side view) facing +x, centred on (x,y)
  function cameraGlyph(ctx, x, y, s = 1, ang = 0, col = C.ink) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(20,16,13,0.9)'; ctx.strokeStyle = col; ctx.lineWidth = 2 / s;
    rrect(ctx, -46, -30, 62, 60, 8); ctx.fill(); ctx.stroke();
    rrect(ctx, -36, -42, 26, 12, 3); ctx.fill(); ctx.stroke();
    rrect(ctx, 16, -20, 34, 40, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.fillRect(48, -20, 3, 40);
    ctx.restore();
  }
  // cache of blurred images
  const blurCache = {};
  function blurred(key, im, px) {
    const k = key + px;
    if (blurCache[k]) return blurCache[k];
    const c = document.createElement('canvas'); c.width = 960; c.height = Math.round(960 * im.height / im.width);
    const g = c.getContext('2d'); g.filter = `blur(${px}px)`; g.drawImage(im, -20, -20, c.width + 40, c.height + 40);
    return (blurCache[k] = c);
  }
  const fmtShutter = v => (v >= 1000 ? `1/${Math.round(v / 100) * 100}` : `1/${Math.round(v)}`);

  // ============================================================ HOOK (≈9 s)
  S.hook = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1), c2 = s.cue(2), c3 = s.cue(3);
    const lens = s.img('lens'), bad = s.img('bad'), hero = s.img('hero');
    const capScrim = () => scrim(ctx, 'bottom', 0.8, 0.32);
    const capY = H - 132, capO = { size: 60, weight: 600, font: F.serif, shadow: 'rgba(0,0,0,0.85)', shadowBlur: 22, spacing: 2, align: 'center', stagger: 0.035, dur: 0.6 };

    if (t < c1) {
      // A — the lens, with a specular sweep and giant ghost lettering
      const p = t / c1;
      ctx.save(); ctx.filter = 'brightness(0.9) contrast(1.1)';
      cover(ctx, lens, 0, 0, W, H, lerp(1.18, 1.32, E.sine(p)), 0.5, 0.42);
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sx = lerp(-W * 0.4, W * 1.3, E.inOut(seg(t, 0.2, c1)));
      const g = ctx.createLinearGradient(sx - 260, 0, sx + 260, H * 0.3);
      g.addColorStop(0, 'rgba(255,220,180,0)'); g.addColorStop(0.5, 'rgba(255,220,180,0.22)'); g.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      text(ctx, 'ƒ/1.2', W / 2, H * 0.62, { size: 420, font: F.latin, italic: true, align: 'center', color: C.gold, alpha: 0.10 * E.out(seg(t, 0, 0.8)) });
      kicker(ctx, 'SAME GIRL  ·  SAME LENS', W / 2 - 230, 150, t - 0.1);
      capScrim(); revealSegs(ctx, [{ s: '同一个女孩，同一支 ' }, { s: '50mm F1.2', c: C.goldHi }], W / 2, capY, t - 0.05, capO);
      viewfinder(ctx, t, { alpha: 0.55, info: ['50mm', 'ƒ1.2', '1/4000', 'ISO 100'] });
    } else if (t < c2) {
      // B — the snapshot she wants deleted
      const tt = t - c1, d = c2 - c1;
      ctx.save(); ctx.filter = `saturate(${lerp(0.95, 0.55, seg(tt, d * 0.5, d))}) contrast(1.05)`;
      cover(ctx, bad, 0, 0, W, H, lerp(1.0, 1.06, tt / d), 0.5, 0.4);
      ctx.restore();
      shade(ctx, 0.12 + 0.2 * seg(tt, d * 0.6, d));
      viewfinder(ctx, t, { af: [W * 0.505, H * 0.37], lock: seg(tt, 0, 0.3), afColor: '#ff8a76', info: ['1/250', 'ƒ8', 'ISO 400', '正午'] });
      const chips = [['贴太近 · 脸被放大', 0.33, 0.30], ['正午顶光 · 眯眼', 0.66, 0.24], ['背景杂乱', 0.24, 0.62]];
      chips.forEach(([str, x, y], i) => pill(ctx, '✕  ' + str, W * x, H * y, E.out(seg(tt, 0.35 + i * 0.25, 0.75 + i * 0.25)), { size: 26, color: '#ffd9d2', stroke: 'rgba(239,122,104,0.7)', align: 'center' }));
      capScrim(); revealSegs(ctx, [{ s: '这张，' }, { s: '她让你删掉。', c: '#ff9a88' }], W / 2, capY, tt - 0.05, capO);
    } else if (t < c3) {
      // C — the one that became her avatar
      const tt = t - c2, d = c3 - c2;
      cover(ctx, hero, 0, 0, W, H, lerp(1.12, 1.03, E.out(seg(tt, 0, d))), 0.5, 0.4);
      grade(ctx, 0.14);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * (1 - seg(tt, 0, 0.8));
      ctx.fillStyle = '#ffd9a8'; ctx.fillRect(0, 0, W, H); ctx.restore();
      viewfinder(ctx, t, { af: [W * 0.5, H * 0.33], lock: seg(tt, 0, 0.25), info: ['1/1000', 'ƒ1.2', 'ISO 100', '+0.7 EV'], alpha: 1 - seg(tt, d * 0.55, d * 0.8) });
      // avatar badge
      const ap = E.back(seg(tt, d * 0.45, d * 0.75));
      if (ap > 0) {
        const cx = W - 300, cy = 290, r = 120 * ap;
        ctx.save(); ctx.shadowColor = 'rgba(255,200,140,0.6)'; ctx.shadowBlur = 40;
        ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, TAU); ctx.fillStyle = C.goldHi; ctx.fill(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
        cover(ctx, hero, cx - r * 2.2, cy - r * 1.05, r * 4.4, r * 2.5, 1, 0.5, 0.15); ctx.restore();
        pill(ctx, '✓  设为头像', cx, cy + 175, E.out(seg(tt, d * 0.65, d * 0.9)), { size: 26, align: 'center', color: '#1b1410', fill: 'rgba(255,220,170,0.95)', stroke: 'rgba(255,255,255,0.6)' });
      }
      capScrim(); revealSegs(ctx, [{ s: '这张，' }, { s: '她设成了头像。', c: C.goldHi }], W / 2, capY, tt - 0.05, capO);
    } else {
      // D — split comparison + the promise
      const tt = t - c3, d = s.d - c3;
      const sp = E.inOut(seg(tt, 0, 0.7));
      const mid = W / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mid, H); ctx.clip();
      ctx.filter = 'saturate(0.25) brightness(0.55)';
      cover(ctx, bad, lerp(0, -W * 0.25, sp), 0, W, H, 1.05, 0.5, 0.4); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(mid, 0, W - mid, H); ctx.clip();
      ctx.filter = 'brightness(0.8)';
      cover(ctx, hero, lerp(0, W * 0.25, sp), 0, W, H, 1.05, 0.5, 0.4); ctx.restore();
      line(ctx, mid, H / 2, mid, lerp(H / 2, 0, sp), 1, { color: C.goldHi, width: 2, glow: 16 });
      line(ctx, mid, H / 2, mid, lerp(H / 2, H, sp), 1, { color: C.goldHi, width: 2, glow: 16 });
      shade(ctx, 0.35 * seg(tt, 0.5, 1.4));
      text(ctx, '删掉', mid - 60, 170, { size: 30, align: 'right', color: C.bad, alpha: sp, font: F.sans, weight: 500, spacing: 6 });
      text(ctx, '头像', mid + 60, 170, { size: 30, color: C.goldHi, alpha: sp, font: F.sans, weight: 500, spacing: 6 });
      // giant 7
      const p7 = E.out4(seg(tt, 1.2, 2.2));
      if (p7 > 0) {
        ctx.save(); ctx.globalAlpha = p7;
        const g = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.7);
        g.addColorStop(0, '#fff1dc'); g.addColorStop(1, '#d9995a');
        ctx.font = `italic 400 ${Math.round(lerp(560, 460, p7))}px ${F.latin}`; ctx.textAlign = 'center'; ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(255,190,120,0.55)'; ctx.shadowBlur = 60;
        ctx.fillText('7', mid, H * 0.66); ctx.restore();
      }
      revealSegs(ctx, [{ s: '差别不在器材，在 ' }, { s: '七个', c: C.goldHi }, { s: ' 没人告诉你的细节' }], W / 2, capY, tt - 0.05, { ...capO, size: 54 });
    }
    blink(ctx, t, c1 - 0.04); blink(ctx, t, c2 - 0.04);
  };

  // ============================================================ TITLE
  S.title = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 3, count: 30, intensity: 0.11, cx: 0.7 });
    const lens = s.img('lens');
    ctx.save(); ctx.globalAlpha = 0.85 * E.out(seg(t, 0, 1.2));
    cover(ctx, lens, W * 0.38, 0, W * 0.62, H, lerp(1.25, 1.12, E.out(seg(t, 0, s.d))), 0.45, 0.45);
    ctx.restore();
    scrim(ctx, 'left', 1, 0.75);
    const x = 150;
    kicker(ctx, 'PORTRAIT NOTES  ·  VOL.01', x, 330, t - 0.15);
    reveal(ctx, '50mm  ƒ/1.2', x, 430, t - 0.25, { size: 64, font: F.latin, italic: true, color: C.gold, stagger: 0.05 });
    const g = ctx.createLinearGradient(0, 470, 0, 600); g.addColorStop(0, '#fff6ea'); g.addColorStop(1, '#e7c49a');
    reveal(ctx, '拍出她最爱的那张', x, 590, t - 0.45, { size: 128, weight: 700, font: F.serif, gradient: g, stagger: 0.07, dur: 1.0, spacing: 6, shadow: 'rgba(0,0,0,0.6)', shadowBlur: 30 });
    line(ctx, x, 650, x + 560, 650, E.out(seg(t, 1.0, 2.0)), { color: 'rgba(232,184,120,0.6)', width: 1.2 });
    reveal(ctx, '七个重要、却总被忽略的人像细节', x, 712, t - 1.2, { size: 36, color: C.dim, stagger: 0.03 });
    reveal(ctx, '今天，一次讲透。', x, 820, t - s.cue(0), { size: 40, font: F.serif, weight: 500, color: C.goldHi, stagger: 0.06 });
  };

  // ============================================================ CHAPTER CARD
  S.chapter = (ctx, s) => {
    const { t, W, H, params: P } = s;
    backdrop(ctx, t + s.chapter * 7, { seed: 20 + s.chapter, count: 22, intensity: 0.085, cx: 0.3 });
    const p = E.out4(seg(t, 0, 1.1));
    // giant outlined number
    ctx.save();
    ctx.font = `italic 400 420px ${F.latin}`; ctx.textAlign = 'left';
    const g = ctx.createLinearGradient(0, 260, 0, 760); g.addColorStop(0, 'rgba(255,225,185,0.95)'); g.addColorStop(1, 'rgba(200,140,80,0.35)');
    ctx.globalAlpha = p; ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.translate(lerp(60, 0, p), 0);
    ctx.strokeText(P.num, 150, 720);
    ctx.globalAlpha = p * 0.08; ctx.fillStyle = g; ctx.fillText(P.num, 150, 720);
    ctx.restore();
    const x = 760;
    kicker(ctx, P.en, x, 430, t - 0.25);
    reveal(ctx, P.title, x, 545, t - 0.35, { size: 96, weight: 700, font: F.serif, stagger: 0.06, dur: 0.9, spacing: 4 });
    line(ctx, x, 600, x + 900, 600, E.out(seg(t, 0.6, 1.6)), { color: 'rgba(245,238,229,0.25)', width: 1 });
    // chapter progress dots
    const n = OV.tl.chapters;
    for (let i = 1; i <= n; i++) {
      const on = i === s.chapter, done = i < s.chapter;
      ctx.save(); ctx.globalAlpha = E.out(seg(t, 0.6 + i * 0.05, 1.2 + i * 0.05));
      ctx.fillStyle = on ? C.goldHi : done ? 'rgba(232,184,120,0.55)' : 'rgba(245,238,229,0.18)';
      if (on) { ctx.shadowColor = C.gold; ctx.shadowBlur = 14; }
      ctx.beginPath(); ctx.roundRect(x + (i - 1) * 52, 650, on ? 36 : 24, 6, 3); ctx.fill(); ctx.restore();
    }
  };

  // ============================================================ DOF DIAGRAM (real thin-lens maths)
  // full-frame CoC 0.03 mm, f = 50 mm, N = 1.2
  function dofCm(sM, N = 1.2, f = 50, c = 0.03) {
    const s = sM * 1000, Hh = f * f / (N * c) + f;
    const near = s * (Hh - f) / (Hh + s - 2 * f), far = s * (Hh - f) / (Hh - s);
    return { near: near / 10, far: far / 10, total: (far - near) / 10 };
  }
  S.dofDiagram = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 41, count: 14, intensity: 0.05 });
    const c1 = s.cue(1);
    const dist = lerp(1.0, 2.5, E.inOut(seg(t, c1 + 0.2, c1 + 2.2)));
    const D = dofCm(dist);
    const cy = 470, camX = 250, hx = 1120, pxcm = 12.5;
    const app = E.out(seg(t, 0, 0.8));
    ctx.save(); ctx.globalAlpha = app;
    // optical axis with scale break
    line(ctx, camX + 60, cy, hx - 190, cy, E.out(seg(t, 0.1, 1.0)), { color: 'rgba(245,238,229,0.3)', dash: [6, 8] });
    const bx = lerp(camX + 60, hx - 190, 0.5);
    for (const o of [-8, 8]) line(ctx, bx + o - 8, cy + 16, bx + o + 8, cy - 16, 1, { color: C.dim, width: 1.5 });
    cameraGlyph(ctx, camX, cy, 1.2);
    dimension(ctx, camX + 60, cy + 120, hx - 120, cy + 120, `对焦距离  ${dist.toFixed(1)} m`, E.out(seg(t, 0.3, 1.2)), { size: 28, dy: 44, labelColor: C.ink });
    // focus slab
    const ang = -0.44; // head turned ~25°
    const rot = (x, y) => [hx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)];
    const nearEye = rot(-112, -40), farEye = rot(-112, 40), nose = rot(-158, 0), ear = rot(0, 96);
    const fx = nearEye[0];
    const slabFront = fx - (D.total * 0.49) * pxcm, slabBack = fx + (D.total * 0.51) * pxcm; // ~ symmetric at these distances
    const sp = E.out(seg(t, 0.6, 1.4));
    ctx.save();
    const sg = ctx.createLinearGradient(slabFront, 0, slabBack, 0);
    sg.addColorStop(0, 'rgba(232,184,120,0.10)'); sg.addColorStop(0.5, 'rgba(255,215,160,0.30)'); sg.addColorStop(1, 'rgba(232,184,120,0.10)');
    ctx.globalAlpha = sp; ctx.fillStyle = sg; ctx.fillRect(slabFront, cy - 250, slabBack - slabFront, 500);
    ctx.restore();
    line(ctx, slabFront, cy - 250, slabFront, cy + 250, sp, { color: C.gold, width: 1.5, glow: 8 });
    line(ctx, slabBack, cy - 250, slabBack, cy + 250, sp, { color: C.gold, width: 1.5, glow: 8 });
    text(ctx, '清晰范围', (slabFront + slabBack) / 2, cy - 268, { size: 24, align: 'center', color: C.gold, alpha: sp });
    // head (top-down)
    ctx.save(); ctx.translate(hx, cy); ctx.rotate(ang);
    ctx.fillStyle = '#c99a7d'; for (const sy of [-1, 1]) { ctx.beginPath(); ctx.ellipse(0, sy * 100, 11, 20, 0, 0, TAU); ctx.fill(); } // ears
    const hg = ctx.createRadialGradient(-70, 0, 10, -10, 0, 130); hg.addColorStop(0, '#f2d2b8'); hg.addColorStop(1, '#b98c70');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(-10, 0, 112, 94, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-116, -15); ctx.quadraticCurveTo(-150, -6, -160, 0); ctx.quadraticCurveTo(-150, 6, -116, 15); ctx.closePath(); ctx.fill(); // nose
    ctx.save(); ctx.beginPath(); ctx.rect(-40, -140, 240, 280); ctx.clip();
    const hairG = ctx.createLinearGradient(-40, 0, 130, 0); hairG.addColorStop(0, '#3a2a21'); hairG.addColorStop(1, '#1e1612');
    ctx.fillStyle = hairG; ctx.beginPath(); ctx.ellipse(8, 0, 124, 104, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore();
    // feature points
    const pts = [[nearEye, '近眼', 1], [farEye, '远眼', -1], [nose, '鼻尖', -1]];
    pts.forEach(([p, lab, side], i) => {
      const inF = p[0] >= slabFront && p[0] <= slabBack;
      const col = inF ? C.good : C.bad;
      const a = E.out(seg(t, 1.0 + i * 0.3, 1.5 + i * 0.3));
      ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, TAU); ctx.fill(); ctx.restore();
      const ly = p[1] + (i === 0 ? -80 : i === 1 ? 80 : 0) ;
      const lx = i === 2 ? p[0] - 60 : p[0] - 30;
      line(ctx, p[0], p[1], lx, ly, a, { color: col, width: 1 });
      text(ctx, `${inF ? '✓' : '✕'} ${lab}`, lx - 10, ly + (i === 0 ? -10 : i === 1 ? 30 : 9), { size: 26, align: 'right', color: col, alpha: a, weight: 500 });
    });
    text(ctx, '俯视示意 · 头部按比例放大', hx, cy + 320, { size: 20, align: 'center', color: 'rgba(245,238,229,0.4)', alpha: app });
    ctx.restore();
    // readout panel
    const pa = E.out(seg(t, 0.4, 1.1));
    if (pa > 0) {
      const px = 1440, py = 250, pw = 380, ph = 420;
      ctx.save(); ctx.globalAlpha = pa; glass(ctx, px, py, pw, ph, 20); ctx.restore();
      ctx.save(); ctx.globalAlpha = pa;
      kicker(ctx, 'DEPTH OF FIELD', px + 34, py + 62, t - 0.4);
      text(ctx, '50mm · ƒ/1.2 · 全画幅', px + 34, py + 112, { size: 22, color: C.dim });
      text(ctx, '对焦距离', px + 34, py + 175, { size: 24, color: C.dim });
      text(ctx, `${dist.toFixed(2)} m`, px + 34, py + 235, { size: 56, font: F.latin, color: C.ink });
      text(ctx, '清晰范围', px + 34, py + 300, { size: 24, color: C.dim });
      text(ctx, `${D.total.toFixed(1)} cm`, px + 34, py + 372, { size: 72, font: F.latin, italic: true, color: C.goldHi, shadow: 'rgba(255,190,120,0.5)', shadowBlur: 20 });
      ctx.restore();
    }
  };

  // ============================================================ PHOTO (generic annotated still)
  S.photo = (ctx, s) => {
    const { t, W, H, params: P } = s;
    const m = kenburns(ctx, s.img(P.img), t / s.d, P.kb);
    grade(ctx, 0.1);
    if (P.dimSide) scrim(ctx, P.dimSide, 0.85, 0.55);
    if (P.caption) scrim(ctx, 'bottom', 0.7, 0.45);
    for (const r of P.rings || []) {
      const [x, y] = m.map(r.x, r.y);
      ring(ctx, x, y, r.r * (m.s ? Math.min(1.25, m.s * 1.0) : 1), t - s.cue(r.at) - (r.delay || 0), { label: r.label, ok: r.ok, side: r.side || 1 });
    }
    (P.cards || []).forEach((cd, i) => {
      const ta = t - s.cue(cd.at) - (cd.delay || 0.15);
      const a = E.out(seg(ta, 0, 0.7));
      if (a <= 0) return;
      const x = 110, w = 660, h = 176, y = 270 + i * 210;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 30);
      glass(ctx, x, y, w, h, 18);
      ctx.fillStyle = C.gold; ctx.fillRect(x, y + 24, 3, h - 48);
      kicker(ctx, cd.kicker, x + 36, y + 50, ta);
      text(ctx, cd.title, x + 36, y + 108, { size: 44, font: F.serif, weight: 700 });
      text(ctx, cd.body, x + 36, y + 150, { size: 26, color: C.dim });
      ctx.restore();
    });
    if (P.caption) {
      const ta = t - s.cue(P.caption.at) - 0.2;
      kicker(ctx, P.caption.kicker, 120, H - 300, ta);
      reveal(ctx, P.caption.text, 120, H - 230, ta - 0.2, { size: 52, font: F.serif, weight: 600, stagger: 0.04, shadow: 'rgba(0,0,0,0.7)' });
    }
  };

  // ============================================================ PERSPECTIVE (3D head wireframe, true pinhole projection)
  function headPoint(u, v) {
    let X = 0.078 * Math.cos(v) * Math.sin(u);
    const Y = 0.118 * Math.sin(v);
    let Z = 0.095 * Math.cos(v) * Math.cos(u);
    if (v < 0) X *= 1 - 0.28 * Math.pow(-Math.sin(v), 1.6);           // jaw taper
    Z += 0.03 * Math.exp(-Math.pow(u / 0.2, 2) - Math.pow((v + 0.12) / 0.26, 2)); // nose
    Z += 0.008 * Math.exp(-Math.pow((Math.abs(u) - 0.55) / 0.3, 2) - Math.pow((v + 0.15) / 0.25, 2)); // cheeks
    return [X, Y, Z];
  }
  function drawHead(ctx, cx, cy, Dm, o = {}) {
    const K = 2500, camZ = Dm + 0.125;
    const P = (X, Y, Z) => { const k = K * camZ / (camZ - Z); return [cx + X * k, cy - Y * k, k / K]; };
    const col = o.color || C.gold, a = o.alpha ?? 1;
    ctx.save(); ctx.globalAlpha = a; ctx.lineWidth = o.width || 1.3; ctx.strokeStyle = col;
    if (o.glow) { ctx.shadowColor = col; ctx.shadowBlur = o.glow; }
    const visible = u => Math.cos(u) > -0.05;
    // latitudes
    for (let i = -6; i <= 7; i++) {
      const v = i * 0.2; ctx.beginPath(); let st = false;
      for (let u = -Math.PI / 2 - 0.05; u <= Math.PI / 2 + 0.05; u += 0.04) {
        const [x, y] = P(...headPoint(u, v)); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = a * (0.25 + 0.5 * Math.cos(v)); ctx.stroke();
    }
    // longitudes
    for (let j = -8; j <= 8; j++) {
      const u = j * (Math.PI / 16); if (!visible(u)) continue;
      ctx.beginPath();
      for (let v = -1.45; v <= 1.45; v += 0.04) { const [x, y] = P(...headPoint(u, v)); v === -1.45 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.globalAlpha = a * (0.2 + 0.55 * Math.cos(u)); ctx.stroke();
    }
    ctx.globalAlpha = a;
    // features: eyes, mouth, nose ridge, ears
    ctx.lineWidth = (o.width || 1.3) * 1.8;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const th = k / 24 * TAU; const [x, y] = P(...headPoint(sx * 0.42 + Math.cos(th) * 0.13, 0.13 + Math.sin(th) * 0.045)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      // ear
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) { const th = k / 20 * Math.PI; const [X, Y, Z] = headPoint(sx * Math.PI / 2, 0.05 + Math.cos(th) * 0.2); const [x, y] = P(X + sx * 0.018 * Math.sin(th), Y, Z - 0.005); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.beginPath(); for (let k = 0; k <= 16; k++) { const u = -0.32 + k / 16 * 0.64; const [x, y] = P(...headPoint(u, -0.45 - 0.05 * Math.cos(u * 4))); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    const tip = P(...headPoint(0, -0.12));
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tip[0], tip[1], 6, 0, TAU); ctx.fill();
    ctx.restore();
    return { tip, ear: P(...headPoint(Math.PI / 2, 0.05)) };
  }
  S.perspective = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 52, count: 14, intensity: 0.05, cx: 0.4 });
    const c1 = s.cue(1), c2 = s.cue(2);
    let D = lerp(1.5, 0.4, E.inOut(seg(t, 0.8, 3.0)));
    D = lerp(D, 1.5, E.inOut(seg(t, c1 + 3.4, c1 + 5.6)));
    const cx = 720, cy = 500;
    const app = E.out(seg(t, 0, 0.9));
    const ghost = seg(t, c2, c2 + 1);
    if (ghost > 0) drawHead(ctx, cx, cy, 0.4, { color: C.bad, alpha: 0.55 * ghost * app, width: 1.1 });
    const close = clamp((1.5 - D) / 1.1);
    const col = ghost > 0 ? C.goldHi : `rgb(${Math.round(lerp(232, 239, close))},${Math.round(lerp(184, 122, close))},${Math.round(lerp(120, 104, close))})`;
    const hp = drawHead(ctx, cx, cy, D, { color: col, alpha: app, glow: 10 });
    // magnification bar
    const mag = (D + 0.125) / D - 1;
    const pa = E.out(seg(t, 0.5, 1.2));
    const px = 1260, py = 230, pw = 540;
    ctx.save(); ctx.globalAlpha = pa;
    glass(ctx, px, py, pw, 470, 20);
    kicker(ctx, 'PERSPECTIVE', px + 36, py + 62, t - 0.5);
    text(ctx, '拍摄距离', px + 36, py + 130, { size: 24, color: C.dim });
    text(ctx, `${D.toFixed(2)} m`, px + 36, py + 200, { size: 66, font: F.latin, color: C.ink });
    // distance track
    const tx0 = px + 36, tx1 = px + pw - 36, ty = py + 250;
    line(ctx, tx0, ty, tx1, ty, 1, { color: 'rgba(245,238,229,0.2)' });
    const mx = lerp(tx0, tx1, (D - 0.3) / 1.4);
    cameraGlyph(ctx, tx0 - 4, ty, 0.35, 0, C.dim);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx, ty, 8, 0, TAU); ctx.fill();
    for (const v of [0.4, 1.5]) { const x = lerp(tx0, tx1, (v - 0.3) / 1.4); line(ctx, x, ty - 8, x, ty + 8, 1, { color: C.dim }); text(ctx, v + 'm', x, ty + 34, { size: 18, align: 'center', color: C.dim, font: F.ui }); }
    text(ctx, '鼻尖比耳朵多放大', px + 36, py + 340, { size: 24, color: C.dim });
    text(ctx, `+${Math.round(mag * 100)}%`, px + 36, py + 420, { size: 80, font: F.latin, italic: true, color: mag > 0.15 ? C.bad : C.good });
    const bw = (pw - 280) * clamp(mag / 0.35);
    rrect(ctx, px + 250, py + 392, pw - 290, 14, 7); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    rrect(ctx, px + 250, py + 392, Math.max(14, bw), 14, 7); ctx.fillStyle = mag > 0.15 ? C.bad : C.good; ctx.fill();
    ctx.restore();
    // tip label
    const la = E.out(seg(t, 1.5, 2.2)) * (1 - ghost);
    text(ctx, '鼻尖', hp.tip[0] + 22, hp.tip[1] + 8, { size: 24, color: col, alpha: la * app });
    if (ghost > 0) {
      pill(ctx, '0.4 m  ·  脸被“鼓”起来', cx - 300, 160, ghost, { size: 24, color: '#ffd9d2', stroke: 'rgba(239,122,104,0.7)' });
      pill(ctx, '1.5 m  ·  真实比例', cx + 40, 160, E.out(seg(t, c2 + 0.4, c2 + 1.2)), { size: 24, color: '#1b1410', fill: 'rgba(255,220,170,0.95)' });
      const ka = E.out(seg(t, c2 + 2.5, c2 + 3.3));
      text(ctx, '退后一步  +  后期裁切', px + 36, py + 540, { size: 40, font: F.serif, weight: 700, color: C.goldHi, alpha: ka });
    }
  };

  // ============================================================ CAMERA HEIGHT (pinhole projection of a figure)
  // figure polygons in metres (x: horizontal, y: up). total height 1.64 m
  const FIG = (() => {
    const parts = [];
    parts.push({ pts: [[-0.105, 1.60], [0, 1.66], [0.105, 1.60], [0.14, 1.30], [0.12, 1.15], [-0.12, 1.15], [-0.14, 1.30]], c: '#3a2a21' }); // hair (behind)
    const head = []; for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; head.push([Math.cos(a) * 0.085, 1.52 + Math.sin(a) * 0.1]); }
    parts.push({ pts: head, c: '#e9c7ab' });
    const cap = []; for (let k = 0; k <= 14; k++) { const a = k / 14 * Math.PI; cap.push([Math.cos(a) * 0.092, 1.555 + Math.sin(a) * 0.09]); }
    cap.push([-0.092, 1.50], [-0.05, 1.575], [0.06, 1.565], [0.092, 1.50]);
    parts.push({ pts: cap, c: '#3a2a21' }); // fringe
    parts.push({ pts: [[-0.03, 1.44], [0.03, 1.44], [0.035, 1.37], [-0.035, 1.37]], c: '#e9c7ab' }); // neck
    parts.push({ pts: [[-0.19, 1.38], [0.19, 1.38], [0.14, 1.02], [0.25, 0.60], [-0.25, 0.60], [-0.14, 1.02]], c: '#efe6da' }); // dress
    for (const sx of [-1, 1]) {
      parts.push({ pts: [[sx * 0.18, 1.36], [sx * 0.215, 1.36], [sx * 0.25, 0.82], [sx * 0.225, 0.80]], c: '#e9c7ab' }); // arm
      parts.push({ pts: [[sx * 0.03, 0.62], [sx * 0.115, 0.62], [sx * 0.10, 0.08], [sx * 0.05, 0.08]], c: '#e9c7ab' }); // leg
      parts.push({ pts: [[sx * 0.045, 0.08], [sx * 0.105, 0.08], [sx * 0.12, 0.0], [sx * 0.035, 0.0]], c: '#5a3d30' }); // shoe
    }
    return parts;
  })();
  function project(h, D, aimY = 0.82) {
    const th = Math.atan2(aimY - h, D), a = [Math.cos(th), Math.sin(th)], n = [-Math.sin(th), Math.cos(th)];
    return (x, y) => { const z = D * a[0] + (y - h) * a[1], u = D * n[0] + (y - h) * n[1]; return [x / z, u / z]; };
  }
  function drawFig(ctx, map, alpha = 1) {
    ctx.save(); ctx.globalAlpha *= alpha;
    for (const p of FIG) {
      ctx.beginPath(); p.pts.forEach(([x, y], i) => { const [X, Y] = map(x, y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath();
      ctx.fillStyle = p.c; ctx.fill();
    }
    ctx.restore();
  }
  S.cameraHeight = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 63, count: 12, intensity: 0.05 });
    const c1 = s.cue(1), c2 = s.cue(2);
    const h = lerp(1.55, 0.55, E.inOut(seg(t, c1 + 0.3, c1 + 2.8)));
    const D = 2.5;
    const crop = E.inOut(seg(t, c2, c2 + 0.9));
    const A = E.out(seg(t, 0, 0.8)) * (1 - crop);
    // ---- side schematic
    if (A > 0) {
      ctx.save(); ctx.globalAlpha = A;
      const gy = 820, sc = 280, fxp = 920, camX = fxp - D * sc;
      line(ctx, 120, gy, 1120, gy, 1, { color: 'rgba(245,238,229,0.25)' });
      drawFig(ctx, (x, y) => [fxp + x * sc, gy - y * sc]);
      const camY = gy - h * sc, th = Math.atan2(0.82 - h, D);
      ctx.save(); ctx.globalAlpha *= 0.12; ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.moveTo(camX, camY); ctx.lineTo(fxp, gy - 1.68 * sc); ctx.lineTo(fxp, gy + 4); ctx.closePath(); ctx.fill(); ctx.restore();
      line(ctx, camX, camY, fxp, gy - 1.64 * sc, 1, { color: C.gold, dash: [5, 6], width: 1.2 });
      line(ctx, camX, camY, fxp, gy, 1, { color: C.gold, dash: [5, 6], width: 1.2 });
      cameraGlyph(ctx, camX, camY, 0.9, -th);
      dimension(ctx, camX - 70, gy, camX - 70, camY, '', 1, { color: C.dim });
      text(ctx, `${h.toFixed(2)} m`, camX - 90, (gy + camY) / 2 + 10, { size: 30, font: F.latin, align: 'right', color: C.goldHi });
      text(ctx, '镜头高度', camX - 90, (gy + camY) / 2 - 30, { size: 20, align: 'right', color: C.dim });
      ctx.restore();
      // ---- viewfinder panel
      const vx = 1280, vy = 160, vw = 460, vh = 690;
      ctx.save(); ctx.globalAlpha = A;
      ctx.fillStyle = '#1a1512'; rrect(ctx, vx, vy, vw, vh, 10); ctx.fill();
      ctx.save(); rrect(ctx, vx, vy, vw, vh, 10); ctx.clip();
      const bg = ctx.createLinearGradient(0, vy, 0, vy + vh); bg.addColorStop(0, '#3b4a3a'); bg.addColorStop(0.62, '#59684f'); bg.addColorStop(0.63, '#8a7c66'); bg.addColorStop(1, '#6d604e');
      ctx.fillStyle = bg; ctx.fillRect(vx, vy, vw, vh);
      const pr = project(h, D);
      const v0 = pr(0, 0)[1], v1 = pr(0, 1.64)[1], vh8 = pr(0, 0.78)[1];
      const scl = (vh * 0.9) / (v1 - v0), base = vy + vh * 0.975;
      drawFig(ctx, (x, y) => { const [u, v] = pr(x, y); return [vx + vw / 2 + u * scl, base - (v - v0) * scl]; });
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; rrect(ctx, vx, vy, vw, vh, 10); ctx.stroke();
      const legPct = (vh8 - v0) / (v1 - v0) * 100;
      const hipY = base - (vh8 - v0) * scl;
      line(ctx, vx - 30, hipY, vx + vw + 30, hipY, 1, { color: C.goldHi, dash: [4, 6], width: 1.2 });
      text(ctx, '腿长占比', vx + vw + 40, hipY - 40, { size: 22, color: C.dim });
      text(ctx, `${legPct.toFixed(1)}%`, vx + vw + 40, hipY + 14, { size: 44, font: F.latin, italic: true, color: legPct > 48.5 ? C.good : C.goldHi });
      text(ctx, '取景器', vx, vy - 20, { size: 22, color: C.dim });
      ctx.restore();
    }
    // ---- crop rule
    if (crop > 0) {
      ctx.save(); ctx.globalAlpha = crop;
      const sc = 330, fxp = W / 2, gy = 880;
      drawFig(ctx, (x, y) => [fxp + x * sc, gy - y * sc]);
      const rows = [
        [0.08, '脚踝', false, 0], [0.27, '小腿中段', true, 1], [0.45, '膝盖', false, 2],
        [0.66, '大腿中段', true, 3], [0.81, '手腕', false, 4],
      ];
      rows.forEach(([y, lab, ok, i]) => {
        const a = E.out(seg(t, c2 + 1.6 + i * 0.55, c2 + 2.2 + i * 0.55));
        const Y = gy - y * sc, col = ok ? C.good : C.bad;
        line(ctx, fxp - 380, Y, fxp + 380, Y, a, { color: col, dash: ok ? [10, 6] : [3, 6], width: 2, glow: 8 });
        text(ctx, `${ok ? '✓' : '✕'}  ${lab}`, ok ? fxp + 400 : fxp - 400, Y + 10, { size: 30, weight: 500, align: ok ? 'left' : 'right', color: col, alpha: a });
      });
      kicker(ctx, 'NEVER CROP AT JOINTS', 140, 230, t - c2 - 0.4);
      reveal(ctx, '不在关节处裁切', 140, 310, t - c2 - 0.6, { size: 60, font: F.serif, weight: 700 });
      ctx.restore();
    }
  };

  // ============================================================ SHUTTER STOPS (sunny-16 maths)
  S.shutterStops = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 74, count: 14, intensity: 0.05, c0: '#241a12' });
    const c1 = s.cue(1), c2 = s.cue(2), c3 = s.cue(3);
    const fullEv = 2 * Math.log2(16 / 1.2); // ≈ 7.47
    const ev = fullEv * E.inOut(seg(t, c1 + 0.3, c1 + 3.6));
    const N = 16 / Math.pow(2, ev / 2), sh = 125 * Math.pow(2, ev);
    const fixed = E.out(seg(t, c3 + 0.4, c3 + 1.4));
    const over = Math.max(0, Math.log2(sh / 8000)) * seg(t, c2, c2 + 0.5) * (1 - fixed);
    const app = E.out(seg(t, 0, 0.8));
    ctx.save(); ctx.globalAlpha = app;
    // LCD readout
    const boxes = [['ISO', '100', C.ink], ['APERTURE', `ƒ/${N < 1.25 ? '1.2' : N.toFixed(1)}`, C.goldHi], ['SHUTTER', fmtShutter(sh), over > 0.05 ? C.bad : C.ink]];
    boxes.forEach(([k, v, c], i) => {
      const x = 150 + i * 330, y = 180;
      glass(ctx, x, y, 300, 170, 16);
      text(ctx, k, x + 30, y + 48, { size: 18, font: F.ui, weight: 600, spacing: 4, color: C.dim });
      text(ctx, v, x + 30, y + 128, { size: 62, font: F.latin, color: c });
    });
    text(ctx, '阳光 16 法则：晴天 · ISO 100 · ƒ/16 → 1/125 s', 150, 405, { size: 26, color: C.dim });
    // preview with zebra
    const px = 1240, py = 180, pw = 530, ph = 250;
    ctx.save(); rrect(ctx, px, py, pw, ph, 12); ctx.clip();
    ctx.filter = `brightness(${1 + over * 0.9}) contrast(${1 - over * 0.12})`;
    cover(ctx, s.img('half'), px, py, pw, ph, 1.15, 0.5, 0.3); ctx.filter = 'none';
    if (over > 0.05) {
      ctx.globalAlpha = clamp(over) * (0.55 + 0.25 * Math.sin(t * 12));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
      const off = (t * 60) % 22;
      for (let x = px - ph; x < px + pw; x += 22) { ctx.beginPath(); ctx.moveTo(x + off, py + ph); ctx.lineTo(x + off + ph, py); ctx.stroke(); }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; rrect(ctx, px, py, pw, ph, 12); ctx.stroke();
    text(ctx, over > 0.05 ? '过曝 · 高光溢出' : fixed > 0.5 ? '曝光正常' : '预览', px + 20, py + ph + 36, { size: 22, color: over > 0.05 ? C.bad : C.dim });
    // shutter ruler
    const rx0 = 180, step = 190, ry = 610;
    const stops = ['1/125', '1/250', '1/500', '1/1000', '1/2000', '1/4000', '1/8000', '1/16000', '1/32000'];
    const ruler = E.out(seg(t, 0.4, 1.4));
    line(ctx, rx0, ry, rx0 + step * 8, ry, ruler, { color: 'rgba(245,238,229,0.35)', width: 2 });
    stops.forEach((st, i) => {
      const x = rx0 + i * step, a = E.out(seg(t, 0.5 + i * 0.06, 1.0 + i * 0.06));
      line(ctx, x, ry - 12, x, ry + 12, a, { color: C.dim, width: 1.5 });
      text(ctx, st, x, ry + 50, { size: 22, font: F.ui, align: 'center', color: i > 6 ? 'rgba(239,122,104,0.85)' : C.dim, alpha: a });
    });
    // mechanical limit wall
    const wa = E.out(seg(t, c2 - 0.2, c2 + 0.6));
    const wx = rx0 + 6 * step;
    if (wa > 0) {
      ctx.save(); ctx.globalAlpha = wa * 0.16 * (1 - fixed * 0.6); ctx.fillStyle = C.bad; ctx.fillRect(wx, ry - 70, step * 2.4, 140); ctx.restore();
      line(ctx, wx, ry - 80, wx, ry + 80, wa, { color: C.bad, width: 3, glow: 14 });
      text(ctx, '机械快门极限', wx, ry - 96, { size: 24, align: 'center', color: C.bad, alpha: wa, weight: 500 });
    }
    // marker
    const mx = rx0 + Math.log2(sh / 125) * step;
    const mcol = fixed > 0.5 ? C.good : over > 0.05 ? C.bad : C.goldHi;
    ctx.save(); ctx.fillStyle = mcol; ctx.shadowColor = mcol; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(mx, ry, 12, 0, TAU); ctx.fill(); ctx.restore();
    if (ev > 0.3) text(ctx, `+${ev.toFixed(1)} 档`, mx, ry - 30, { size: 26, font: F.latin, align: 'center', color: mcol });
    if (over > 0.05 && fixed < 0.5) text(ctx, `超出 ${Math.log2(sh / 8000).toFixed(1)} 档`, (wx + mx) / 2, ry + 100, { size: 28, align: 'center', color: C.bad, weight: 600, alpha: clamp(over * 2) });
    // solutions
    const sols = [['ELECTRONIC SHUTTER', '电子快门', '最高可达 1/32000'], ['ND FILTER', 'ND8 减光镜', '减 3 档 → 约 1/2700']];
    sols.forEach(([k, ti, b], i) => {
      const a = E.out(seg(t, c3 + 0.6 + i * 0.9, c3 + 1.3 + i * 0.9));
      if (a <= 0) return;
      const x = 180 + i * 560, y = 720;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 24);
      glass(ctx, x, y, 520, 130, 16);
      ctx.fillStyle = C.good; ctx.fillRect(x, y + 20, 3, 90);
      kicker(ctx, k, x + 30, y + 42, 1, { color: C.good });
      text(ctx, ti, x + 30, y + 98, { size: 38, font: F.serif, weight: 700 });
      text(ctx, b, x + 490, y + 98, { size: 24, align: 'right', color: C.dim });
      ctx.restore();
    });
    ctx.restore();
  };

  // ============================================================ BACKGROUND DISTANCE (blur ∝ x/(s+x))
  S.bgDistance = (ctx, s) => {
    const { t, W, H } = s;
    backdrop(ctx, t, { seed: 85, count: 10, intensity: 0.04 });
    const c1 = s.cue(1), sDist = 2;
    let x = lerp(0.3, 4, E.inOut(seg(t, c1 + 0.4, c1 + 2.8)));
    x = lerp(x, 10, E.inOut(seg(t, c1 + 4.6, c1 + 6.8)));
    const frac = x / (sDist + x);
    const app = E.out(seg(t, 0, 0.8));
    ctx.save(); ctx.globalAlpha = app;
    // schematic
    const gy = 360, camX = 180, ppm = 120, subX = camX + sDist * ppm, bgX = subX + x * ppm;
    line(ctx, 120, gy, 1800, gy, 1, { color: 'rgba(245,238,229,0.2)' });
    cameraGlyph(ctx, camX, gy - 40, 0.8);
    // subject
    ctx.fillStyle = '#efe6da'; ctx.beginPath(); ctx.arc(subX, gy - 150, 18, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(subX - 22, gy - 125); ctx.lineTo(subX + 22, gy - 125); ctx.lineTo(subX + 30, gy); ctx.lineTo(subX - 30, gy); ctx.fill();
    // background: lamp post with string lights
    line(ctx, bgX, gy, bgX, gy - 220, 1, { color: 'rgba(245,238,229,0.5)', width: 3 });
    for (let k = 0; k < 5; k++) bokeh(ctx, bgX + Math.sin(k * 1.7) * 20, gy - 200 + k * 34, 10, k % 2 ? 'rgba(255,170,150,A)' : 'rgba(255,205,140,A)', 1);
    dimension(ctx, camX + 40, gy + 50, subX, gy + 50, `${sDist} m`, 1, { size: 24, dy: -14 });
    dimension(ctx, subX, gy + 95, bgX, gy + 95, `背景距离 ${x.toFixed(1)} m`, 1, { size: 24, dy: 36, labelColor: C.goldHi, color: C.gold });
    // preview of bokeh
    const vx = 180, vy = 575, vw = 620, vh = 300;
    ctx.save(); rrect(ctx, vx, vy, vw, vh, 14); ctx.clip();
    ctx.fillStyle = '#120e0c'; ctx.fillRect(vx, vy, vw, vh);
    const r = rand(9);
    for (let k = 0; k < 22; k++) {
      const bx = vx + r() * vw, by = vy + r() * vh * 0.8, col = r() > 0.5 ? 'rgba(255,200,140,A)' : 'rgba(255,150,140,A)';
      bokeh(ctx, bx, by, 4 + frac * 70 * (0.7 + r() * 0.5), col, lerp(1, 0.5, frac));
    }
    ctx.fillStyle = '#0a0807';
    ctx.beginPath(); ctx.arc(vx + vw / 2, vy + 150, 52, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(vx + vw / 2, vy + vh + 40, 140, 170, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.2; rrect(ctx, vx, vy, vw, vh, 14); ctx.stroke();
    // curve
    const gx = 960, gw = 780, gyy = 870, gh = 280;
    line(ctx, gx, gyy, gx + gw, gyy, 1, { color: C.dim }); line(ctx, gx, gyy, gx, gyy - gh, 1, { color: C.dim });
    text(ctx, '背景距离 / 拍摄距离', gx + gw, gyy + 36, { size: 20, align: 'right', color: C.dim });
    text(ctx, '虚化程度', gx - 14, gyy - gh - 14, { size: 20, color: C.dim });
    const X = v => gx + v / 5 * gw, Y = f => gyy - f * gh;
    ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.shadowColor = C.gold; ctx.shadowBlur = 10; ctx.beginPath();
    for (let v = 0; v <= 5.001; v += 0.05) { const f = v / (1 + v); v ? ctx.lineTo(X(v), Y(f)) : ctx.moveTo(X(v), Y(f)); }
    ctx.stroke(); ctx.restore();
    for (let k = 1; k <= 5; k++) text(ctx, k + '×', X(k), gyy + 28, { size: 18, align: 'center', color: C.dim, font: F.ui });
    const two = E.out(seg(t, c1 + 2.6, c1 + 3.4));
    line(ctx, X(2), gyy, X(2), Y(2 / 3), two, { color: C.goldHi, dash: [4, 5] });
    line(ctx, gx, Y(2 / 3), X(2), Y(2 / 3), two, { color: C.goldHi, dash: [4, 5] });
    text(ctx, '2× → 67%', X(2) + 16, Y(2 / 3) - 16, { size: 30, font: F.latin, color: C.goldHi, alpha: two });
    const tailA = E.out(seg(t, c1 + 6.0, c1 + 6.8));
    text(ctx, '再往后 · 收益递减', X(4.2), Y(0.81) - 30, { size: 24, align: 'center', color: C.dim, alpha: tailA });
    const xr = Math.min(5, x / sDist);
    ctx.save(); ctx.fillStyle = C.goldHi; ctx.shadowColor = C.goldHi; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(X(xr), Y(xr / (1 + xr)), 9, 0, TAU); ctx.fill(); ctx.restore();
    text(ctx, `${Math.round(frac * 100)}%`, vx + vw, vy - 16, { size: 48, font: F.latin, italic: true, align: 'right', color: C.goldHi });
    text(ctx, '光斑达到最大虚化的', vx + vw - 120, vy - 22, { size: 22, align: 'right', color: C.dim });
    ctx.restore();
  };

  // ============================================================ SUN ORBIT (per-pixel relit head)
  const HG = (() => {
    const w = 240, h = 300, n = w * h;
    const z = new Float32Array(n), mask = new Uint8Array(n);
    const zf = (x, y) => {
      const ae = 0.74 * (1 - 0.3 * Math.pow(Math.max(0, -y), 1.5));
      const q = 1 - (x / ae) ** 2 - (y / 0.98) ** 2;
      if (q <= 0) return -1;
      let v = Math.sqrt(q);
      v += 0.26 * Math.exp(-((x / 0.11) ** 2) - (((y + 0.06) / 0.26) ** 2));
      v -= 0.09 * Math.exp(-(((Math.abs(x) - 0.28) / 0.11) ** 2) - (((y - 0.12) / 0.08) ** 2));
      v += 0.05 * Math.exp(-(((y - 0.27) / 0.06) ** 2)) * (Math.abs(x) < 0.5 ? 1 : 0);
      v += 0.05 * Math.exp(-((x / 0.18) ** 2) - (((y + 0.45) / 0.05) ** 2));
      return v;
    };
    const hair = (x, y) => { const q = 1 - (x / 0.92) ** 2 - ((y - 0.1) / 1.12) ** 2; return q > 0 && y > -0.85 ? Math.sqrt(q) * 0.8 : -1; };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = (i / w - 0.5) * 2.2, y = -(j / h - 0.5) * 2.75, k = j * w + i;
      const f = zf(x, y);
      if (f > 0) { z[k] = f; mask[k] = 1; continue; }
      const hh = hair(x, y);
      if (hh > 0) { z[k] = hh; mask[k] = 2; }
    }
    const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
    const sx = 2.2 / w, sy = 2.75 / h;
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i; if (!mask[k]) continue;
      const zx = (z[k + 1] - z[k - 1]) / (2 * sx), zy = (z[k - w] - z[k + w]) / (2 * sy);
      const l = Math.hypot(zx, zy, 1); nx[k] = -zx / l; ny[k] = -zy / l; nz[k] = 1 / l;
      if (mask[k + 1] !== mask[k] || mask[k - 1] !== mask[k]) { const a = Math.sign(i - w / 2); nx[k] = a * 0.95; nz[k] = 0.3; }
    }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    return { w, h, mask, nx, ny, nz, cv, g: cv.getContext('2d'), id: cv.getContext('2d').createImageData(w, h) };
  })();
  function renderHead(L) {
    const { w, h, mask, nx, ny, nz, g, id } = HG, d = id.data;
    const back = Math.max(0, -L[2]);
    for (let k = 0, n = w * h; k < n; k++) {
      const o = k * 4, m = mask[k];
      if (!m) { d[o + 3] = 0; continue; }
      const dif = Math.max(0, (nx[k] * L[0] + ny[k] * L[1] + nz[k] * L[2] + 0.2) / 1.2);
      const side = Math.max(0, nx[k] * L[0] + ny[k] * L[1]);
      const rim = Math.pow(1 - nz[k], 2.2) * back * (0.4 + side) * 1.6;
      let r, gg, b;
      if (m === 1) { const a = 0.13 + 0.95 * dif; r = 236 * a + 255 * rim; gg = 192 * a + 210 * rim; b = 168 * a + 150 * rim; }
      else { const a = 0.08 + 0.35 * dif; r = 62 * a * 2 + 255 * rim * 1.4; gg = 44 * a * 2 + 196 * rim * 1.4; b = 34 * a * 2 + 120 * rim * 1.4; }
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return HG.cv;
  }
  S.sunOrbit = (ctx, s) => {
    const { t, W, H } = s;
    const c1 = s.cue(1);
    // θ: 0 = front (behind camera), 90 = noon, 160 = back-side
    let th = 90;
    th = lerp(th, 18, E.inOut(seg(t, c1 * 0.52, c1 * 0.52 + 1.6)));
    th = lerp(th, 158, E.inOut(seg(t, c1 + 0.3, c1 + 2.6)));
    const r = th * Math.PI / 180;
    const sideK = lerp(0.15, 0.55, seg(th, 100, 158));
    const L = [sideK, Math.sin(r), Math.cos(r)]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    const back = Math.max(0, -L[2]);
    // background brightens with backlight
    const g = ctx.createRadialGradient(560 + 220 * sideK, 300, 30, 560, 500, 900);
    g.addColorStop(0, `rgba(${Math.round(60 + 170 * back)},${Math.round(44 + 120 * back)},${Math.round(30 + 60 * back)},1)`); g.addColorStop(1, '#070605');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const cv = renderHead(L);
    const hw = 520, hh = hw * HG.h / HG.w, hx = 560 - hw / 2, hy = 520 - hh / 2;
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cv, hx, hy, hw, hh);
    if (back > 0.1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = back * 0.8; ctx.filter = 'blur(18px)'; ctx.drawImage(cv, hx, hy, hw, hh); }
    ctx.restore();
    // orbit diagram
    const ox = 1420, oy = 720, R = 250;
    ctx.save(); ctx.globalAlpha = E.out(seg(t, 0.2, 1.0));
    line(ctx, ox - R - 60, oy, ox + R + 60, oy, 1, { color: 'rgba(245,238,229,0.25)' });
    const zones = [[0, 40, '顺光', C.dim], [65, 115, '顶光', C.bad], [130, 180, '逆光', C.goldHi]];
    for (const [a0, a1, lab, col] of zones) {
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha *= 0.55; ctx.lineWidth = 10; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ox, oy, R, Math.PI + a0 * Math.PI / 180, Math.PI + a1 * Math.PI / 180); ctx.stroke(); ctx.restore();
      const am = (a0 + a1) / 2 * Math.PI / 180;
      text(ctx, lab, ox - Math.cos(am) * (R + 50), oy - Math.sin(am) * (R + 50) + 8, { size: 26, align: 'center', color: col, weight: 500 });
    }
    cameraGlyph(ctx, ox - R - 120, oy - 30, 0.6);
    ctx.fillStyle = '#efe6da'; ctx.beginPath(); ctx.arc(ox, oy - 40, 16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ox - 18, oy - 20); ctx.lineTo(ox + 18, oy - 20); ctx.lineTo(ox + 24, oy); ctx.lineTo(ox - 24, oy); ctx.fill();
    const sx = ox - Math.cos(r) * R, sy = oy - Math.sin(r) * R;
    line(ctx, sx, sy, ox, oy - 40, 1, { color: 'rgba(255,214,150,0.5)', dash: [4, 6] });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70); sg.addColorStop(0, 'rgba(255,240,200,1)'); sg.addColorStop(0.25, 'rgba(255,200,120,0.8)'); sg.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 70, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore();
    // state label
    const lab = th > 125 ? ['BACKLIGHT', '逆光 / 侧逆光：发丝发光', C.goldHi] : th > 55 ? ['TOP LIGHT', '顶光：眼窝、鼻下重阴影', C.bad] : ['FRONT LIGHT', '顺光：平，没有立体感', C.dim];
    kicker(ctx, lab[0], 1120, 200, 1, { color: lab[2] });
    text(ctx, lab[1], 1120, 262, { size: 40, font: F.serif, weight: 700, color: C.ink });
  };

  // ============================================================ COMPARE (white balance under foliage)
  S.compare = (ctx, s) => {
    const { t, W, H, params: P } = s;
    const im = s.img(P.img), c1 = s.cue(1);
    const z = lerp(1.04, 1.1, t / s.d);
    const split = lerp(W, W / 2, E.inOut(seg(t, c1 + 0.2, c1 + 1.4)));
    // left: green cast
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, split, H); ctx.clip();
    cover(ctx, im, 0, 0, W, H, z, 0.5, 0.35);
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.55; ctx.fillStyle = '#3fae5a'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.18; ctx.fillStyle = '#7fd08a'; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // right: warm corrected
    if (split < W - 1) {
      ctx.save(); ctx.beginPath(); ctx.rect(split, 0, W - split, H); ctx.clip();
      ctx.filter = 'brightness(1.06)';
      cover(ctx, im, 0, 0, W, H, z, 0.5, 0.35); ctx.filter = 'none';
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffa660'; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      line(ctx, split, 0, split, H, 1, { color: C.goldHi, width: 2, glow: 14 });
    }
    scrim(ctx, 'top', 0.6, 0.3);
    const fx = W * 0.49, fy = H * 0.36;
    ring(ctx, fx - (split < W - 1 ? 0 : 0), fy, 90, t - 0.8, { label: '皮肤偏青绿', ok: false, side: -1 });
    pill(ctx, P.left, 120, 170, E.out(seg(t, 0.3, 1.0)), { size: 26, dot: '#6fd08a' });
    pill(ctx, 'AWB 5200K', 120, 236, E.out(seg(t, 0.6, 1.2)), { size: 22, color: C.dim });
    const ra = E.out(seg(t, c1 + 1.0, c1 + 1.7));
    pill(ctx, P.right, W - 120, 170, ra, { size: 26, align: 'right', dot: C.goldHi });
    pill(ctx, 'WB 6300K  ·  地面当反光板', W - 120, 236, E.out(seg(t, c1 + 1.3, c1 + 2.0)), { size: 22, align: 'right', color: C.dim });
  };

  // ============================================================ DIRECTING
  S.directing = (ctx, s) => {
    const { t, W, H, params: P } = s;
    const im = s.img(P.img), c1 = s.cue(1), c2 = s.cue(2);
    const m = kenburns(ctx, im, t / s.d, [1.15, 0.6, 0.35, 1.04, 0.5, 0.4]);
    grade(ctx, 0.12);
    // prompts
    const d0 = s.cueEnd(0) - s.cue(0);
    const pa = 1 - E.inOut(seg(t, c1 - 0.2, c1 + 0.4));
    if (pa > 0) {
      scrim(ctx, 'left', 0.85 * pa, 0.55);
      kicker(ctx, 'GIVE ACTIONS, NOT POSES', 120, 300, t - 0.1, { alpha: pa });
      ['往前走，然后回头看', '把头发别到耳后', '想一件好笑的事'].forEach((str, i) => {
        const ta = t - (i * d0 / 3 + 0.1);
        text(ctx, `0${i + 1}`, 120, 410 + i * 110, { size: 34, font: F.latin, italic: true, color: C.gold, alpha: E.out(seg(ta, 0, 0.5)) * pa });
        reveal(ctx, str, 200, 410 + i * 110, ta, { size: 54, font: F.serif, weight: 700, alpha: pa, stagger: 0.035, shadow: 'rgba(0,0,0,0.6)' });
      });
    }
    // burst + eye AF
    const ba = E.out(seg(t, c1, c1 + 0.4)) * (1 - E.inOut(seg(t, c2 - 0.2, c2 + 0.4)));
    if (ba > 0) {
      const [ex, ey] = m.map(0.475, 0.27);
      viewfinder(ctx, t, { alpha: ba, af: [ex + Math.sin(t * 3) * 4, ey], afSize: 70, lock: seg(t, c1 + 0.2, c1 + 0.6), info: ['AF-C', '眼部追踪', '连拍 20 fps', 'ƒ1.4'] });
      const shots = 6, t0 = c1 + 0.9;
      for (let k = 0; k < shots; k++) {
        const ta = t - (t0 + k * 0.16);
        const a = E.out(seg(ta, 0, 0.3)) * ba; if (a <= 0) continue;
        const fw = 230, fh = 150, gap = 18, x = W / 2 - (shots * (fw + gap) - gap) / 2 + k * (fw + gap), y = 700;
        const star = k === 3;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 30);
        ctx.save(); rrect(ctx, x, y, fw, fh, 8); ctx.clip();
        ctx.filter = star ? 'none' : 'brightness(0.75) saturate(0.8)';
        cover(ctx, im, x, y, fw, fh, 1.6 + k * 0.04, 0.3 + k * 0.05, 0.15 + (k % 2) * 0.04); ctx.restore();
        ctx.strokeStyle = star ? C.goldHi : 'rgba(255,255,255,0.35)'; ctx.lineWidth = star ? 3 : 1.2;
        if (star) { ctx.shadowColor = C.gold; ctx.shadowBlur = 18; }
        rrect(ctx, x, y, fw, fh, 8); ctx.stroke(); ctx.restore();
        if (star) pill(ctx, '★ 最自然的一张', x + fw / 2, y - 34, E.out(seg(t, t0 + 1.6, t0 + 2.2)) * ba, { size: 22, align: 'center', color: '#1b1410', fill: 'rgba(255,220,170,0.95)' });
      }
      shade(ctx, 0.5 * Math.max(0, 1 - Math.abs(((t - t0) % 0.16) - 0.0) / 0.04) * (t > t0 && t < t0 + 0.96 ? 1 : 0));
    }
    // show her the shot
    const la = E.out(seg(t, c2, c2 + 0.6));
    if (la > 0) {
      scrim(ctx, 'right', 0.8 * la, 0.5);
      const x = W - 640, y = 260, w = 480, h = 320;
      ctx.save(); ctx.globalAlpha = la; ctx.translate((1 - la) * 60, 0);
      rrect(ctx, x - 24, y - 24, w + 48, h + 90, 26); ctx.fillStyle = '#141110'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
      ctx.save(); rrect(ctx, x, y, w, h, 8); ctx.clip(); cover(ctx, s.img('hero'), x, y, w, h, 1.1, 0.5, 0.35); ctx.restore();
      text(ctx, '1/1000   ƒ1.2   ISO100', x, y + h + 44, { size: 20, font: F.ui, color: C.dim });
      ctx.restore();
      const ha = E.back(seg(t, c2 + 1.2, c2 + 1.7));
      if (ha > 0) pill(ctx, '“这张好好看！” ♥', x + w - 20, y - 70, ha, { size: 30, align: 'right', color: '#1b1410', fill: 'rgba(255,214,200,0.96)' });
    }
  };

  // ============================================================ RECAP
  S.recap = (ctx, s) => {
    const { t, W, H, params: P } = s;
    const im = s.img('hero');
    ctx.drawImage(blurred('hero', im, 14), 0, 0, W, H);
    shade(ctx, 0.66);
    backdrop && null;
    kicker(ctx, 'RECAP', 140, 360, t - 0.1);
    reveal(ctx, '记住', 140, 470, t - 0.2, { size: 92, font: F.serif, weight: 700 });
    reveal(ctx, '这七件事', 140, 580, t - 0.35, { size: 92, font: F.serif, weight: 700, color: C.goldHi });
    text(ctx, '50mm  ƒ/1.2  ·  PORTRAIT NOTES', 140, 650, { size: 22, font: F.ui, spacing: 3, color: C.dim, alpha: E.out(seg(t, 0.8, 1.5)) });
    const x = 760;
    P.items.forEach(([a, b], i) => {
      const t0 = s.cue(i + 1), ta = t - t0 + 0.15;
      const ap = E.out(seg(ta, 0, 0.5)); if (ap <= 0) return;
      const active = t >= t0 - 0.15 && t < s.cue(i + 2) - 0.15;
      const y = 175 + i * 112;
      ctx.save(); ctx.globalAlpha = ap; ctx.translate((1 - ap) * 40, 0);
      if (active) { const g = ctx.createLinearGradient(x - 30, 0, x + 1000, 0); g.addColorStop(0, 'rgba(232,184,120,0.18)'); g.addColorStop(1, 'rgba(232,184,120,0)'); ctx.fillStyle = g; ctx.fillRect(x - 30, y - 62, 1050, 92); ctx.fillStyle = C.goldHi; ctx.fillRect(x - 30, y - 62, 3, 92); }
      text(ctx, `0${i + 1}`, x, y, { size: 34, font: F.latin, italic: true, color: C.gold });
      text(ctx, a, x + 90, y, { size: 46, font: F.serif, weight: 700, color: active ? C.goldHi : C.ink });
      const aw = measure(ctx, a, { size: 46, font: F.serif, weight: 700 });
      line(ctx, x + 110 + aw, y - 15, x + 170 + aw, y - 15, 1, { color: C.dim });
      arrowHead(ctx, x + 172 + aw, y - 15, 0, 9, C.dim);
      text(ctx, b, x + 200 + aw, y, { size: 34, color: active ? C.ink : C.dim });
      ctx.restore();
    });
  };

  // ============================================================ OUTRO
  S.outro = (ctx, s) => {
    const { t, W, H } = s;
    kenburns(ctx, s.img('hero'), t / s.d, [1.0, 0.5, 0.4, 1.12, 0.5, 0.32]);
    grade(ctx, 0.16);
    scrim(ctx, 'bottom', 0.92, 0.6);
    const c1 = s.cue(1), e1 = s.cueEnd(1);
    reveal(ctx, '器材决定下限。', W / 2, H - 330, t - s.cue(0), { size: 64, font: F.serif, weight: 600, align: 'center', out: c1 - 0.3, color: C.ink, shadow: 'rgba(0,0,0,0.7)' });
    reveal(ctx, '细节，决定她会不会对你说：', W / 2, H - 360, t - c1, { size: 48, font: F.serif, weight: 500, align: 'center', color: C.dim, shadow: 'rgba(0,0,0,0.7)' });
    const g = ctx.createLinearGradient(0, H - 300, 0, H - 200); g.addColorStop(0, '#fff3e0'); g.addColorStop(1, '#e8b878');
    reveal(ctx, '“这张，我要发朋友圈。”', W / 2, H - 230, t - c1 - 1.6, { size: 84, font: F.serif, weight: 700, align: 'center', gradient: g, stagger: 0.06, dur: 1.0, shadow: 'rgba(0,0,0,0.6)', shadowBlur: 30 });
    const ea = E.out(seg(t, e1 + 0.5, e1 + 1.5));
    text(ctx, 'PORTRAIT NOTES  ·  50mm ƒ/1.2', W / 2, H - 110, { size: 22, font: F.ui, weight: 600, spacing: 6, align: 'center', color: C.gold, alpha: ea });
  };
})();
