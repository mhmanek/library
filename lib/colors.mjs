// Cover colours for the mats, spines and inks. sharp's dominant colour gave near-white for 4 of 12 of his covers
// (the white background wins), so this scores colorthief's OKLCH palette instead: proportion matters, but
// near-white and near-black are discounted and chroma is rewarded. Colours are computed once per source URL and
// cached in data/covers.json, so decoder differences between Windows and Linux can never churn commits.
// Raw colours only: the site build harmonises spines toward bookcloth itself (CONTRACT).
import sharp from 'sharp';
import {getPalette} from 'colorthief';
import {hexToOklch, oklchToHex, rgbToHex, bestInk, deltaE, clamp} from './color-math.mjs';

export const GILT = '#d9b45a';
const BOOKCLOTH = ['#6b2737', '#23443a', '#1e2f5c', '#8a3f24', '#4b2e4f', '#3c4a5a', '#a07b4f', '#2f4f4f'];

const clampL = (hex, lo, hi) => {
  const c = hexToOklch(hex);
  return c.l >= lo && c.l <= hi ? hex : oklchToHex({...c, l: clamp(c.l, lo, hi)});
};
const swatch = col => { const hex = col.hex().toLowerCase(); const o = hexToOklch(hex); return {hex, l: o.l, c: o.c, p: col.proportion ?? 0}; };

// Exported for tests: the scoring that turns palettes into {bg, spine, accent, ink, bgInk}.
export function pickColors(full, strip) {
  const weight = s => ((s.l > 0.92 && s.c < 0.05) || s.l < 0.16 ? 0.35 : 1);
  const score = s => s.p ** 0.7 * weight(s) * (1 + 1.5 * Math.min(s.c, 0.25));
  const eligible = full.filter(s => s.p >= 0.04);
  const pool = eligible.length ? eligible : full;
  const bgSw = [...pool].sort((a, b) => score(b) - score(a) || b.p - a.p || (a.hex < b.hex ? -1 : 1))[0];
  const bg = clampL(bgSw.hex, 0.24, 0.86);
  const spineSw = [...(strip.length ? strip : full)].sort((a, b) => b.p - a.p || (a.hex < b.hex ? -1 : 1))[0];
  const spine = clampL(spineSw.hex, 0.14, 0.92);
  const accents = full.filter(s => s.p >= 0.02 && s.l >= 0.3 && s.l <= 0.9 && s.c >= 0.07 && deltaE(s.hex, bg) >= 0.08)
    .sort((a, b) => b.c * b.p ** 0.25 - a.c * a.p ** 0.25 || (a.hex < b.hex ? -1 : 1));
  const accent = accents[0]?.hex ?? GILT;
  return {bg, spine, accent, ink: bestInk(spine), bgInk: bestInk(bg)};
}

export async function extractColors(buf) {
  const png = await sharp(buf, {failOn: 'none'}).rotate().flatten({background: '#ffffff'}).resize({width: 100}).png().toBuffer();
  try {
    const opts = {quality: 1, colorSpace: 'oklch', ignoreWhite: false};
    // The 4% inset skips scanned borders; the strip is the left 12%, where a spine would be.
    const full = (await getPalette(png, {...opts, colorCount: 8, region: {x: 0.04, y: 0.04, width: 0.92, height: 0.92}})) ?? [];
    const strip = (await getPalette(png, {...opts, colorCount: 4, region: {x: 0, y: 0.02, width: 0.12, height: 0.96}})) ?? [];
    if (!full.length) throw new Error('empty palette');
    return pickColors(full.map(swatch), strip.map(swatch));
  } catch {
    const {channels} = await sharp(png).stats();
    const mean = rgbToHex(channels.slice(0, 3).map(c => c.mean));
    const bg = clampL(mean, 0.24, 0.86), spine = clampL(mean, 0.14, 0.92);
    return {bg, spine, accent: GILT, ink: bestInk(spine), bgInk: bestInk(bg)};
  }
}

const fnv1a = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

// Typographic placeholders get a stable bookcloth colour from their id.
export function placeholderColors(seed) {
  const bg = BOOKCLOTH[fnv1a(seed) % BOOKCLOTH.length];
  return {bg, spine: bg, accent: GILT, ink: bestInk(bg), bgInk: bestInk(bg)};
}
