// Favourites: a podium for 01–03, plates for 04–20, the tier-2 list in a <details>, then the Margins card.
// Notes and bylines are allowlist-sanitised by the pipeline (CONTRACT "Sanitised HTML"), so they go in raw.
import {html, raw} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './shelf.mjs';
import {COPY} from '../content/copy.mjs';
import {formatDay, formatNumber as n} from '../js/lib/format.js';
import {safeFragment} from '../build/sanitize.mjs';

const pad = k => String(k).padStart(2, '0');

// Favourites-only books (not on Goodreads) carry the same data-* as a shelf item, so the card can open.
function cardData(m) {
  if (m.shelf) return '';
  return html` data-fo="1"${m.cover ? html` data-c="${m.cover.stem}"` : ''}${m.pages ? html` data-p="${m.pages}"` : ''}${m.year ? html` data-y="${m.year}"` : ''} data-fav="${m.fav}" data-au="${m.authorsText}" data-t="${m.title}"`;
}
const href = (m, postUrl) => m.goodreadsUrl ?? postUrl;

function cover(m, {size, eager = false}) {
  if (!m.cover) return html`<span class="tcover" aria-hidden="true"><b>${m.title}</b><i>${m.spineAuthor}</i></span>`;
  const h = Math.round(size * m.cover.h / m.cover.w);
  return html`<img src="${size > 200 ? m.cover.src2x : m.cover.src}"${size <= 200 ? html` srcset="${m.cover.src2x} 2x"` : ''} width="${size}" height="${h}" ${eager ? raw('fetchpriority="low"') : raw('loading="lazy"')} decoding="async" alt="">`;
}

function score(s) {
  if (!s) return '';
  return s === '11/10'
    ? html`<p class="score score--11"><b>${s}</b><span>${COPY.favourites.eleven}</span></p>`
    : html`<p class="score score--10"><b>${s}</b></p>`;
}

function plate(m, postUrl, podium) {
  const f = m.book.favourite;
  return html`<li class="plate${podium ? ' plate--pod' : ''}" id="fav-${m.slug}" data-book="${m.slug}" style="--fr:${m.fr};--sp:${m.sp}"${cardData(m)}>
<span class="idx${podium ? ' idx--xl' : ''}" aria-hidden="true">${pad(f.rank)}</span>
<a class="pl-cv" href="${href(m, postUrl)}" data-open="${m.slug}" tabindex="-1" aria-hidden="true">${cover(m, {size: podium ? 400 : 200, eager: podium})}</a>
<div class="pl-tx">
<h3 class="pl-t"><a href="${href(m, postUrl)}" data-open="${m.slug}">${m.title}</a></h3>
<p class="pl-by">${raw(safeFragment(f.bylineHtml || m.authorsText))}</p>
${score(f.score)}
<div class="note">${raw(safeFragment(f.noteHtml, {block: true}))}</div>
${m.shelf ? '' : html`<p class="pl-off">${COPY.favourites.notOnGoodreads}</p>`}
</div>
</li>`;
}

function moreEntry(group, postUrl) {
  const [first] = group.books;
  const f = first.book.favourite;
  return html`<li class="more-i" id="fav-${first.slug}" data-book="${first.slug}" style="--fr:${first.fr};--sp:${first.sp}"${cardData(first)}>
<span class="more-cv" aria-hidden="true">${first.cover ? html`<img src="${first.cover.src}" width="40" height="${Math.round(40 * first.cover.h / first.cover.w)}" loading="lazy" decoding="async" alt="">` : html`<i></i>`}</span>
<div><p class="more-t">${group.books.map((m, i) => html`${i ? ' & ' : ''}<a href="${href(m, postUrl)}" data-open="${m.slug}"><cite>${m.title}</cite></a>`)}<span class="more-by"> — ${raw(safeFragment(f.bylineHtml || first.authorsText))}</span></p>
<div class="note">${raw(safeFragment(f.noteHtml, {block: true}))}</div></div>
</li>`;
}

export function margins(userId) {
  const id = String(userId ?? '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(id)) return '';
  return id;
}

export function favouritesSection({num, derived, catalog, config, buildDate, marginsBlock = ''}) {
  const postUrl = catalog.sources.substack.postUrl || config.substack.postUrl;
  const {tier1, tier2Groups} = derived;
  const podium = tier1.slice(0, 3), plates = tier1.slice(3);
  const f = catalog.stats.favourites;
  const updated = catalog.sources.substack.updatedAt ? formatDay(catalog.sources.substack.updatedAt.slice(0, 10)) : '';
  const mid = margins(config.margins?.userId);
  const moreCount = tier2Groups.reduce((k, g) => k + g.books.length, 0);
  return html`<section id="favourites" class="sec sec--fav" aria-labelledby="h-favourites">
${sectionHead({id: 'favourites', num, tab: COPY.favourites.tab, aside: `${n(f.ranked)} ranked · ${n(f.more)} more`})}
<p class="display">${COPY.favourites.display}</p>
<p class="dek">${COPY.favourites.dek(f.elevens)}</p>
${marginsBlock}
${podium.length ? html`<ol class="podium" aria-label="Favourites 1 to ${podium.length}">${podium.map(m => plate(m, postUrl, true))}</ol>` : ''}
${plates.length ? html`<ol class="plates" start="4" aria-label="Favourites 4 to ${3 + plates.length}">${plates.map(m => plate(m, postUrl, false))}</ol>` : ''}
${tier2Groups.length ? html`<details class="more"><summary><span>${COPY.favourites.more(moreCount)}</span>${icon('arrow')}</summary><ol class="more-l">${tier2Groups.map(g => moreEntry(g, postUrl))}</ol></details>` : ''}
<p class="src-link"><a href="${postUrl}">${COPY.favourites.source}${updated ? `, updated ${updated}` : ''}${icon('ext')}</a></p>
${mid ? html`<figure class="margins" data-margins>
<a href="https://margins.app/u/${mid}"><img src="https://margins.app/api/og?userId=${mid}&amp;v=${buildDate}" width="1200" height="630" loading="lazy" decoding="async" alt="${COPY.favourites.marginsAlt}"></a>
<figcaption>${COPY.favourites.margins} <a href="https://margins.app/u/${mid}">margins.app${icon('ext')}</a></figcaption>
</figure>` : ''}
</section>`;
}
