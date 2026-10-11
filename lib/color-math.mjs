// Colour maths shared by cover colour extraction (lib/colors.mjs) and spine harmonisation (src/build/colour.mjs).
// OKLab/OKLCH per Björn Ottosson; WCAG 2.x relative luminance and contrast.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

const toLinear = c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = l => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(fromLinear);
}

// OKLCH as {l, c, h} with h in degrees [0, 360).
export function hexToOklch(hex) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return {l: L, c: Math.hypot(a, b), h};
}

// Converts back to sRGB, reducing chroma until the colour is in gamut so hue and lightness are kept.
export function oklchToHex({l, c, h}) {
  const rad = h * Math.PI / 180;
  let chroma = Math.max(0, c);
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToRgb([l, chroma * Math.cos(rad), chroma * Math.sin(rad)]);
    if (rgb.every(v => v >= -0.5 && v <= 255.5) || chroma < 1e-4) return rgbToHex(rgb);
    chroma *= 0.85;
  }
  return rgbToHex(oklabToRgb([l, 0, 0]));
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Perceptual distance in OKLab (ΔE_ok).
export function deltaE(hexA, hexB) {
  const [a, b] = [rgbToOklab(hexToRgb(hexA)), rgbToOklab(hexToRgb(hexB))];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// The ink with the higher contrast against `bg`.
export const bestInk = (bg, inks = ['#1d1a15', '#f1e7d2']) => inks.reduce((best, ink) => (contrast(ink, bg) > contrast(best, bg) ? ink : best));
