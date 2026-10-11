// Goodreads item -> Record. Titles arrive with series suffixes, subtitles and edition junk glued on
// ("Buffett: The Making of an American Capitalist by Roger Lowenstein", "By Maggie Mahar - Bull: …").
// Display fields are cleaned here; matching keeps the series suffix so markers like "Classics Illustrated" survive.
import {isbnPair} from './isbn.mjs';
import {surname, markers} from '../src/shared/normalize.js';

const SERIES_RE = /\s*\(([^()#;]+?),?\s*#(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)(?:;[^()]*)?\)\s*$/;
const FORMAT_RE = new RegExp('\\s*[([]\\s*(?:' + [
  'paperback', 'hardcover', 'hardback', 'mass market paperback', 'kindle edition', 'ebook', 'e-book', 'audiobook', 'audio cd',
  'unabridged', 'abridged', 'illustrated edition', 'revised edition', 'deluxe edition', '\\d+(?:st|nd|rd|th) edition',
  '(?:[\\w-]+ )?anniversary edition',
  "(?:penguin|oxford(?: world's)?|vintage|modern library|everyman'?s?(?: library)?|dover|signet|bantam|wordsworth) classics?",
].join('|') + ')\\s*[)\\]]\\s*$', 'i');

// Seller-listing date stamps: "…by Roger Lowenstein(2008-04-29)", "… 1982-2004 (9.12.2004)".
const DATE_STAMP_RE = /\s*\(\s*\d{1,4}[-./]\d{1,2}[-./]\d{1,4}\s*\)\s*$/;

const collapse = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sharesSurname = (name, author) => !!surname(name) && surname(name) === surname(author);

// Index of the first ": " outside parentheses, or -1.
function colonAt(s) {
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth) depth--;
    else if (c === ':' && s[i + 1] === ' ' && !depth) return i;
  }
  return -1;
}

export function splitTitle(raw, author = '') {
  let t = collapse(raw);
  let series = null;
  const sm = SERIES_RE.exec(t);
  if (sm && sm.index > 0) {
    series = {name: collapse(sm[1]), index: sm[2].replace(/\s+/g, '')}; // only the first of "(George Smiley, #5; Karla Trilogy, #1)"
    t = t.slice(0, sm.index).trim();
  }
  for (let guard = 0; guard < 5; guard++) {
    const before = t;
    t = t.replace(FORMAT_RE, '').replace(DATE_STAMP_RE, '').trim();
    const pre = /^By\s+(.+?)\s+[-–—]\s+/i.exec(t);
    if (pre && sharesSurname(pre[1], author)) t = t.slice(pre[0].length).trim();
    // "… by Roger Lowenstein" goes; "Death by Black Hole" stays because the name is not the author's.
    const suf = /\s+by\s+([^:]+)$/i.exec(t);
    if (suf && sharesSurname(suf[1], author) && suf[1].trim().length <= collapse(author).length + 8) t = t.slice(0, suf.index).trim();
    if (t === before) break;
  }
  // '"Surely You're Joking, Mr. Feynman!": Adventures…' is quoted on Goodreads; the quotes are not the title.
  t = t.replace(/^["“]([^"“”]+)["”](?=:|$)/, '$1');
  let title = t, subtitle = null;
  const c = colonAt(t);
  if (c > 0) {
    title = t.slice(0, c).trim();
    subtitle = t.slice(c + 2).replace(/[\s,;:-]+$/, '').trim() || null;
  }
  return {title, subtitle, series};
}

// The title used for matching: cleaned, but with the series suffix put back so markers(…) can still see it.
export const matchTitle = (title, series) => series ? `${title} (${series.name}, #${series.index ?? ''})` : title;

export function normalizeGoodreads(item, shelf) {
  const author = collapse(item.author);
  const {title, subtitle, series} = splitTitle(item.title, author);
  const {isbn10, isbn13} = isbnPair(item.isbn);
  const mt = matchTitle(title, series);
  return {
    key: `gr:${item.bookId}`, goodreadsId: item.bookId, shelf,
    rawTitle: collapse(item.title), title, subtitle, series, matchTitle: mt,
    markers: markers([mt, subtitle].filter(Boolean).join(': ')),
    authors: [author], isbn10, isbn13,
    grPages: item.pages ?? null, published: item.published ?? null,
    rating: item.rating ?? 0, avgRating: item.avgRating ?? null,
    addedAt: item.addedAt ?? null, dateAdded: item.addedAt ? item.addedAt.slice(0, 10) : null,
    readAt: item.readAt ?? null, review: item.review ?? null, image: item.image ?? null,
  };
}

// Goodreads first if plausible, else Open Library's median, else null (audiobook editions report 16 pages).
export function pickPages(grPages, olPages) {
  if (grPages >= 40) return grPages;
  if (olPages >= 40) return olPages;
  return null;
}
