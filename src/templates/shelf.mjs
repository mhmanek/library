// The stacks: one server-rendered <li> per book, drawn three ways by CSS (spines, covers, catalogue).
// Without JS every link goes to Goodreads; with JS a click opens the library card instead.
import {html, raw} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';
import {formatNumber as n, formatYear, formatRating, formatAvg} from '../js/lib/format.js';

const pad = k => String(k).padStart(2, '0');

// The accessible name reads naturally: "Anathem by Neal Stephenson · rated 5 · 937 pages, 2008 · a favourite".
// The <i> connector words are visually hidden in Catalogue view, where column headers carry them.
export function bookItem(m, {img = true} = {}) {
  const cls = [...m.cls, m.w < 30 ? 'n' : '', !m.cover ? 'tc' : ''].filter(Boolean).join(' ');
  const year = m.year ? formatYear(m.year) : '';
  const withImg = img && m.cover;
  // Byte-lean on purpose (about 1,100 of these): ratings, pages and years live once, in the text the
  // accessible name needs; JS reads them back. Antilibrary covers come from data/stacks.json on demand.
  return raw(html`<li class="bk${cls ? ` ${cls}` : ''}" id="book/${m.slug}" style="--sp:${m.sp};${img ? html`--fr:${m.fr};` : ''}--w:${m.w};--h:${m.h}">`
    + html`<a href="${m.goodreadsUrl ?? `#book/${m.slug}`}"${m.avg !== null ? html` data-wr="${formatAvg(m.avg)}"` : ''}${m.d ? html` data-d="${m.d}"` : ''}${m.ra ? html` data-ra="${m.ra}"` : ''}${m.fav ? html` data-fav="${m.fav}"` : ''}${m.alt.length ? html` data-alt="${m.alt.join(' ')}"` : ''}${m.badge ? html` data-b="${m.badge}"` : ''}><span class="sp" aria-hidden="true"><b>${m.title}</b><i>${m.spineAuthor}</i>${m.rank ? html`<u>${pad(m.rank)}</u>` : ''}</span>`
    + (withImg ? html`<img class="cv" src="${m.cover.src}" srcset="${m.cover.src2x} 2x" width="200" height="${m.cover.h}" loading="lazy" decoding="async" alt="">` : '')
    + html`<span class="tx"><span class="tt"><cite>${m.title}</cite>${m.subtitle ? html`<span class="sub">: ${m.subtitle}</span>` : ''}${m.series ? html`<span class="ser"> · ${m.series.name}${m.series.index ? ` #${m.series.index}` : ''}</span>` : ''}</span><span class="au"><i> by </i>${m.authorsText}</span></span>`
    + html`<span class="mt">${m.rating > 0 ? html`<span class="r"><i> · rated </i>${formatRating(m.rating)}</span>` : ''}${m.pages ? html`<span class="p"><i> · </i>${n(m.pages)}<i> pages</i></span>` : html`<span class="p u"><i> · pages unknown</i></span>`}${year ? html`<span class="y"><i>, </i>${year}</span>` : html`<span class="y u"><i>, year unknown</i></span>`}${m.rank ? html`<span class="fv"><i> · favourite </i>Nº ${m.rank}</span>` : m.fav ? html`<span class="fv"><i> · a favourite</i></span>` : ''}</span></a></li>`);
}

export function sectionHead({id, num, tab, aside = ''}) {
  return html`<div class="sec-head"><h2 class="tab" id="h-${id}"><span class="n" aria-hidden="true">${pad(num)}</span> ${tab}</h2>${aside ? html`<p class="sec-aside">${aside}</p>` : ''}<span class="rail" aria-hidden="true"></span></div>`;
}

const catHead = () => html`<div class="cat-head" aria-hidden="true"><span></span><span>Title</span><span>Author</span><span>Me</span><span>GR</span><span>Pages</span><span>Year</span></div>`;

export function consoleBar(total) {
  return html`<div class="console">
<form class="find js-only" role="search" aria-label="Search the stacks" data-find>
<label for="q"><span class="find-p" aria-hidden="true">&gt;<span class="find-w"> find</span></span><span class="sr-only">Title, author or series</span></label>
<input id="q" name="q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-keyshortcuts="/" placeholder="title or author" maxlength="120">
<kbd class="slash" aria-hidden="true">/</kbd>
</form>
<button class="con-more" type="button" popovertarget="con-panel" aria-label="Sort and view">${icon('down')}<span>Sort &amp; view</span></button>
<div class="con-panel" id="con-panel" popover>
<label class="sort js-only"><span>Sort</span><select id="sort" data-sort>
<option value="">Shelf order</option><option value="mine">My rating</option><option value="world">Goodreads rating</option><option value="love">Me vs the world</option>
<option value="title">Title A–Z</option><option value="author">Author A–Z</option><option value="long">Longest first</option><option value="old">Oldest first</option>
<option value="added">Recently added to Goodreads</option><option value="colour">Colour</option>
</select></label>
<fieldset class="views"><legend class="sr-only">View</legend>
<label><input type="radio" name="view" id="v-shelf" value="shelf" checked><span>Shelf</span></label><label><input type="radio" name="view" id="v-covers" value="covers"><span>Covers</span></label><label><input type="radio" name="view" id="v-list" value="list"><span>Catalogue</span></label>
</fieldset>
</div>
<p class="count js-only" role="status" aria-live="polite" data-count>${n(total)} books</p>
</div>
<p class="kb-hint" aria-hidden="true" hidden data-kbhint>${COPY.hint}</p>
<p class="miss" hidden data-miss><a href="#recommend" data-miss-link></a></p>`;
}

export function shelfSection({id, num, shelf, tab, display, dek, aside = '', items, margins = '', label, extraHead = '', clamp = 0, img = true, moreLabel = ''}) {
  return html`<section id="${id}" class="sec sec--shelf" aria-labelledby="h-${id}" data-shelf="${shelf}">
${sectionHead({id, num, tab, aside})}
<div class="sec-intro"><p class="display">${display}</p>${extraHead}</div>
<p class="dek">${dek}</p>
${margins}
<p class="reader" aria-hidden="true" data-reader></p>
${catHead()}
<ol class="bk-list shelf--${shelf}" id="list-${shelf}" aria-label="${label}" data-list="${shelf}"${clamp ? html` data-clamp="${clamp}"` : ''}>${items.map(m => bookItem(m, {img}))}</ol>
<p class="empty" hidden data-empty></p>
${clamp && items.length > clamp ? html`<p class="more-wrap js-only"><button class="btn btn--ghost" type="button" data-more aria-expanded="false" aria-controls="list-${shelf}" data-label-more="${moreLabel}" data-label-less="${COPY.anti.less}">${moreLabel}</button></p>` : ''}
</section>`;
}

export function deskSection({num, items}) {
  return html`<section id="now" class="sec sec--desk" aria-labelledby="h-now">
${sectionHead({id: 'now', num, tab: COPY.now.tab, aside: `${n(items.length)} open`})}
<p class="display">${COPY.now.display}</p>
<ol class="bk-list shelf--desk" aria-label="Reading now, ${n(items.length)} ${items.length === 1 ? 'book' : 'books'}" data-list="desk">${items.slice(0, 6).map(m => bookItem(m))}</ol>
</section>`;
}

export function giltToggle() {
  return html`<button class="chip js-only" type="button" aria-pressed="false" data-gilt>${COPY.read.gilt}<small>${COPY.read.giltHint}</small></button>`;
}
