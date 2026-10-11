// Stats as marginalia: asides that hang in the margins on wide screens and become a strip of stat tiles
// below the section head elsewhere. Every number is computed by the pipeline (catalog.stats); the witty
// lines are computed here. No read-year anything: only a handful of books have a finish date.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {formatNumber as n, formatYear, formatDelta} from '../js/lib/format.js';
import {word} from '../content/copy.mjs';

const tile = (label, value, aside = '', cls = '') => html`<div class="st${cls ? ` ${cls}` : ''}"><p class="st-l">${label}</p><p class="st-v">${value}</p>${aside ? html`<p class="st-a">${aside}</p>` : ''}</div>`;
const fact = (label, body) => html`<div class="st st--fact"><p class="st-l">${label}</p><p class="st-a">${body}</p></div>`;
const aside = (side, label, body) => html`<aside class="mg mg--${side}" aria-label="Margin notes: ${label}"><div class="mg-in">${body}</div></aside>`;

export function histogram(hist) {
  const levels = ['5', '4', '3', '2', '1'];
  const last = Math.max(...levels.map((l, i) => (hist[l] ? i : 0)), 1);
  const shown = levels.slice(0, last + 1);
  const max = Math.max(1, ...shown.map(l => hist[l] ?? 0));
  return html`<figure class="hist"><figcaption class="st-l">How I rate</figcaption><ul>${shown.map(l => html`<li style="--v:${((hist[l] ?? 0) / max).toFixed(3)}"><span class="hl">${l}${icon('star')}<span class="sr-only"> stars</span></span><span class="hb"><i></i><span class="hv">${n(hist[l] ?? 0)}</span></span></li>`)}</ul></figure>`;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const titleOf = (byId, id) => byId.get(id)?.title ?? '';

export function favouritesMargin(stats) {
  const f = stats.favourites;
  const tens = Math.max(0, f.ranked - f.elevens);
  return aside('l', 'favourites', [
    tile('Ranked', n(f.ranked), html`${cap(word(f.elevens))} go${f.elevens === 1 ? 'es' : ''} to eleven.${tens ? ` ${cap(word(tens))} stop${tens === 1 ? 's' : ''} at ten.` : ''}`),
    tile('And more', n(f.more), 'I’d still press these on you.'),
    f.offGoodreads ? tile('Off the books', n(f.offGoodreads), html`${f.offGoodreads === 1 ? 'One isn’t' : `${cap(word(f.offGoodreads))} aren’t`} even on my Goodreads.`) : '',
  ]);
}

export function readMargins(stats, byId) {
  const r = stats.read;
  const metres = r.pages.total / 2 * 0.0001; // two pages per leaf, a tenth of a millimetre each
  const kinder = r.mean !== null && r.worldMean !== null ? r.mean - r.worldMean : null;
  const right = aside('r', 'the read shelf', [
    tile('Books read', n(r.count), r.pages.known ? html`${n(r.pages.total)} pages: about ${metres.toFixed(1)} m of paper, floor to ceiling${metres > 2.6 ? ' and then some' : ''}.` : ''),
    r.rated ? histogram(r.hist) : '',
    kinder !== null ? tile('Me vs Goodreads', html`${r.mean.toFixed(2)}<small> vs ${r.worldMean.toFixed(2)}</small>`,
      Math.abs(kinder) < 0.005 ? 'Exactly as kind as the crowd.' : `I’m ${Math.abs(kinder).toFixed(2)} of a star ${kinder > 0 ? 'kinder' : 'harsher'} than Goodreads.`) : '',
  ]);
  const left = aside('l', 'oddities', [
    r.oldest ? fact('Oldest', html`<cite>${titleOf(byId, r.oldest.id)}</cite>, ${byId.get(r.oldest.id)?.authors[0] ?? ''}, ${formatYear(r.oldest.year)}`) : '',
    r.longest ? fact('Longest', html`<cite>${titleOf(byId, r.longest.id)}</cite>, ${n(r.longest.pages)} pages`) : '',
    r.topAuthors?.length ? fact('Most-read author', html`${r.topAuthors[0].name} (${r.topAuthors[0].count})`) : '',
    r.crush ? fact('Biggest crush', html`<cite>${titleOf(byId, r.crush.id)}</cite> (${formatDelta(r.crush.delta)} on the crowd)`) : '',
    r.harsh ? fact('Harshest', html`<cite>${titleOf(byId, r.harsh.id)}</cite> (${formatDelta(r.harsh.delta)})`) : '',
  ]);
  return {left, right};
}

export function antiMargin(stats, buildYear) {
  const t = stats.toRead, read = stats.read.count;
  const ratio = read ? t.count / read : 0;
  let finish = '';
  if (t.count && t.pages.known / t.count >= 0.7) {
    const pages = t.pages.total * t.count / t.pages.known;
    finish = tile('At 40 pages a day', String(Math.ceil(buildYear + pages / 40 / 365.25)), 'is when I’d finish. I won’t.');
  }
  return aside('r', 'the antilibrary', [
    tile('Unread', n(t.count), read ? html`${ratio >= 1 ? ratio.toFixed(1) : ratio.toFixed(2)} for every book I’ve read. Eco would approve.` : ''),
    finish,
  ]);
}

export const dnfMargin = stats => aside('r', 'did not finish', [tile('Abandoned', n(stats.dnf.count), 'No regrets.')]);
