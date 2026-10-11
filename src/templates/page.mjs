// Composes index.html in section order. Section numbers are computed over the sections actually rendered,
// so "Reading now" disappearing renumbers everything after it.
import {html, raw} from './html.mjs';
import {head} from './head.mjs';
import {sprite} from './icons.mjs';
import {masthead} from './masthead.mjs';
import {favouritesSection} from './favourites.mjs';
import {consoleBar, shelfSection, deskSection, giltToggle} from './shelf.mjs';
import {favouritesMargin, readMargins, antiMargin, dnfMargin} from './marginalia.mjs';
import {visitorsSection} from './visitors.mjs';
import {recommendSection} from './recommend.mjs';
import {cardDialog} from './card.mjs';
import {footer} from './footer.mjs';
import {COPY} from '../content/copy.mjs';
import {formatNumber as n} from '../js/lib/format.js';
import {safeFragment} from '../build/sanitize.mjs';

export const ANTI_CLAMP = 72;

export function plan({catalog, config, wall}) {
  const c = catalog.counts;
  const showVisitors = Boolean(config.visitorShelf?.workerUrl) || (wall.items?.length ?? 0) > 0;
  return [
    c.reading > 0 && 'now', 'favourites', c.read > 0 && 'read', c.toRead > 0 && 'antilibrary', c.dnf > 0 && 'dnf',
    showVisitors && 'visitors', 'recommend',
  ].filter(Boolean);
}

export function renderPage({catalog, config, wall, derived, index, assets, csp, boot, buildDate, canonical, ogImage}) {
  const sections = plan({catalog, config, wall});
  const num = id => sections.indexOf(id) + 1;
  const st = catalog.stats, cnt = catalog.counts;
  const rm = readMargins(st, derived.byId);
  const navIds = ['favourites', 'read', 'antilibrary', 'visitors', 'recommend'].filter(id => sections.includes(id));
  const nav = navIds.map(id => [id, COPY.nav.find(([k]) => k === id)?.[1] ?? id]);
  const loop = catalog.books.find(b => b.slug.startsWith('godel-escher-bach'))?.slug ?? null;
  const stacksTotal = cnt.read + cnt.toRead + cnt.dnf;

  const body = html`<body>
<a class="skip" href="#main">${COPY.skip}</a>
<div class="grain" aria-hidden="true"></div>
${sprite()}
<div class="page">
${masthead({catalog, config, nav})}
<main id="main" tabindex="-1">
${sections.includes('now') ? deskSection({num: num('now'), items: derived.reading}) : ''}
${favouritesSection({num: num('favourites'), derived, catalog, config, buildDate, marginsBlock: favouritesMargin(st)})}
<div id="stacks" class="stacks">
${consoleBar(stacksTotal)}
${sections.includes('read') ? shelfSection({id: 'read', num: num('read'), shelf: 'read', tab: COPY.read.tab, display: COPY.read.display,
    dek: COPY.read.dek(st.read.count, st.read.rated, st.read.dated), aside: `${n(cnt.read)} books`, items: derived.read,
    margins: [rm.left, rm.right], label: `Read shelf, ${n(cnt.read)} books`, extraHead: giltToggle()}) : ''}
${sections.includes('antilibrary') ? shelfSection({id: 'antilibrary', num: num('antilibrary'), shelf: 'to-read', tab: COPY.anti.tab, display: COPY.anti.display,
    dek: COPY.anti.dek, aside: `${n(cnt.toRead)} unread`, items: derived.toRead, margins: antiMargin(st, +buildDate.slice(0, 4)),
    label: `Antilibrary, ${n(cnt.toRead)} unread books`, clamp: ANTI_CLAMP, img: false, moreLabel: COPY.anti.more(cnt.toRead)}) : ''}
${sections.includes('dnf') ? shelfSection({id: 'dnf', num: num('dnf'), shelf: 'did-not-finish', tab: COPY.dnf.tab, display: COPY.dnf.display,
    dek: COPY.dnf.dek, aside: `${n(cnt.dnf)} put down`, items: derived.dnf, margins: dnfMargin(st), label: `Did not finish, ${n(cnt.dnf)} books`}) : ''}
</div>
${sections.includes('visitors') ? visitorsSection({num: num('visitors'), wall, index}) : ''}
${recommendSection({num: num('recommend'), config})}
</main>
${footer({catalog, config, loopSlug: loop, showWall: sections.includes('visitors')})}
</div>
${cardDialog()}
${derived.models.filter(m => m.review).map(m => html`<template id="rev-${m.slug}">${raw(safeFragment(m.review, {block: true}))}</template>`)}
</body>`;

  return `<!doctype html>\n<html lang="en-GB" class="no-js">\n${head({
    title: COPY.title, description: COPY.description(cnt), canonical, ogImage, ogAlt: `Malhar's Library: ${n(cnt.read)} read, ${n(cnt.toRead)} in the antilibrary`,
    css: assets.css, js: assets.js, csp, boot,
  })}\n${body}\n</html>\n`;
}
