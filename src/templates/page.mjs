// Composes index.html: the wordmark with a line of links to my reading elsewhere, the ranked favourites,
// the visitor shelf once it has postcards (or a live Worker), and the returns slot. Section numbers count
// the sections actually rendered.
import {html} from './html.mjs';
import {head} from './head.mjs';
import {sprite} from './icons.mjs';
import {masthead} from './masthead.mjs';
import {links} from './links.mjs';
import {favouritesSection} from './favourites.mjs';
import {visitorsSection} from './visitors.mjs';
import {recommendSection} from './recommend.mjs';
import {footer} from './footer.mjs';
import {COPY} from '../content/copy.mjs';

export function plan({config, wall, derived}) {
  const showVisitors = Boolean(config.visitorShelf?.workerUrl) || (wall.items?.length ?? 0) > 0;
  return [derived.tier1.length > 0 && 'favourites', showVisitors && 'visitors', 'recommend'].filter(Boolean);
}

export function renderPage({catalog, derived, config, wall, index, assets, csp, boot, canonical, ogImage}) {
  const sections = plan({config, wall, derived});
  const num = id => sections.indexOf(id) + 1;

  const body = html`<body>
<a class="skip" href="#main">${COPY.skip}</a>
<div class="grain" aria-hidden="true"></div>
${sprite()}
<div class="page">
${masthead()}
${links({catalog, config})}
<main id="main" tabindex="-1">
${sections.includes('favourites') ? favouritesSection({num: num('favourites'), derived, catalog, config}) : ''}
${sections.includes('visitors') ? visitorsSection({num: num('visitors'), wall, index}) : ''}
${recommendSection({num: num('recommend'), config})}
</main>
${footer({catalog, showWall: sections.includes('visitors')})}
</div>
</body>`;

  return `<!doctype html>\n<html lang="en-GB" class="no-js">\n${head({
    title: COPY.title, description: COPY.description, canonical, ogImage, ogAlt: COPY.ogAlt(catalog.stats.favourites),
    css: assets.css, js: assets.js, csp, boot,
  })}\n${body}\n</html>\n`;
}
