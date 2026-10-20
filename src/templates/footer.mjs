// Colophon: the visitor shelf's freshness, cover credits with a takedown contact, source and type.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';

const F = COPY.footer;

export function footer({catalog, config, showWall}) {
  return html`<footer class="colophon" id="colophon">
<span class="rail" aria-hidden="true"></span>
<ul class="col-l">
${showWall ? html`<li>${F.wall}${catalog.sources.wall.failingSince ? ' · from a saved copy' : ''}.</li>` : ''}
<li>${F.covers} <a href="mailto:${config.site.email}?subject=Cover%20takedown">${config.site.email}</a></li>
<li>${F.stack} · <a href="https://github.com/${config.site.repo}">${F.source}${icon('ext')}</a> · ${F.type}</li>
</ul>
<p class="col-sig" aria-hidden="true">|00${icon('ket')} + |11${icon('ket')}</p>
</footer>`;
}
