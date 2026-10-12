// Postcard parts shared by the returns slot (the card a visitor writes) and the visitor shelf (the cards
// I've shelved). The picture side is the book's Open Library cover over a blurred copy of itself, or a
// cloth-bound placeholder; the message side is printed like a real divided-back card. src/js/lib/postcard.js
// builds the same markup in the browser and owns the strings and helpers, so keep the two in step.
import {html} from './html.mjs';
import {PC, coverUrl, tiltFor, noteSize} from '../js/lib/postcard.js';
import {formatDay} from '../js/lib/format.js';

export {coverUrl, tiltFor, noteSize};

export function picture({coverId = null, title = '', author = ''} = {}) {
  return coverId
    ? html`<span class="pc-pic"><img class="pc-blur" src="${coverUrl(coverId)}" alt="" loading="lazy" decoding="async"><img class="pc-cover" src="${coverUrl(coverId)}" srcset="${coverUrl(coverId)} 1x, ${coverUrl(coverId, 'L')} 2x" width="120" height="180" alt="" loading="lazy" decoding="async"></span>`
    : html`<span class="pc-pic"><span class="pc-ph"><b>${title || PC.front}</b><i>${author || PC.frontBy}</i></span></span>`;
}

export function stamp({coverId = null} = {}) {
  return html`<span class="pc-stamp" aria-hidden="true">${coverId
    ? html`<img src="${coverUrl(coverId, 'S')}" alt="" width="54" height="66" loading="lazy" decoding="async">`
    : html`<span class="pc-stamp-in"><b>${PC.stampTop}</b><i>${PC.stampValue}</i></span>`}</span>`;
}

export const postmark = (date = '') => html`<span class="pc-mark" aria-hidden="true"><span class="pc-mark-c"><b>${PC.town}</b><time${date ? html` datetime="${date}"` : ''}>${date ? formatDay(date) : ''}</time><b>${PC.office}</b></span></span>`;

export const address = () => html`<p class="pc-to" aria-label="${PC.toLabel}">${PC.to.map(line => html`<span aria-hidden="true">${line}</span>`)}</p>`;
