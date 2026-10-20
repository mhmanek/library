// The library card: one native <dialog>, filled at runtime from the item's DOM (no JSON needed).
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';

const C = COPY.card;

export function cardDialog() {
  return html`<dialog id="card" class="card" aria-labelledby="card-title" aria-describedby="card-by">
<div class="card-bar" data-drag>
<span class="card-grip" aria-hidden="true"><i></i><i></i><i></i></span>
<span class="card-path">${C.label}</span>
<span class="card-pos" data-f="pos"></span>
<button type="button" class="card-x" data-close aria-label="${C.close}">${icon('x')}</button>
</div>
<div class="card-body">
<figure class="card-cover" data-f="cover"></figure>
<div class="card-main">
<p class="card-eyebrow" data-f="eyebrow"></p>
<h2 id="card-title" tabindex="-1" data-f="title"></h2>
<p class="card-sub" data-f="subtitle"></p>
<p id="card-by" class="card-by" data-f="authors"></p>
<div class="vs" data-f="vs"></div>
<dl class="card-facts" data-f="facts"></dl>
<section class="card-note" data-f="note" aria-label="My note"></section>
<section class="card-review" data-f="review" aria-label="My review"></section>
<p class="card-links"><a data-f="gr" href="#">Goodreads${icon('ext')}</a><button type="button" class="linkish" data-copy>${C.copy}</button></p>
</div>
</div>
<div class="card-foot"><button type="button" class="btn btn--ghost btn--sm" data-prev>${icon('prev')}<span>Prev</span></button><span class="hint" aria-hidden="true">${C.hint}</span><button type="button" class="btn btn--ghost btn--sm" data-next><span>Next</span>${icon('next')}</button></div>
</dialog>
<p class="toast" role="status" aria-live="polite" data-toast hidden></p>`;
}
