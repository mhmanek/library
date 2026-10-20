// 404.html can be served at any depth, so its assets use the base-absolute path. A tiny inline script
// (hashed into this page's CSP) forwards /book/<slug> and /<section> to the hash links on the main page,
// so per-book URLs already work today.
import {html, raw} from './html.mjs';
import {head, buildCsp, BOOTSTRAP} from './head.mjs';
import {circuit} from './masthead.mjs';
import {sprite, icon} from './icons.mjs';
import {COPY} from '../content/copy.mjs';

export const forwardScript = base => `(function(b){var p=location.pathname;if(p.indexOf(b)!==0)return;`
  + `var r=decodeURIComponent(p.slice(b.length)).replace(/\\/+$/,''),m=/^book\\/([a-z0-9-]+)$/.exec(r);`
  + `if(m){location.replace(b+'#book/'+m[1]);return}`
  + `if(/^(favourites|visitors|recommend)$/.test(r))location.replace(b+'#'+r)})(${JSON.stringify(base)})`;

export function renderNotFound({base, css, siteUrl}) {
  const script = forwardScript(base);
  const csp = buildCsp({scripts: [BOOTSTRAP, script]});
  return `<!doctype html>\n<html lang="en-GB" class="no-js">\n${head({
    title: `Not found · ${COPY.title}`, description: COPY.notFound.dek, canonical: null, prefix: base, css, js: null, csp, boot: null,
  })}\n${html`<body class="nf">
<div class="grain" aria-hidden="true"></div>
${sprite()}
<div class="page">
<header class="mast">
<p class="wm"><a href="${base}" aria-label="Malhar’s Library, home">${circuit('404')}</a></p>
</header>
<main id="main" class="sec nf-main">
<h1 class="display">${COPY.notFound.display}</h1>
<p class="dek">${COPY.notFound.dek}</p>
<p class="nf-act"><a class="btn" href="${base}"><span>${COPY.notFound.back}</span>${icon('arrow')}</a></p>
<p class="nf-url">${siteUrl}/</p>
</main>
</div>
<script>${raw(script)}</script>
</body>`}\n</html>\n`;
}
