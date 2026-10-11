// Masthead: kicker bar (prompt, sync LED, day/night knob), the Bell-pair circuit wordmark, intro, terminal nav.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';
import {syncTime} from '../js/lib/format.js';

const ket = label => html`<span class="ket">|${label}${icon('ket', 'ket-a')}</span>`;
const tiles = (letters, start) => [...letters].map((ch, i) => html`<span class="tile" style="--i:${i + start}">${ch}</span>`);

// Two wires with identical slot widths so the CNOT's control and target line up:
//   |0⟩ ─[H]─ M A L H A R ’ S ──●──── ○
//   |0⟩ ───── L I B R A R Y ────⊕──── ○
// H then CNOT entangles the two names: a correct Bell-pair circuit.
export function circuit(label = '0') {
  return html`<span class="circuit" aria-hidden="true" title="Bell pair: H then CNOT">
<span class="wire w1">${ket(label)}<span class="h">H</span>${tiles('MALHAR', 0)}<span class="apos">’</span>${tiles('S', 6)}<span class="wa"></span><span class="cx"><span class="ctrl"></span></span><span class="wb"></span><span class="node"></span></span>
<span class="wire w2">${ket(label)}<span class="h h-0"></span>${tiles('LIBRAR', 7)}<span class="apos"></span>${tiles('Y', 13)}<span class="wa"></span><span class="cx"><span class="target"></span></span><span class="wb"></span><span class="node n2"></span></span>
</span>`;
}

export function knob() {
  return html`<button class="knob js-only" type="button" aria-pressed="true" data-knob>
<span class="knob-l knob-n" aria-hidden="true"><i class="led"></i>Night</span><span class="knob-dial" aria-hidden="true"><span class="knob-ptr"></span></span><span class="knob-l knob-d" aria-hidden="true">Day<i class="led"></i></span><span class="sr-only" data-knob-label>Night mode</span>
</button>`;
}

export function syncLine(catalog, timeZone) {
  const g = catalog.sources.goodreads;
  const when = catalog.syncedAt;
  if (g.failingSince) {
    return html`<span class="sync is-stale"><i class="led led--hollow"></i><span>Goodreads quiet since <time datetime="${g.failingSince}" data-rel>${syncTime(g.failingSince, timeZone)}</time></span></span>`;
  }
  if (!when) return html`<span class="sync is-stale"><i class="led led--hollow"></i><span>Not synced yet</span></span>`;
  return html`<span class="sync"><i class="led"></i><span>Updated from Goodreads · <time datetime="${when}" data-rel>${syncTime(when, timeZone)}</time></span></span>`;
}

export function masthead({catalog, config, nav}) {
  const c = catalog.counts, f = catalog.stats.favourites;
  return html`<header class="mast" id="top">
<div class="kicker">
<p class="prompt"><span>${COPY.prompt}</span><span class="caret" aria-hidden="true"></span></p>
<p class="kick-r">${syncLine(catalog, config.site.timezone)}</p>
${knob()}
</div>
<h1 class="wm"><span class="sr-only">Malhar’s Library</span>${circuit()}</h1>
<p class="intro">${COPY.intro({ranked: f.ranked || 20, toRead: c.toRead})}</p>
<nav class="tnav" aria-label="Sections"><ul>${nav.map(([id, label]) => html`<li><a href="#${id}"><span aria-hidden="true">&gt;./</span>${label}</a></li>`)}</ul></nav>
</header>`;
}
