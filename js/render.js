// Draws one frame of the Ayah video on a canvas: background, surah header, the ayah (paged
// when long), the tafsir/translation under it, and the reciter/source line. The Quran text is
// only laid out (wrapped between words), never changed.
import { arabicNumber, letters, surahName } from "./quran.js";

export const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
export const QURAN_FONT = "Amiri Quran";
export const TEXT_FONT_AR = "Noto Naskh Arabic";
export const TEXT_FONT_LATIN = "Noto Sans";
const FADE = 0.25;
const GOLD = "#e8c860";

function wrap(ctx, words, maxWidth) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const test = [...cur, w].join(" ");
    if (cur.length && ctx.measureText(test).width > maxWidth) {
      lines.push(cur);
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Split lines into about-equal pages of at most maxLines lines each. */
function paginate(lines, maxLines) {
  const n = Math.max(1, Math.ceil(lines.length / maxLines));
  const pages = [];
  for (let i = 0; i < n; i++) pages.push(lines.slice(Math.round((i * lines.length) / n), Math.round(((i + 1) * lines.length) / n)));
  return pages;
}

export class Renderer {
  /** opts: aspect, scale (ayah text size), showReciter, reciterName, sourceLine, underDir,
   *  background: {type: "gradient"|"image", image, dim}, logo (HTMLImageElement|null) */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    const [w, h] = SIZES[opts.aspect];
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext("2d");
    this.w = w;
    this.h = h;
    this.portrait = h > w;
    this.square = h === w;
  }

  /** scenes: [{ayah, text, under, start, duration, surah}] -> computes the pages of each scene. */
  prepare(scenes, surah) {
    const { ctx, w, h, portrait, square } = this;
    this.scenes = scenes;
    this.surah = surah;
    this.total = scenes.length ? scenes[scenes.length - 1].start + scenes[scenes.length - 1].duration : 0;
    const hasUnder = scenes.some((s) => s.under);
    const base = w * (portrait ? 0.074 : square ? 0.06 : 0.04) * (this.opts.scale || 1);
    const maxW = w * (portrait ? 0.84 : 0.8);
    const ayahLines = hasUnder ? (portrait ? 4 : 3) : portrait ? 6 : square ? 5 : 4;
    const underSize = w * (portrait ? 0.038 : square ? 0.032 : 0.022);
    const underLines = portrait ? 7 : square ? 5 : 4;
    const underFont = this.opts.underDir === "ltr" ? TEXT_FONT_LATIN : TEXT_FONT_AR;
    this.layout = { base, maxW, underSize, underFont, hasUnder };

    for (const sc of scenes) {
      const words = sc.text.split(/\s+/).filter(Boolean);
      if (sc.ayah) words.push(`﴿${arabicNumber(sc.ayah)}﴾`);
      // try a slightly smaller size before splitting the ayah over several screens
      let size = base;
      let lines;
      for (;;) {
        ctx.font = `${size}px "${QURAN_FONT}"`;
        lines = wrap(ctx, words, maxW);
        if (lines.length <= ayahLines || size <= base * 0.78) break;
        size *= 0.94;
      }
      const pages = paginate(lines, ayahLines);
      const sizes = pages.map((p) => Math.max(1, letters(p.flat().join(" "))));
      const sum = sizes.reduce((a, b) => a + b, 0);
      let t = sc.start;
      sc.pages = pages.map((p, i) => {
        const d = (sc.duration * sizes[i]) / sum;
        const page = { lines: p.map((l) => l.join(" ")), size, start: t, end: t + d };
        t += d;
        return page;
      });
      sc.underPages = [];
      if (sc.under) {
        ctx.font = `${underSize}px "${underFont}"`;
        const up = paginate(wrap(ctx, sc.under.split(/\s+/), maxW), underLines);
        sc.underPages = up.map((p, i) => ({
          lines: p.map((l) => l.join(" ")),
          start: sc.start + (sc.duration * i) / up.length,
          end: sc.start + (sc.duration * (i + 1)) / up.length,
        }));
      }
    }
  }

  background(t) {
    const { ctx, w, h } = this;
    const bg = this.opts.background || { type: "gradient" };
    if (bg.type === "image" && bg.image) {
      const img = bg.image;
      const scale = Math.max(w / img.width, h / img.height) * 1.12;
      const iw = img.width * scale;
      const ih = img.height * scale;
      const p = this.total ? (t / this.total) : 0;   // one slow pan over the whole video
      ctx.drawImage(img, (w - iw) * p, (h - ih) / 2, iw, ih);
      ctx.fillStyle = `rgba(0,0,0,${bg.dim ?? 0.45})`;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    // a calm, slowly turning gradient of night blue, deep green and dusk violet
    const a = t * 0.05;
    const cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, "#08182b");
    g.addColorStop(0.5, "#0d3a2e");
    g.addColorStop(1, "#1a1530");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(cx + Math.sin(t * 0.07) * w * 0.25, cy * 0.8, 0, cx, cy, r);
    glow.addColorStop(0, "rgba(232,200,96,0.10)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const vig = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  text(lines, font, size, lineH, centerY, color, dir, alpha, shadow = true) {
    const { ctx, w } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px "${font}"`;
    ctx.direction = dir;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
    }
    const top = centerY - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineH));
    ctx.restore();
  }

  static fade(t, a, b) {
    return Math.max(0, Math.min(1, (t - a) / FADE, (b - t) / FADE));
  }

  draw(t) {
    const { ctx, w, h, portrait } = this;
    this.background(t);
    if (!this.scenes || !this.scenes.length) return;
    const sc = this.scenes.find((s) => t >= s.start && t < s.start + s.duration) || this.scenes[this.scenes.length - 1];
    const L = this.layout;

    // surah header
    const head = `سورة ${surahName(this.surah)}` + (sc.ayah ? ` ﴿${arabicNumber(sc.ayah)}﴾` : "");
    this.text([head], QURAN_FONT, w * (portrait ? 0.05 : 0.03), 0, h * (portrait ? 0.1 : 0.08), GOLD, "rtl", 1);

    const page = sc.pages.find((p) => t >= p.start && t < p.end) || sc.pages[sc.pages.length - 1];
    const under = sc.underPages.find((p) => t >= p.start && t < p.end) || sc.underPages[sc.underPages.length - 1];
    const ayahLineH = page.size * 1.85;
    const ayahH = page.lines.length * ayahLineH;
    const underLineH = L.underSize * 1.6;
    const underH = under ? under.lines.length * underLineH : 0;
    const gap = under ? h * 0.035 : 0;
    const blockTop = h * (portrait ? 0.48 : 0.5) - (ayahH + gap + underH) / 2;
    this.text(page.lines, QURAN_FONT, page.size, ayahLineH, blockTop + ayahH / 2, "#ffffff", "rtl",
      Renderer.fade(t, page.start, page.end + (page === sc.pages[sc.pages.length - 1] ? 0.01 : 0)));
    if (under)
      this.text(under.lines, L.underFont, L.underSize, underLineH, blockTop + ayahH + gap + underH / 2, "#e8e8e8",
        this.opts.underDir || "rtl", Renderer.fade(t, under.start, under.end));

    // reciter and source at the bottom
    const foot = [];
    if (this.opts.showReciter && this.opts.reciterName) foot.push(`بصوت القارئ ${this.opts.reciterName}`);
    if (this.opts.sourceLine) foot.push(this.opts.sourceLine);
    if (foot.length) {
      const fs = w * (portrait ? 0.026 : 0.016);
      this.text(foot, TEXT_FONT_AR, fs, fs * 1.5, h * (portrait ? 0.9 : 0.92), "rgba(235,235,235,0.85)", "rtl", 1);
    }
    if (this.opts.logo) {
      const lw = w * 0.13;
      const lh = (lw * this.opts.logo.height) / this.opts.logo.width;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(this.opts.logo, w - lw - w * 0.04, w * 0.04, lw, lh);
      ctx.globalAlpha = 1;
    }
    // fade out at the very end
    if (this.total && t > this.total - 0.6) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - (this.total - 0.6)) / 0.6)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
