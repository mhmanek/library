// Stats as marginalia: an aside that hangs in the margin on wide screens and becomes a strip of stat tiles
// below the section head elsewhere. Every number is computed by the pipeline (catalog.stats); the witty
// lines are computed here.
import {html} from './html.mjs';
import {formatNumber as n} from '../js/lib/format.js';
import {word} from '../content/copy.mjs';

const tile = (label, value, aside = '') => html`<div class="st"><p class="st-l">${label}</p><p class="st-v">${value}</p>${aside ? html`<p class="st-a">${aside}</p>` : ''}</div>`;
const aside = (side, label, body) => html`<aside class="mg mg--${side}" aria-label="Margin notes: ${label}"><div class="mg-in">${body}</div></aside>`;

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function favouritesMargin(stats) {
  const f = stats.favourites;
  const tens = Math.max(0, f.ranked - f.elevens);
  return aside('l', 'favourites', [
    tile('Ranked', n(f.ranked), html`${cap(word(f.elevens))} go${f.elevens === 1 ? 'es' : ''} to eleven.${tens ? ` ${cap(word(tens))} stop${tens === 1 ? 's' : ''} at ten.` : ''}`),
    tile('And more', n(f.more), 'I’d still press these on you.'),
    f.offGoodreads ? tile('Off the books', n(f.offGoodreads), html`${f.offGoodreads === 1 ? 'One isn’t' : `${cap(word(f.offGoodreads))} aren’t`} even on my Goodreads.`) : '',
  ]);
}
