// Spine colours: each cover's colour pulled toward six bookcloth hues and darkened, so the shelf reads as a
// gilt library rather than a rainbow, and gold-foil titles always pass 4.6:1. Same spines in both themes,
// because cloth doesn't change with daylight.
import {hexToOklch, oklabToRgb, rgbToHex, contrast, clamp} from '../../lib/color-math.mjs';
import {GOLD} from '../design/tokens.mjs';

export const CLOTH = [262, 25, 150, 75, 320, 200]; // navy, oxblood, forest, ochre, plum, teal
export const MIN_GOLD_CONTRAST = 4.6;
const FALLBACK = '#22386b';

const hueDelta = (from, to) => ((to - from + 540) % 360) - 180;

function inGamut(l, c, h) {
  const rad = h * Math.PI / 180;
  return oklabToRgb([l, c * Math.cos(rad), c * Math.sin(rad)]).every(v => v >= -0.5 && v <= 255.5);
}
function toHex(l, c, h) {
  const rad = h * Math.PI / 180;
  return rgbToHex(oklabToRgb([l, c * Math.cos(rad), c * Math.sin(rad)]));
}

// Returns {l, c, h, hex}. `unread` (the antilibrary) is a dimmer, greyer cloth, never lighter than read.
export function harmonise(input, {unread = false} = {}) {
  let src;
  try { src = hexToOklch(input || FALLBACK); } catch { src = hexToOklch(FALLBACK); }
  let {h, c} = src;
  if (c < 0.03) { c = 0.014; h = 262; }
  else {
    const anchor = CLOTH.reduce((best, a) => (Math.abs(hueDelta(h, a)) < Math.abs(hueDelta(h, best)) ? a : best));
    h = (h + 0.35 * hueDelta(h, anchor) + 360) % 360;
    c = clamp(c * 0.6, 0.03, 0.085);
  }
  let l = 0.25 + 0.15 * src.l;
  const settle = () => {
    while (c > 0 && !inGamut(l, c, h)) c = Math.max(0, c - 0.002);
    while (contrast(GOLD, toHex(l, c, h)) < MIN_GOLD_CONTRAST && l > 0.05) l -= 0.01;
  };
  settle();
  if (unread) { c *= 0.7; l -= 0.02; settle(); }
  return {l, c, h, hex: toHex(l, c, h)};
}

// Colour sort key: hue for chromatic covers, 400 + lightness for neutrals so greys and whites cluster last.
export function hueKey(hex) {
  try {
    const {l, c, h} = hexToOklch(hex);
    return c < 0.03 ? 400 + Math.round(l * 100) : Math.round(h) % 360;
  } catch { return 500; }
}
