// Per-book view model for the templates: spine geometry (og.png), harmonised cloth, binding classes and
// the favourites in order. Pure: the same catalog always yields the same markup.
import {harmonise} from './colour.mjs';
import {fold, similarity} from '../shared/normalize.js';
import {joinNames} from '../js/lib/format.js';

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// Thicker books are longer; 24 px keeps every spine a WCAG 2.5.8 target.
export const spineWidth = (pages, id) => (pages ? Math.min(64, Math.max(24, Math.round(12 + pages / 20))) : 26 + fnv1a(id) % 9);
export const spineHeight = id => 78 + fnv1a(`h:${id}`) % 23;

const PARTICLES = new Set(['le', 'la', 'de', 'du', 'des', 'del', 'della', 'van', 'von', 'der', 'den', 'di', 'da', 'ter', 'ten', 'bin', 'ibn', 'al', 'el', 'st.', 'saint']);
const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;
// Display surname with particles kept ('Le Guin', 'van Beethoven'); used on spines and for sorting display.
export function displaySurname(name) {
  const tokens = String(name ?? '').replace(/\([^)]*\)/g, '').replace(/,/g, ' ').trim().split(/\s+/).filter(t => t && !SUFFIX.test(t));
  if (!tokens.length) return '';
  let i = tokens.length - 1;
  while (i > 0 && PARTICLES.has(tokens[i - 1].toLowerCase())) i--;
  return tokens.slice(i).join(' ');
}

const compact = day => (day ? day.replace(/-/g, '') : '');
const plain = html => fold(String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '));

export function bindings(book) {
  const f = book.favourite;
  const cls = [];
  if (book.shelf !== 'to-read' && (book.rating >= 5 || f)) cls.push('g');
  if (f?.score === '11/10') cls.push('x');
  if (!cls.includes('g') && book.rating >= 4) cls.push('t4');
  return cls;
}

export function viewModel(book) {
  const f = book.favourite;
  const cloth = harmonise(book.cover?.colors?.spine || book.cover?.colors?.bg, {unread: book.shelf === 'to-read'});
  const cover = book.cover?.src ? {src: book.cover.src, src2x: book.cover.src2x, w: 200, h: Math.round(200 * book.cover.h / book.cover.w), stem: book.cover.stem, square: book.cover.square} : null;
  const note = f?.noteHtml ?? '';
  // The build drops a review that only repeats the favourite blurb (all three current ones do).
  const review = book.reviewHtml && !(note && similarity(plain(book.reviewHtml), plain(note)) >= 0.9) ? book.reviewHtml : null;
  return {
    book, id: book.id, slug: book.slug, shelf: book.shelf,
    title: book.title, subtitle: book.subtitle, series: book.series,
    authors: book.authors, authorsText: joinNames(book.authors), spineAuthor: displaySurname(book.authors[0]),
    w: spineWidth(book.pages, book.id), h: spineHeight(book.id),
    sp: cloth.hex, fr: book.cover?.colors?.bg ?? '#22386b',
    cls: bindings(book),
    rank: f?.tier === 1 ? f.rank : null, fav: f ? (f.tier === 1 ? `1:${f.rank}` : '2') : '',
    rating: book.rating, avg: book.avgRating, pages: book.pages, year: book.published,
    d: compact(book.dateAdded), ra: compact(book.readAt), alt: book.mergedIds ?? [],
    goodreadsId: book.goodreadsId, goodreadsUrl: book.goodreadsUrl, cover, note, review,
  };
}

export function deriveCatalog(catalog) {
  const models = catalog.books.map(viewModel);
  const favs = models.filter(m => m.book.favourite);
  const tier1 = favs.filter(m => m.book.favourite.tier === 1).sort((a, b) => a.book.favourite.rank - b.book.favourite.rank);
  const tier2 = favs.filter(m => m.book.favourite.tier === 2).sort((a, b) => a.book.favourite.order - b.book.favourite.order);
  // Books from one <li> in the post (both Elon Musk biographies) share a note and render as one entry.
  const groups = [];
  for (const m of tier2) {
    const g = groups.find(x => x.id === m.book.favourite.groupId);
    if (g) g.books.push(m); else groups.push({id: m.book.favourite.groupId, books: [m]});
  }
  const byId = new Map(models.map(m => [m.id, m]));
  // Every favourite in page order: the ranked twenty, then "And more" with each group's books together.
  const favourites = [...tier1, ...groups.flatMap(g => g.books)];
  return {models, byId, tier1, tier2Groups: groups, favourites};
}
