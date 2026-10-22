// Favourites: the ranked list from the Mr Philomath post, each with a small cover, the byline and my note,
// then a link to the post for the rest. Notes and bylines are allowlist-sanitised by the pipeline (CONTRACT
// "Sanitised HTML") and again here, so they go in raw.
import {html, raw} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './section.mjs';
import {COPY} from '../content/copy.mjs';
import {safeFragment} from '../build/sanitize.mjs';

const F = COPY.favourites;
const pad = k => String(k).padStart(2, '0');

function cover(m, eager) {
  if (!m.cover) return html`<span class="fv-ph" style="--sp:${m.sp}"></span>`;
  return html`<img src="${m.cover.src}" width="${m.cover.w}" height="${m.cover.h}"${eager ? '' : raw(' loading="lazy"')} decoding="async" alt="">`;
}

function item(m, postUrl, i) {
  const f = m.book.favourite, href = m.goodreadsUrl ?? postUrl;
  return html`<li class="fv" id="fav-${m.slug}">
<a class="fv-cv" href="${href}" tabindex="-1" aria-hidden="true">${cover(m, i < 4)}</a>
<div>
<h3 class="fv-t"><span class="fv-n" aria-hidden="true">${pad(f.rank)}</span><a href="${href}">${m.title}</a></h3>
<p class="fv-by">${raw(safeFragment(f.bylineHtml || m.authorsText))}</p>
<div class="fv-note">${raw(safeFragment(f.noteHtml, {block: true}))}</div>
</div>
</li>`;
}

export function favouritesSection({num, derived, catalog, config}) {
  const postUrl = catalog.sources.substack.postUrl || config.substack.postUrl;
  return html`<section id="favourites" class="sec" aria-labelledby="h-favourites">
${sectionHead({id: 'favourites', num, tab: F.tab})}
<p class="display">${F.display}</p>
<ol class="favs">${derived.tier1.map((m, i) => item(m, postUrl, i))}</ol>
${postUrl ? html`<p class="fv-more"><a href="${postUrl}">${F.more}${icon('ext')}</a></p>` : ''}
</section>`;
}
