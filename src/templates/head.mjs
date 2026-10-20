// <head>: CSP first, the js-class bootstrap, then meta, preloads, the stylesheet and the module entry.
import {createHash} from 'node:crypto';
import {html, raw} from './html.mjs';
import {jsonForScript} from '../../lib/json.mjs';
import {COLOURS} from '../design/tokens.mjs';

// Runs before the stylesheet so .js-only controls are right at first paint. Its sha256 goes in the CSP, so any
// edit here updates the policy automatically.
export const BOOTSTRAP = "document.documentElement.classList.replace('no-js','js')";

export const sha256 = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

export function buildCsp({scripts = [BOOTSTRAP], workerUrl = null, dev = false} = {}) {
  const worker = workerUrl ? new URL(workerUrl).origin : '';
  return [
    "default-src 'self'",
    `script-src 'self' ${scripts.map(sha256).join(' ')} https://challenges.cloudflare.com`,
    "style-src 'self'", "style-src-attr 'unsafe-inline'",
    // Open Library covers redirect twice: covers.openlibrary.org -> archive.org -> ia*.us.archive.org.
    "img-src 'self' data: https://margins.app https://covers.openlibrary.org https://archive.org https://*.us.archive.org",
    "font-src 'self'",
    `connect-src 'self' https://openlibrary.org https://challenges.cloudflare.com${worker ? ` ${worker}` : ''}`,
    'frame-src https://challenges.cloudflare.com',
    "form-action 'none'", "base-uri 'none'", "object-src 'none'",
    // Upgrading would turn the dev server's http://localhost requests into https and break them.
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function head({title, description, canonical, ogImage, ogAlt, prefix = '', css, js, csp, boot, extraScript = ''}) {
  return html`<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<script>${raw(BOOTSTRAP)}</script>${extraScript ? raw(`\n<script>${extraScript}</script>`) : ''}
<meta name="description" content="${description}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="${COLOURS.page}">
${canonical ? html`<link rel="canonical" href="${canonical}">\n` : ''}<link rel="preload" href="${prefix}assets/fonts/antonio-700-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${prefix}assets/fonts/intel-one-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${prefix}${css}">
<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${prefix}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${prefix}apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${canonical ? html`<meta property="og:url" content="${canonical}">\n` : ''}${ogImage ? html`<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${ogAlt}">
<meta name="twitter:card" content="summary_large_image">\n` : ''}${boot ? html`<script type="application/json" id="boot">${raw(jsonForScript(boot))}</script>\n` : ''}${js ? html`<script type="module" src="${prefix}${js}"></script>\n` : ''}</head>`;
}
