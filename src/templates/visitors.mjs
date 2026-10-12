// Visitor shelf: approved recommendations as postcards pinned up picture side out (the cover); tap or
// press one to turn it over to the visitor's handwritten note, name and postmark. The flip is a checkbox,
// so it works without JS. The build renders the committed snapshot (escaped; wall items are plain text by
// contract), stamped with what happened to each book on my shelves. At runtime wall.js swaps in the live
// list with textContent only.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './shelf.mjs';
import {picture, stamp, postmark, address, tiltFor, noteSize} from './postcard.mjs';
import {PC} from '../js/lib/postcard.js';
import {COPY} from '../content/copy.mjs';
import {formatNumber as n} from '../js/lib/format.js';
import {findInIndex} from '../shared/match.js';

export const VISIBLE = 12;

export function stampFor(item, index) {
  const hit = findInIndex({title: item.title, author: item.author, olWork: item.olWork}, index);
  if (!hit) return '';
  const s = COPY.visitors.stamps;
  if (hit.f && hit.s === null) return s.fav;
  if (hit.s === 'read') return s.read(hit.r >= 1 ? Math.floor(hit.r) : 0);
  return s[hit.s] ?? '';
}

export function visitorCard(item, stamp_) {
  const V = COPY.visitors, vid = `v-${item.id}`;
  return html`<li class="vcard" data-id="${item.id}" style="--tilt:${tiltFor(item.id)}deg"><article class="pc pc--wall" aria-labelledby="${vid}">
<label class="pc-hit"><input type="checkbox" class="pc-tog" aria-label="${PC.turn}${item.title}"><span class="pc-turn" aria-hidden="true">${icon('turn')}</span></label>
<div class="pc-flip">
<div class="pc-side pc-front">${picture(item)}<div class="pc-cap"><h3 class="pc-cap-t" id="${vid}"><cite>${item.title}</cite>${item.author ? html` <span class="by">${item.author}</span>` : ''}</h3>${stamp_ ? html`<p class="stamp">${stamp_}</p>` : ''}</div></div>
<div class="pc-side pc-back">
<span class="pc-corner">${stamp(item)}${postmark(item.date)}</span>
<div class="pc-msg">${item.note ? html`<p class="pc-note" data-size="${noteSize(item.note)}">${item.note}</p>` : html`<p class="pc-none">${PC.noNote}</p>`}<p class="pc-sig"><span class="sr-only">${V.by} </span>${item.name || V.anon}</p></div>
${address()}
</div>
</div>
</article></li>`;
}

export function visitorsSection({num, wall, index}) {
  const items = wall.items ?? [];
  return html`<section id="visitors" class="sec sec--vis" aria-labelledby="h-visitors">
${sectionHead({id: 'visitors', num, tab: COPY.visitors.tab, aside: items.length ? `${n(items.length)} left` : ''})}
<p class="display">${COPY.visitors.display}</p>
<p class="dek">${COPY.visitors.dek}</p>
<ul class="vgrid" data-wall data-visible="${VISIBLE}">${items.map(it => visitorCard(it, stampFor(it, index)))}</ul>
<ul class="vgrid vghost" data-wall-empty${items.length ? ' hidden' : ''} aria-label="No visitor books yet">${[0, 1, 2].map(i => (i ? html`<li class="ghost" aria-hidden="true"><span class="gh"><span>${COPY.visitors.empty}</span></span></li>` : html`<li class="ghost"><a class="gh" href="#recommend"><span>${COPY.visitors.empty}</span>${icon('arrow')}</a></li>`))}</ul>
<p class="more-wrap js-only"${items.length > VISIBLE ? '' : ' hidden'}><button class="btn btn--ghost" type="button" data-wall-more>${COPY.visitors.more(items.length)}</button></p>
</section>`;
}
