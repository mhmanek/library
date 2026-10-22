// Where else my reading lives: Goodreads, and Margins once config.json has the profile link. One small line
// under the wordmark.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';

const L = COPY.links;

export function links({catalog, config}) {
  const rows = [
    [catalog.sources.goodreads.profileUrl, L.goodreads],
    [config.margins?.profileUrl, L.margins],
  ].filter(([href]) => href);
  if (!rows.length) return '';
  return html`<nav class="links" aria-label="${L.label}"><ul>${rows.map(([href, title]) => html`<li><a href="${href}">${title}${icon('ext')}</a></li>`)}</ul></nav>`;
}
