// Constellation cursor trail: a dense field of stars behind the stage. Stars near the cursor glow,
// and the glow lingers behind it as it moves on. Moving the cursor (or a horizontal finger drag)
// also captures the stars it passes, in order, and joins them with lines that draw themselves on.
// Resting for ~1.2 s completes the constellation: a soft pulse, then a slow fade.
//
// Two layers: twinkling stars (drawn every frame) over a static dust of faint points (drawn once per
// resize or theme change, then copied).

import { SpatialGrid } from './SpatialGrid.js';

const STAR_CELL = 34; // jittered-grid cell for the twinkling stars (px)
const STAR_KEEP = 0.66; // share of cells that hold a star
const DUST_PER_MPX = 1700; // static dust points per million px²
const GLOW_RADIUS = 150; // px around the cursor in which stars glow
const GLOW_DECAY = 2.2; // 1/s: how long the glow lingers behind the cursor
const CAPTURE_RADIUS = 38; // px from the cursor path
const MIN_GAP = 46; // px between consecutive captured stars
const MAX_STARS = 12;
const REST_MS = 1200;
const DRAW_MS = 250;
const PULSE_MS = 600;
const HOLD_MS = 400;
const FADE_MS = 3500;
const MAX_VISIBLE = 3;
const MASK_PAD = 10;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColor(css, fallback = 0xebd88c) {
  const m = String(css).trim().match(/^#([0-9a-f]{6})$/i);
  const n = m ? parseInt(m[1], 16) : fallback;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class ConstellationField {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {object} o.theme             { color, glow, additive }: hex colours from the design tokens;
   *                                     additive glow on dark grounds, painted glow on light ones
   * @param {boolean} o.reducedMotion    lines appear without drawing on; no twinkle
   * @param {(x:number,y:number)=>boolean} [o.covers]  true where the statue hides the sky
   * @param {string} [o.maskSelector]    text blocks the sky must stay clear of
   */
  constructor({ canvas, theme, reducedMotion, covers = () => false, maskSelector = '[data-mask], .topbar' }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reducedMotion = reducedMotion;
    this.covers = covers;
    this.maskSelector = maskSelector;
    this.grid = new SpatialGrid(64);
    this.stars = [];
    this.constellations = [];
    this.active = null;
    this.last = null; // last pointer sample { x, y }
    this.lastMove = 0;
    this.pointer = null; // current pointer position for the glow
    this.touch = null;
    this.maskRects = [];
    this.running = false;
    this.suspended = false; // true while the statue is being turned: no new constellations
    this.raf = 0;
    this.dust = document.createElement('canvas');

    this._frame = this._frame.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._resize = this._resize.bind(this);
    this.setTheme(theme);
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerdown', this._onDown, { passive: true });
    window.addEventListener('pointerup', this._onUp, { passive: true });
    window.addEventListener('pointercancel', this._onUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', this._onLeave, { passive: true });
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(canvas);
    this._resize();
  }

  /** Colours for the current theme. */
  setTheme({ color, glow = color, additive = true }) {
    this.rgb = parseColor(color);
    this.glowRgb = parseColor(glow);
    this.additive = additive;
    this.glow = this._makeGlow();
    if (this.w) this._paintDust();
  }

  _makeGlow() {
    const s = 64;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const [r, gg, b] = this.glowRgb;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.18, `rgba(${r},${gg},${b},0.5)`);
    grad.addColorStop(0.45, `rgba(${r},${gg},${b},0.14)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this._seed();
    this._paintDust();
    this.constellations = [];
    this.active = null;
    this.dirty = true;
  }

  // jittered grid: evenly spread, never clumped
  _seed() {
    const rand = mulberry32(1914);
    const cell = STAR_CELL;
    this.stars = [];
    for (let y = 0; y < this.h; y += cell) {
      for (let x = 0; x < this.w; x += cell) {
        if (rand() > STAR_KEEP) continue;
        const bright = rand() < 0.07;
        this.stars.push({
          x: x + 4 + rand() * (cell - 8),
          y: y + 4 + rand() * (cell - 8),
          r: bright ? 1.25 + rand() * 0.45 : 0.5 + rand() * 0.55,
          base: bright ? 0.55 + rand() * 0.2 : 0.14 + rand() * 0.3,
          speed: 0.4 + rand() * 1.1,
          phase: rand() * Math.PI * 2,
          boost: 0,
          lit: 0,
        });
      }
    }
    this.grid.build(this.stars, this.w, this.h);
  }

  // faint static points between the stars: depth for free (one copy per frame)
  _paintDust() {
    const rand = mulberry32(1606);
    const d = this.dust;
    d.width = Math.round(this.w * this.dpr);
    d.height = Math.round(this.h * this.dpr);
    const ctx = d.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [r, g, b] = this.rgb;
    const n = Math.round((this.w * this.h * DUST_PER_MPX) / 1e6);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.06 + rand() * 0.16).toFixed(3)})`;
      const s = 0.6 + rand() * 0.7;
      ctx.fillRect(rand() * this.w, rand() * this.h, s, s);
    }
  }

  // ---- input ----

  _onDown(e) {
    if (e.pointerType !== 'touch') return;
    // a drag that starts on the statue turns the statue instead (src/scene/interaction.js)
    const onStatue = this.covers(e.clientX, e.clientY);
    this.touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: onStatue ? 'statue' : null };
    this.last = null;
  }

  _onUp(e) {
    if (this.touch && e.pointerId === this.touch.id) {
      this.touch = null;
      this.last = null;
      this.pointer = null;
    }
  }

  _onLeave() {
    this.last = null;
    this.pointer = null;
  }

  _onMove(e) {
    if (!this.running) return;
    if (e.pointerType === 'touch') {
      const t = this.touch;
      if (!t || t.id !== e.pointerId) return;
      if (!t.mode) {
        const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) t.mode = 'draw';
        else if (Math.abs(dy) > 8) t.mode = 'scroll';
        else return;
      }
      if (t.mode !== 'draw') return;
    }
    const now = performance.now();
    // coalesced events give a smoother path on fast moves
    const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (samples && samples.length > 1) for (const s of samples) this._feed(s.clientX, s.clientY, now);
    else this._feed(e.clientX, e.clientY, now);
  }

  _feed(x, y, now) {
    this.pointer = { x, y };
    this.lastMove = now;
    const prev = this.last;
    this.last = { x, y };
    if (!prev || this.suspended) return;
    const dx = x - prev.x, dy = y - prev.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.5) return;
    const R = CAPTURE_RADIUS;
    const hits = [];
    this.grid.query(Math.min(prev.x, x) - R, Math.min(prev.y, y) - R, Math.max(prev.x, x) + R, Math.max(prev.y, y) + R, (s) => {
      const t = Math.max(0, Math.min(1, ((s.x - prev.x) * dx + (s.y - prev.y) * dy) / len2));
      const px = prev.x + dx * t - s.x, py = prev.y + dy * t - s.y;
      const d2 = px * px + py * py;
      if (d2 <= R * R) hits.push({ s, t, d2 });
    });
    if (!hits.length) return;
    hits.sort((a, b) => a.t - b.t || a.d2 - b.d2);
    for (const h of hits) this._capture(h.s, now);
  }

  _blocked(s) {
    if (this.covers(s.x, s.y)) return true;
    for (const r of this.maskRects) if (s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h) return true;
    return false;
  }

  _capture(star, now) {
    if (this._blocked(star)) return;
    let c = this.active;
    if (c && c.stars.includes(star)) return;
    if (c && c.stars.length) {
      const p = c.stars[c.stars.length - 1];
      if (Math.hypot(star.x - p.x, star.y - p.y) < MIN_GAP) return;
    }
    if (!c) {
      c = { stars: [], segs: [], state: 'active', doneAt: 0, fadeAt: 0, fadeMs: FADE_MS, alpha: 1 };
      this.active = c;
      this.constellations.push(c);
      this._limitVisible(now);
    }
    if (c.stars.length) {
      // queue the line after the previous one so a fast sweep still draws in order
      const prevSeg = c.segs[c.segs.length - 1];
      const t0 = prevSeg ? Math.max(now, prevSeg.t0 + DRAW_MS * 0.6) : now;
      c.segs.push({ a: c.stars[c.stars.length - 1], b: star, t0 });
    }
    c.stars.push(star);
    star.lit = 1;
    if (c.stars.length >= MAX_STARS) this._complete(c, now);
  }

  _complete(c, now) {
    if (c.state !== 'active') return;
    if (this.active === c) this.active = null;
    if (c.stars.length < 2) {
      c.state = 'fading';
      c.fadeAt = now;
      c.fadeMs = 600;
      return;
    }
    c.state = 'done';
    c.doneAt = now;
    c.fadeAt = now + (this.reducedMotion ? HOLD_MS : PULSE_MS + HOLD_MS);
  }

  _limitVisible(now) {
    const live = this.constellations.filter((c) => c.state !== 'fading');
    let excess = this.constellations.length - MAX_VISIBLE;
    for (const c of live) {
      if (excess <= 0) break;
      if (c === this.active) continue;
      c.state = 'fading';
      c.fadeAt = Math.min(c.fadeAt || now, now);
      c.fadeMs = 1200;
      excess--;
    }
  }

  // ---- loop ----

  _collectMasks() {
    const rects = [];
    for (const el of document.querySelectorAll(this.maskSelector)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -MASK_PAD || r.top > this.h + MASK_PAD || r.width === 0) continue;
      rects.push({ x: r.left - MASK_PAD, y: r.top - MASK_PAD, w: r.width + MASK_PAD * 2, h: r.height + MASK_PAD * 2 });
    }
    this.maskRects = rects;
  }

  _frame(now) {
    this.raf = requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, (now - (this.prevNow || now)) / 1000);
    this.prevNow = now;
    this._collectMasks();

    if (this.active && now - this.lastMove > REST_MS) this._complete(this.active, now);

    // constellation alpha over time
    for (const c of this.constellations) {
      if (c.state === 'active') c.alpha = 1;
      else if (now < c.fadeAt) {
        const p = (now - c.doneAt) / PULSE_MS;
        c.alpha = c.state === 'done' && !this.reducedMotion && p < 1 ? 1 + 0.6 * Math.sin(Math.PI * p) : 1;
      } else {
        const f = (now - c.fadeAt) / c.fadeMs;
        c.alpha = Math.max(0, 1 - f * f * (3 - 2 * f));
        c.state = 'fading';
      }
    }
    this.constellations = this.constellations.filter((c) => c.alpha > 0.001 || c.state === 'active');

    // glow around the cursor; it decays, so it trails behind a moving cursor
    const p = this.pointer;
    const decay = Math.exp(-dt * GLOW_DECAY);
    for (const s of this.stars) {
      s.boost *= decay;
      s.lit = 0;
    }
    if (p) {
      const R = GLOW_RADIUS;
      this.grid.query(p.x - R, p.y - R, p.x + R, p.y + R, (s) => {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d >= R) return;
        const k = 1 - d / R;
        s.boost = Math.max(s.boost, k * k * (3 - 2 * k)); // smooth falloff
      });
    }
    for (const c of this.constellations) for (const s of c.stars) s.lit = Math.max(s.lit, Math.min(1, c.alpha));

    this._draw(now);
  }

  _draw(now) {
    const ctx = this.ctx;
    const [r, g, b] = this.rgb;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.dust, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // stars
    const t = now / 1000;
    const glowing = [];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    for (const s of this.stars) {
      const tw = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(t * s.speed + s.phase);
      const a = Math.min(1, s.base * tw + s.boost * 0.85 + s.lit * 0.55);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 + 0.9 * s.boost) + s.lit * 0.5, 0, Math.PI * 2);
      ctx.fill();
      if (s.boost > 0.03 || s.lit > 0.03) glowing.push(s);
    }

    // glow: one pass, additive on the dark stage so overlapping halos bloom
    if (glowing.length) {
      ctx.globalCompositeOperation = this.additive ? 'lighter' : 'source-over';
      for (const s of glowing) {
        const k = Math.max(s.boost, s.lit * 0.8);
        const size = (14 + s.r * 12) * (0.7 + 1.1 * k);
        ctx.globalAlpha = Math.min(1, k * (this.additive ? 0.9 : 0.55));
        ctx.drawImage(this.glow, s.x - size / 2, s.y - size / 2, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // lines
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    for (const c of this.constellations) {
      for (const seg of c.segs) {
        const raw = this.reducedMotion ? 1 : Math.max(0, Math.min(1, (now - seg.t0) / DRAW_MS));
        if (raw <= 0) continue;
        const k = easeOutCubic(raw);
        ctx.globalAlpha = Math.min(1, 0.55 * c.alpha);
        ctx.beginPath();
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.a.x + (seg.b.x - seg.a.x) * k, seg.a.y + (seg.b.y - seg.a.y) * k);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // keep the sky clear of text: erase under every text block
    for (const m of this.maskRects) ctx.clearRect(m.x, m.y, m.w, m.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.prevNow = 0;
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.last = null;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    document.documentElement.removeEventListener('pointerleave', this._onLeave);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dust.width = this.dust.height = 0;
  }
}
