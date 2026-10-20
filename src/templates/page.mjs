// Composes index.html in section order: the favourites, the visitor shelf once it has postcards (or a live
// Worker), and the returns slot. Section numbers are computed over the sections actually rendered.
import {html, raw} from './html.mjs';
import {head} from './head.mjs';
import {sprite} from './icons.mjs';
import {masthead} from './masthead.mjs';
import {favouritesSection, cardScript} from './favourites.mjs';
import {favouritesMargin} from './marginalia.mjs';
import {visitorsSection} from './visitors.mjs';
import {recommendSection} from './recommend.mjs';
import {cardDialog} from './card.mjs';
import {footer} from './footer.mjs';
import {COPY} from '../content/copy.mjs';
import {safeFragment} from '../build/sanitize.mjs';

export function plan({config, wall}) {
  const showVisitors = Boolean(config.visitorShelf?.workerUrl) || (wall.items?.length ?? 0) > 0;
  return ['favourites', showVisitors && 'visitors', 'recommend'].filter(Boolean);
}

export function renderPage({catalog, config, wall, derived, index, assets, csp, boot, buildDate, canonical, ogImage}) {
  const sections = plan({config, wall});
  const num = id => sections.indexOf(id) + 1;
  const st = catalog.stats, f = st.favourites;
  const nav = sections.map(id => [id, COPY.nav.find(([k]) => k === id)?.[1] ?? id]);
  const loop = derived.favourites.find(m => m.slug.startsWith('godel-escher-bach'))?.slug ?? null;

  const body = html`<body>
<a class="skip" href="#main">${COPY.skip}</a>
<div class="grain" aria-hidden="true"></div>
${sprite()}
<div class="page">
${masthead({catalog, config, nav})}
<main id="main" tabindex="-1">
${favouritesSection({num: num('favourites'), derived, catalog, config, buildDate, marginsBlock: favouritesMargin(st)})}
${sections.includes('visitors') ? visitorsSection({num: num('visitors'), wall, index}) : ''}
${recommendSection({num: num('recommend'), config})}
</main>
${footer({catalog, config, loopSlug: loop, showWall: sections.includes('visitors')})}
</div>
${cardDialog()}
${cardScript(derived.favourites)}
${derived.favourites.filter(m => m.review).map(m => html`<template id="rev-${m.slug}">${raw(safeFragment(m.review, {block: true}))}</template>`)}
</body>`;

  return `<!doctype html>\n<html lang="en-GB" class="no-js">\n${head({
    title: COPY.title, description: COPY.description(f), canonical, ogImage, ogAlt: COPY.ogAlt(f),
    css: assets.css, js: assets.js, csp, boot,
  })}\n${body}\n</html>\n`;
}
