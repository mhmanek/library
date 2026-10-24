// Want to read: the hand-kept list in data/manual/want-to-read.json, in file order. Books, papers, essays
// and the rest, each with what it is, the year, the byline and an optional note. No covers: most papers
// and essays have none. Every field is plain text, so all of it is escaped.
import {html} from './html.mjs';
import {sectionHead} from './section.mjs';
import {COPY} from '../content/copy.mjs';
import {joinNames} from '../js/lib/format.js';

const W = COPY.wantToRead;
const isPdf = url => /\.pdf$/i.test(new URL(url).pathname);

function item(r) {
  const meta = [W.kinds[r.kind], r.year, r.url && isPdf(r.url) && W.pdf].filter(Boolean).join(' · ');
  return html`<li class="wr">
<p class="wr-k">${meta}</p>
<h3 class="fv-t">${r.url ? html`<a href="${r.url}">${r.title}</a>` : r.title}</h3>
<p class="fv-by">${joinNames(r.authors)}</p>
${r.note ? html`<p class="fv-note">${r.note}</p>` : ''}
</li>`;
}

export function wantToReadSection({num, reading}) {
  return html`<section id="want-to-read" class="sec" aria-labelledby="h-want-to-read">
${sectionHead({id: 'want-to-read', num, tab: W.tab})}
<p class="display">${W.display}</p>
<ul class="favs wtr">${reading.map(item)}</ul>
</section>`;
}
