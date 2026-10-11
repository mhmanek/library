// Open Library enrichment for books not yet in the committed cache: work key (for merging and the recommend
// form), cover ids, median page count and first-publish year. It never supplies a title or author: its work
// titles are sometimes in the original language (三体, Πλάτων) or simply wrong ("Thing Which Has No Name" for
// Sutherland's Alchemy). Batched search.json queries at 1 request per second; hits are permanent, misses are
// retried after 90 days; a call that fails after its retries opens a circuit breaker for the rest of the run.
import {similarity, shortTitle, surnames, fold} from '../src/shared/normalize.js';

const SEARCH = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,subtitle,author_name,first_publish_year,number_of_pages_median,cover_i,id_goodreads,editions,editions.key,editions.cover_i,editions.isbn';

export const coverUrl = id => `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`;
export const workId = key => (/\/works\/(OL\d+W)$/.exec(key ?? '')?.[1] ?? null);
const today = now => new Date(now()).toISOString().slice(0, 10);
const intOrNull = v => (Number.isInteger(v) && v > 0 ? v : null);

export const searchUrl = (q, extra = '') => `${SEARCH}?q=${encodeURIComponent(q)}&fields=${FIELDS}&limit=100${extra}`;

// Which cached keys need a lookup: never seen, or a miss older than `retryDays` (any miss with refresh).
export function needsLookup(entry, {now, refresh, retryDays = 90}) {
  if (!entry) return true;
  if (!entry.miss) return false;
  if (refresh) return true;
  return (now() - Date.parse(entry.checked + 'T00:00:00Z')) / 864e5 >= retryDays;
}

function hitFrom(doc, edition, checked) {
  return {
    checked, work: doc.key ?? null, edition: edition?.key ?? null,
    editionCover: intOrNull(edition?.cover_i), workCover: intOrNull(doc.cover_i),
    pages: intOrNull(doc.number_of_pages_median), year: Number.isInteger(doc.first_publish_year) && doc.first_publish_year !== 0 ? doc.first_publish_year : null,
  };
}

// Maps one search response back onto targets: an edition whose ISBNs include ours is a full hit; a work whose
// id_goodreads includes our id is a work-level hit.
export function matchDocs(docs, targets, checked, {byIsbn = true, byGoodreads = true} = {}) {
  const hits = new Map();
  // Edition hits first across all docs: they carry the exact edition's cover, so they beat a work-level hit.
  if (byIsbn) for (const doc of docs ?? []) for (const ed of doc.editions?.docs ?? []) {
    const isbns = new Set(ed.isbn ?? []);
    for (const t of targets) if (!hits.has(t.key) && (isbns.has(t.isbn13) || isbns.has(t.isbn10))) hits.set(t.key, hitFrom(doc, ed, checked));
  }
  if (byGoodreads) for (const doc of docs ?? []) {
    const gr = new Set(doc.id_goodreads ?? []);
    for (const t of targets) if (t.goodreadsId && !hits.has(t.key) && gr.has(t.goodreadsId)) hits.set(t.key, hitFrom(doc, null, checked));
  }
  return hits;
}

const chunk = (list, n) => Array.from({length: Math.ceil(list.length / n)}, (_, i) => list.slice(i * n, i * n + n));

// targets: [{key, goodreadsId|null, isbn10, isbn13, title, authors}]. Returns {cache, stats, circuitOpen}.
// Only keys whose every pass ran are recorded as misses, so an outage or a spent budget never caches a miss.
export async function enrichOpenLibrary(targets, cache, {http, now = Date.now, refresh = false, budget = 200, retryDays = 90, log = () => {}}) {
  const entries = {...(cache?.entries ?? {})};
  const checked = today(now);
  const todo = targets.filter(t => needsLookup(entries[t.key], {now, refresh, retryDays}));
  const stats = {wanted: todo.length, requests: 0, hits: 0, misses: 0, deferred: 0};
  let circuitOpen = false;
  const open = new Set(todo.map(t => t.key));
  const record = hits => { for (const [k, v] of hits) if (open.has(k)) { entries[k] = v; open.delete(k); stats.hits++; } };
  const query = async url => {
    if (circuitOpen) return null;
    try { stats.requests++; return (await http.get(url, {kind: 'json'})).json(); }
    catch (err) { circuitOpen = true; log(`openlibrary: circuit open after ${err.code ?? err.message}`); return null; }
  };
  const pending = () => todo.filter(t => open.has(t.key));
  let singlesLeft = budget;
  const unfinished = new Set();

  // 1. ISBN batches of 50 books (both forms, up to 100 ISBNs per query).
  for (const batch of chunk(pending().filter(t => t.isbn13 || t.isbn10), 50)) {
    const isbns = [...new Set(batch.flatMap(t => [t.isbn13, t.isbn10].filter(Boolean)))];
    const json = await query(searchUrl(`isbn:(${isbns.join(' OR ')})`));
    if (json) record(matchDocs(json.docs, batch, checked));
  }
  // 2. Goodreads-id batches of 100 for whatever is still open.
  for (const batch of chunk(pending().filter(t => t.goodreadsId), 100)) {
    const json = await query(searchUrl(`id_goodreads:(${batch.map(t => t.goodreadsId).join(' OR ')})`));
    if (json) record(matchDocs(json.docs, batch, checked, {byIsbn: false}));
  }
  // 3. Single ISBN queries: a batch returns one edition per work, so two of our editions of one work need these.
  for (const t of pending().filter(t => t.isbn13 || t.isbn10)) {
    if (circuitOpen) break;
    if (singlesLeft <= 0) { unfinished.add(t.key); continue; }
    singlesLeft--;
    const json = await query(searchUrl(`isbn:${t.isbn13 ?? t.isbn10}`));
    if (json) record(matchDocs(json.docs, [t], checked));
  }
  // 4. Favourites-only books without an ISBN: title + author, accepted only on a close title and a shared surname.
  for (const t of pending().filter(t => !t.goodreadsId && !t.isbn13 && !t.isbn10 && t.title)) {
    if (circuitOpen) break;
    const url = `${SEARCH}?title=${encodeURIComponent(t.title)}&author=${encodeURIComponent(t.authors?.[0] ?? '')}&fields=${FIELDS}&limit=5`;
    const json = await query(url);
    const doc = json?.docs?.[0];
    // With a subtitle the whole title must match: "Totto-chan: The Sequel" must not take the original's cover.
    const full = t.title.includes(': ');
    const theirs = full ? fold([doc?.title, doc?.subtitle].filter(Boolean).join(': ')) : shortTitle(doc?.title);
    if (doc && similarity(theirs, full ? fold(t.title) : shortTitle(t.title)) >= 0.9 && surnames(doc.author_name ?? []).some(s => surnames(t.authors).includes(s))) {
      record(new Map([[t.key, hitFrom(doc, doc.editions?.docs?.[0] ?? null, checked)]]));
    }
  }
  if (!circuitOpen) {
    for (const t of pending()) {
      if (unfinished.has(t.key)) { stats.deferred++; continue; }
      entries[t.key] = {checked, miss: true};
      stats.misses++;
    }
  } else stats.deferred = pending().length;
  return {cache: {version: 1, entries}, stats, circuitOpen};
}

// The cache entry for a target, flattened for normalisation (null for misses and unknowns).
export function olFacts(entry) {
  if (!entry || entry.miss) return null;
  return {olWork: workId(entry.work), olPages: entry.pages ?? null, olYear: entry.year ?? null,
    editionCover: entry.editionCover ?? null, workCover: entry.workCover ?? null};
}
