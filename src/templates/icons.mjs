// Inline SVG sprite. Glyphs missing from the latin font subsets (→ ↗ ⟩ ⊕) are drawn here instead.
import {html, raw} from './html.mjs';

const SYMBOLS = {
  arrow: '<path d="M2 8h11M9 4l4 4-4 4"/>',
  ext: '<path d="M5 11 11 5M6.5 5H11v4.5"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  prev: '<path d="M10 3 5 8l5 5"/>',
  next: '<path d="M6 3l5 5-5 5"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  ket: '<path d="M1 1l4 7-4 7"/>',
  curl: '<path d="M2 14c3-1 5-4 4-7S2 4 3 7s6 4 10 0M10.5 4.5 13 7l-3 1"/>',
  turn: '<path d="M2.5 7A5.5 5.5 0 0 1 12.6 4.4M13 1.5v3h-3M13.5 9a5.5 5.5 0 0 1-10.1 2.6M3 14.5v-3h3"/>',
  squiggle: '<path d="M1 5c2-3 3 3 5 0s3 3 5 0 3 3 5 0 3 3 5 0"/>',
};
const VIEW = {ket: '0 0 6 16', squiggle: '0 0 22 8'};

export const sprite = () => raw(`<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true" focusable="false"><defs>${Object.entries(SYMBOLS)
  .map(([k, d]) => `<symbol id="i-${k}" viewBox="${VIEW[k] ?? '0 0 16 16'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`).join('')}</defs></svg>`);

export const icon = (name, cls = '') => html`<svg class="i i-${name}${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
