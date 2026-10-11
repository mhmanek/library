// Substack favourites -> books. Per title, in order: a committed pin (data/manual/favourites-map.json, keyed by
// Goodreads id) for the cases no rule can get right (the Instaread Black Swan he logged, "How to Live with
// Statistics", Invent & Wander credited to Isaacson in the post but to Bezos on Goodreads, Poor Charlie's
// "edited by Peter Kaufman"); then the not-on-Goodreads list; then the merge rule against every edition on every
// shelf; otherwise a favourites-only book with a warning.
import {fold, slug} from '../src/shared/normalize.js';
import {sameWorkStrict, workOf, SHELF_RANK} from './merge.mjs';
import {splitTitle} from './normalize.mjs';

const better = (a, b) => (SHELF_RANK[a.shelf] - SHELF_RANK[b.shelf]) || (b.rating - a.rating) || (Number(a.goodreadsId) - Number(b.goodreadsId));

export function substackWork(t) {
  const {title, subtitle} = splitTitle(t.title, t.authors[0] ?? '');
  return {title, subtitle, authors: t.authors, series: null, isbn13: null, olWork: null};
}

// books: merged Goodreads books ({goodreadsId, mergedIds, members, shelf, rating}). Mutates nothing; returns
// {links: [{entry, title, book|null, how, pin}], favouritesOnly: [{entry, title, key}], warnings}.
export function matchFavourites(entries, books, map = {}) {
  const pins = Object.entries(map.pins ?? {});
  const notOn = Object.keys(map.notOnGoodreads ?? {});
  const warnings = [], links = [], favouritesOnly = [], used = new Set(), taken = new Map(), keys = new Set();
  const byId = new Map();
  for (const b of books) for (const id of [b.goodreadsId, ...b.mergedIds]) byId.set(id, b);

  for (const entry of entries) for (const t of entry.titles) {
    const f = fold(t.title);
    let book = null, how = null, pin = null;
    for (const [id, p] of pins) {
      if (fold(p.title) !== f) continue;
      if (byId.has(id)) { book = byId.get(id); pin = p; how = `pin ${id}`; used.add(id); break; }
      warnings.push(`pin ${id} ("${p.title}") is on no Goodreads shelf; falling back to title matching`);
      used.add(id);
    }
    if (!book && notOn.some(k => fold(k) === f)) how = 'not-on-goodreads';
    if (!book && !how) {
      const w = substackWork(t);
      const hits = books.filter(b => b.members.some(m => sameWorkStrict(w, workOf(m))));
      if (hits.length) { book = hits.sort(better)[0]; how = 'title'; }
      else { how = 'not-found'; warnings.push(`favourite "${t.title}" was not found on Goodreads; shown as favourites-only`); }
    }
    if (book && taken.has(book)) {
      warnings.push(`favourite "${t.title}" matched the same book as "${taken.get(book)}"; kept the first`);
      continue;
    }
    if (book) {
      taken.set(book, t.title);
      if (book.shelf === 'to-read') warnings.push(`favourite "${t.title}" is on to-read (gr ${book.goodreadsId}); move it to read on Goodreads`);
      links.push({entry, title: t, book, how, pin});
    } else {
      let key = slug(t.title) || entry.key;
      for (let n = 2; keys.has(key); n++) key = `${slug(t.title) || entry.key}-${n}`;
      keys.add(key);
      favouritesOnly.push({entry, title: t, key, how});
    }
  }
  for (const [id, p] of pins) if (!used.has(id)) warnings.push(`pin ${id} ("${p.title}") matched no favourite; safe to delete`);
  return {links, favouritesOnly, warnings};
}

export const favouriteObject = (entry, title) => ({
  tier: entry.tier, rank: entry.tier === 1 ? entry.rank : null, order: entry.order, position: entry.position,
  groupId: entry.key, score: entry.score ?? null, bylineHtml: title.bylineHtml, noteHtml: entry.noteHtml,
});
