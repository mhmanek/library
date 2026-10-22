// Postcard parts the browser builds itself: new cards on the visitor shelf, and the live picture side and
// stamp of the card a visitor is writing. The build renders the same markup in src/templates/postcard.mjs,
// which takes its strings and helpers from here so the two never drift apart. textContent only.
import {formatDay} from './format.js';

export const PC = {
  to: ["Malhar's Library", 'The University of Chicago', 'Earth'], toLabel: "Addressed to Malhar's Library, The University of Chicago, Earth",
  stampTop: 'Library post', stampValue: '11/10', front: 'Your book', frontBy: 'goes on the front',
  town: 'Chicago', office: 'Library', noNote: 'No message, just the book.', anon: 'a visitor', by: 'Recommended by',
  turn: 'Turn over the postcard for ',
};

export const coverUrl = (id, size = 'M') => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;

// A stable lean of up to ±1.4°, so the shelf looks pinned up by hand but never reshuffles.
export const tiltFor = id => (([...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 9 - 4) * 0.35).toFixed(2);

// Short notes are written large, long ones small enough to fit the card.
export const noteSize = note => (note.length > 180 ? 'l' : note.length > 90 ? 'm' : 's');

export const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
function img(src, cls, w, h) {
  const i = w ? new Image(w, h) : new Image();
  i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.src = src;
  if (cls) i.className = cls;
  return i;
}

// large: the card being written shows its cover big, from Open Library's large size (one download for the
// cover and its blur), loaded at once because it is swapped in only when ready.
export function pictureEl({coverId = null, title = '', author = '', large = false} = {}) {
  const pic = el('span', 'pc-pic');
  if (coverId) {
    const big = img(coverUrl(coverId, large ? 'L' : 'M'), 'pc-cover', 120, 180), blur = img(coverUrl(coverId, large ? 'L' : 'M'), 'pc-blur');
    if (large) big.loading = blur.loading = 'eager';
    else big.srcset = `${coverUrl(coverId)} 1x, ${coverUrl(coverId, 'L')} 2x`;
    pic.append(blur, big);
  } else {
    const ph = el('span', 'pc-ph');
    ph.append(el('b', '', title || PC.front), el('i', '', author || PC.frontBy));
    pic.append(ph);
  }
  return pic;
}

export function stampEl({coverId = null} = {}) {
  const s = el('span', 'pc-stamp');
  s.setAttribute('aria-hidden', 'true');
  if (coverId) s.append(img(coverUrl(coverId, 'S'), '', 54, 66));
  else { const i = el('span', 'pc-stamp-in'); i.append(el('b', '', PC.stampTop), el('i', '', PC.stampValue)); s.append(i); }
  return s;
}

export function postmarkEl(date = '') {
  const m = el('span', 'pc-mark'), c = el('span', 'pc-mark-c'), t = el('time', '', formatDay(date));
  m.setAttribute('aria-hidden', 'true');
  if (date) t.dateTime = date;
  c.append(el('b', '', PC.town), t, el('b', '', PC.office));
  m.append(c);
  return m;
}

export function addressEl() {
  const p = el('p', 'pc-to');
  p.setAttribute('aria-label', PC.toLabel);
  for (const line of PC.to) { const s = el('span', '', line); s.setAttribute('aria-hidden', 'true'); p.append(s); }
  return p;
}
