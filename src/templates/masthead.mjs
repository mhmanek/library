// Masthead: the two-wire circuit wordmark.
import {html} from './html.mjs';
import {icon} from './icons.mjs';

const ket = label => html`<span class="ket">|${label}${icon('ket', 'ket-a')}</span>`;
const tiles = (letters, start) => [...letters].map((ch, i) => html`<span class="tile" style="--i:${i + start}">${ch}</span>`);

// Two wires with identical slot widths so the CNOT's control and target line up:
//   |0⟩ ─ M A L H A R ’ S ──●──── ○
//   |0⟩ ─ L I B R A R Y ────⊕──── ○
export function circuit(label = '0') {
  return html`<span class="circuit" aria-hidden="true">
<span class="wire w1">${ket(label)}${tiles('MALHAR', 0)}<span class="apos">’</span>${tiles('S', 6)}<span class="wa"></span><span class="cx"><span class="ctrl"></span></span><span class="wb"></span><span class="node"></span></span>
<span class="wire w2">${ket(label)}${tiles('LIBRAR', 7)}<span class="apos"></span>${tiles('Y', 13)}<span class="wa"></span><span class="cx"><span class="target"></span></span><span class="wb"></span><span class="node n2"></span></span>
</span>`;
}

export function masthead() {
  return html`<header class="mast" id="top">
<h1 class="wm"><span class="sr-only">Malhar’s Library</span>${circuit()}</h1>
</header>`;
}
