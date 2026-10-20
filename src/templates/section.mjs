// The numbered gold tab on its rail that opens every section.
import {html} from './html.mjs';

const pad = k => String(k).padStart(2, '0');

export function sectionHead({id, num, tab, aside = ''}) {
  return html`<div class="sec-head"><h2 class="tab" id="h-${id}"><span class="n" aria-hidden="true">${pad(num)}</span> ${tab}</h2>${aside ? html`<p class="sec-aside">${aside}</p>` : ''}<span class="rail" aria-hidden="true"></span></div>`;
}
