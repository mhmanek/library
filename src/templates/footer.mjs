// Colophon: the visitor shelf's freshness.
import {html} from './html.mjs';
import {COPY} from '../content/copy.mjs';

const F = COPY.footer;

export function footer({catalog, showWall}) {
  return html`<footer class="colophon" id="colophon">
<span class="rail" aria-hidden="true"></span>
${showWall ? html`<ul class="col-l"><li>${F.wall}${catalog.sources.wall.failingSince ? ' · from a saved copy' : ''}.</li></ul>` : ''}
</footer>`;
}
