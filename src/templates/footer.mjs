// Colophon: honest sync status from catalog.sources, cover credits with a takedown contact, and the loop.
import {html, raw} from './html.mjs';
import {icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';
import {formatDay, syncTime} from '../js/lib/format.js';

const F = COPY.footer;

export function footer({catalog, config, loopSlug, showWall}) {
  const tz = config.site.timezone, s = catalog.sources;
  const changed = catalog.syncedAt ? html`<time datetime="${catalog.syncedAt}">${syncTime(catalog.syncedAt, tz)}</time>` : 'not yet';
  const subUpdated = s.substack.updatedAt ? formatDay(s.substack.updatedAt.slice(0, 10)) : '';
  return html`<footer class="colophon" id="colophon">
<span class="rail" aria-hidden="true"></span>
<ul class="col-l">
<li>${raw(F.synced(String(changed)))}.</li>
${s.goodreads.failingSince ? html`<li class="warn">${F.failing(syncTime(s.goodreads.failingSince, tz))}.</li>` : ''}
<li><a href="${s.substack.postUrl}">${F.favourites(subUpdated)}</a>${s.substack.failingSince ? F.favouritesFailing : ''}.</li>
${showWall ? html`<li>${F.wall}${s.wall.failingSince ? ' · from a saved copy' : ''}.</li>` : ''}
<li>${F.covers} <a href="mailto:${config.site.email}?subject=Cover%20takedown">${config.site.email}</a></li>
<li>${F.stack} · <a href="https://github.com/${config.site.repo}">${F.source}${icon('ext')}</a> · ${F.type}</li>
${loopSlug ? html`<li class="loop"><a href="#book/${loopSlug}">${F.loop}</a></li>` : ''}
<li><button class="linkish js-only" type="button" data-theme-reset>${F.reset}</button></li>
</ul>
<p class="col-sig" aria-hidden="true">|00${icon('ket')} + |11${icon('ket')}</p>
</footer>`;
}
