// Visitor shelf: approved recommendations in Margins' "Recommended by" idiom. The build renders the
// committed snapshot (escaped; wall items are plain text by contract), stamped with what happened to each
// book on his shelves. At runtime wall.js swaps in the live list with textContent only.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './shelf.mjs';
import {COPY} from '../content/copy.mjs';
import {formatDay, formatNumber as n} from '../js/lib/format.js';
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

export function visitorCard(item, stamp) {
  const vid = `v-${item.id}`;
  return html`<li class="vcard" data-id="${item.id}"><article aria-labelledby="${vid}">
<span class="vc-cv" aria-hidden="true">${item.coverId ? html`<img src="https://covers.openlibrary.org/b/id/${item.coverId}-M.jpg" width="72" height="108" loading="lazy" decoding="async" alt="">` : html`<b>${item.title}</b>`}</span>
<div class="vc-tx">
<h3 id="${vid}"><cite>${item.title}</cite>${item.author ? html` <span class="by">${item.author}</span>` : ''}</h3>
${item.note ? html`<blockquote><p>“${item.note}”</p></blockquote>` : ''}
<p class="meta">${COPY.visitors.by} <b>${item.name || COPY.visitors.anon}</b> · <time datetime="${item.date}">${formatDay(item.date)}</time></p>
${stamp ? html`<p class="stamp">${stamp}</p>` : ''}
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
