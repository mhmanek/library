// Where my reading lives: the favourites post on Mr Philomath, Goodreads and Margins. Plain links, one row
// each; Margins appears once config.json has the profile link. The Goodreads counts are the shelves' own,
// so they match the profile the link opens.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';

const L = COPY.links;

export function links({catalog, config}) {
  const gr = catalog.sources.goodreads;
  const rows = [
    [catalog.sources.substack.postUrl || config.substack.postUrl, L.favourites, L.favouritesDek],
    [gr.profileUrl, L.goodreads, L.goodreadsDek(gr.items['read'], gr.items['to-read'])],
    [config.margins?.profileUrl, L.margins, L.marginsDek],
  ].filter(([href]) => href);
  return html`<nav class="links" aria-label="${L.label}"><ul>${rows.map(([href, title, dek]) => html`<li><a class="lk" href="${href}"><span class="lk-t">${title}</span><span class="lk-d">${dek}</span>${icon('ext')}</a></li>`)}</ul></nav>`;
}
