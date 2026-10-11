// Committed data -> books.json (docs/CONTRACT.md "Catalog"). Pure and offline: the same code runs in sync (to
// know which covers and Open Library lookups are needed) and in the site build. Steps: normalise every shelf,
// attach cached Open Library facts, merge editions, attach favourites, add favourites-only books, drop hidden
// ones, walk the cover cache, assign slugs, sort, compute stats, then emit the public shape in a fixed key order.
import {join} from 'node:path';
import {readJson} from './json.mjs';
import {SHELVES} from './config.mjs';
import {sanitize, htmlToText} from './html.mjs';
import {isbn13to10} from './isbn.mjs';
import {normalizeGoodreads, splitTitle} from './normalize.mjs';
import {mergeRecords, mergeGroup} from './merge.mjs';
import {matchFavourites, favouriteObject} from './favourites.mjs';
import {olFacts} from './openlibrary.mjs';
import {coverCandidates, chooseCover, coverObject, PIPELINE} from './covers.mjs';
import {computeStats} from './stats.mjs';
import {fold, slug, sortKey, shortTitle, familyName, jaccard} from '../src/shared/normalize.js';

export const EMPTY_OVERRIDES = {covers: {}, sameWork: [], differentWork: [], hide: []};

export async function loadData(root = process.cwd()) {
  const d = p => join(root, 'data', p);
  const goodreads = {};
  for (const shelf of SHELVES) goodreads[shelf] = await readJson(d(`goodreads/${shelf}.json`), null);
  return {
    goodreads,
    substack: await readJson(d('substack/favourites.json'), null),
    wall: await readJson(d('wall.json'), {items: []}),
    openlibrary: await readJson(d('openlibrary.json'), {version: 1, entries: {}}),
    covers: await readJson(d('covers.json'), {pipeline: PIPELINE, entries: {}}),
    sync: await readJson(d('sync.json'), {syncedAt: null, sources: {}}),
    manual: {
      favouritesMap: await readJson(d('manual/favourites-map.json'), {pins: {}, notOnGoodreads: {}}),
      overrides: {...EMPTY_OVERRIDES, ...(await readJson(d('manual/overrides.json'), EMPTY_OVERRIDES))},
    },
  };
}

const SHELF_ORDER = ['read', 'currently-reading', 'did-not-finish', 'to-read', null];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const compareBooks = (a, b) => SHELF_ORDER.indexOf(a.shelf) - SHELF_ORDER.indexOf(b.shelf)
  || (a.dateAdded && b.dateAdded ? cmp(b.dateAdded, a.dateAdded) : a.dateAdded ? -1 : b.dateAdded ? 1 : 0)
  || cmp(sortKey(a.title), sortKey(b.title)) || cmp(a.id, b.id);

// A review is dropped when it repeats the favourite blurb (all three of his current reviews are copies).
export function duplicatesNote(reviewHtml, noteHtml) {
  if (!reviewHtml || !noteHtml) return false;
  const a = fold(htmlToText(reviewHtml)), b = fold(htmlToText(noteHtml));
  return !!a && !!b && (a.includes(b) || b.includes(a) || jaccard(a, b) >= 0.6);
}

// fold() keeps every script's letters (三体 stays 三体), but slugs are [a-z0-9-] (CONTRACT), so a title with
// no Latin letters falls back to "book-<id>".
const asciiSlug = s => slug(s).replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

export function assignSlugs(books) {
  const groups = new Map();
  for (const b of books) {
    const base = [asciiSlug(shortTitle(b.title)) || `book-${b.goodreadsId ?? b.id.replace(/^fav-/, '')}`, asciiSlug(familyName(b.authors[0]))]
      .filter(Boolean).join('-');
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(b);
  }
  const used = new Set(groups.keys());
  for (const [base, list] of groups) {
    // The oldest Goodreads id keeps the plain slug, so a newly added namesake never steals an existing URL.
    list.sort((a, b) => (a.goodreadsId ? 0 : 1) - (b.goodreadsId ? 0 : 1) || Number(a.goodreadsId ?? 0) - Number(b.goodreadsId ?? 0) || cmp(a.id, b.id));
    list.forEach((b, i) => {
      if (i === 0) { b.slug = base; return; }
      let s = b.goodreadsId ? `${base}-${b.goodreadsId}` : `${base}-2`;
      for (let n = 3; used.has(s); n++) s = `${base}-${n}`;
      used.add(s);
      b.slug = s;
    });
  }
}

// Internal assembly shared by buildCatalog, sync (cover candidates, Open Library targets) and explain.mjs.
export function assemble(data, config) {
  const ol = data.openlibrary?.entries ?? {};
  const overrides = {...EMPTY_OVERRIDES, ...(data.manual?.overrides ?? {})};
  const map = data.manual?.favouritesMap ?? {};
  const pinned = new Set(Object.keys(map.pins ?? {}));
  const warnings = [];

  const records = [];
  for (const shelf of config.goodreads.shelves) {
    for (const item of data.goodreads?.[shelf]?.items ?? []) {
      const r = normalizeGoodreads(item, shelf);
      Object.assign(r, olFacts(ol[r.goodreadsId]) ?? {olWork: null, olPages: null, olYear: null, editionCover: null, workCover: null});
      records.push(r);
    }
  }
  const {groups, reasons} = mergeRecords(records, {overrides});
  const books = groups.map(g => {
    const m = mergeGroup(g, {pinned});
    return {...m, id: `gr-${m.goodreadsId}`, ol: null, favourite: null, substackImage: null, matchedBy: null};
  });

  const entries = data.substack?.entries ?? [];
  const fav = matchFavourites(entries, books, map);
  warnings.push(...fav.warnings);
  for (const {entry, title, book, how, pin} of fav.links) {
    book.favourite = favouriteObject(entry, title);
    book.matchedBy = how;
    if (entry.tier === 1 && entry.image) book.substackImage = entry.image.url;
    if (pin?.useSubstackTitle) {
      // He logged a mislabelled edition (the Instaread summary, the "Live" typo): show his title and byline.
      const s = splitTitle(title.title, title.authors[0] ?? '');
      Object.assign(book, {title: s.title, subtitle: s.subtitle, series: null, authors: title.authors.length ? title.authors : book.authors});
    }
  }
  for (const {entry, title, key, how} of fav.favouritesOnly) {
    const s = splitTitle(title.title, title.authors[0] ?? '');
    const isbn13 = Object.entries(map.notOnGoodreads ?? {}).find(([k]) => fold(k) === fold(title.title))?.[1]?.isbn13 ?? null;
    const facts = olFacts(ol[`fav:${key}`]);
    books.push({
      id: `fav-${key}`, olKey: `fav:${key}`, goodreadsId: null, primary: null, members: [], mergedIds: [],
      shelf: null, rating: 0, avgRating: null, title: s.title, subtitle: s.subtitle, series: null,
      authors: title.authors.length ? title.authors : ['Unknown'], isbn13, isbn10: isbn13 ? isbn13to10(isbn13) : null,
      olWork: facts?.olWork ?? null, pages: facts?.olPages >= 40 ? facts.olPages : null, published: facts?.olYear ?? null,
      publishedSource: facts?.olYear != null ? 'openlibrary' : null, dateAdded: null, readAt: null, review: null,
      ol: facts, favourite: favouriteObject(entry, title), substackImage: entry.tier === 1 ? entry.image?.url ?? null : null, matchedBy: how,
    });
  }

  const hide = new Set((overrides.hide ?? []).map(String));
  const visible = books.filter(b => ![b.goodreadsId, ...b.mergedIds, b.id].some(id => id && hide.has(id)));

  const coverEntries = data.covers?.entries ?? {};
  for (const b of visible) {
    const html = b.review ? sanitize(b.review, {block: true}) : '';
    b.reviewHtml = html && !duplicatesNote(html, b.favourite?.noteHtml) ? html : null;
    b.candidates = coverCandidates(b, {overrides});
    const chosen = chooseCover(b.candidates, coverEntries);
    b.coverUrl = chosen?.url ?? null;
    b.cover = coverObject(b, chosen);
  }
  assignSlugs(visible);
  visible.sort(compareBooks);
  return {books: visible, records, reasons, warnings, hidden: books.length - visible.length};
}

const iso = v => (v ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

export function publicBook(b) {
  const c = b.cover;
  return {
    id: b.id, slug: b.slug, goodreadsId: b.goodreadsId ?? null,
    title: b.title, subtitle: b.subtitle ?? null, series: b.series ? {name: b.series.name, index: b.series.index ?? null} : null,
    authors: [...b.authors], shelf: b.shelf, rating: b.rating, avgRating: b.avgRating ?? null,
    pages: b.pages ?? null, published: b.published ?? null, dateAdded: b.dateAdded ?? null, readAt: b.readAt ?? null,
    isbn13: b.isbn13 ?? null, olWork: b.olWork ?? null, reviewHtml: b.reviewHtml ?? null,
    goodreadsUrl: b.goodreadsId ? `https://www.goodreads.com/book/show/${b.goodreadsId}` : null,
    cover: {...pick(c, ['stem', 'src', 'src2x', 'w', 'h', 'square', 'source']), colors: pick(c.colors, ['bg', 'spine', 'accent', 'ink', 'bgInk'])},
    favourite: b.favourite ? pick(b.favourite, ['tier', 'rank', 'order', 'position', 'groupId', 'score', 'bylineHtml', 'noteHtml']) : null,
    mergedIds: [...b.mergedIds],
  };
}

export function catalogFrom(assembled, data, config) {
  const {books} = assembled;
  const src = data.sync?.sources ?? {};
  const items = Object.fromEntries(SHELVES.map(s => [s, data.goodreads?.[s]?.count ?? data.goodreads?.[s]?.items?.length ?? 0]));
  return {
    version: 1,
    syncedAt: iso(data.sync?.syncedAt),
    sources: {
      goodreads: {profileUrl: `https://www.goodreads.com/user/show/${config.goodreads.userId}`, changedAt: iso(src.goodreads?.changedAt),
        failingSince: iso(src.goodreads?.failingSince), items},
      substack: {postUrl: data.substack?.postUrl ?? config.substack.postUrl, updatedAt: data.substack?.updatedAt ?? null,
        changedAt: iso(src.substack?.changedAt), failingSince: iso(src.substack?.failingSince)},
      wall: {changedAt: iso(src.wall?.changedAt), failingSince: iso(src.wall?.failingSince), count: data.wall?.items?.length ?? 0},
    },
    counts: {
      read: books.filter(b => b.shelf === 'read').length, reading: books.filter(b => b.shelf === 'currently-reading').length,
      dnf: books.filter(b => b.shelf === 'did-not-finish').length, toRead: books.filter(b => b.shelf === 'to-read').length,
      favourites: books.filter(b => b.favourite).length, favouritesOnly: books.filter(b => !b.goodreadsId).length,
    },
    stats: computeStats(books),
    books: books.map(publicBook),
  };
}

export const buildCatalog = (data, config) => catalogFrom(assemble(data, config), data, config);
