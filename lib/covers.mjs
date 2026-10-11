// Cover pipeline. Candidates in order: a manual override, the image he chose in the Substack post (tier 1),
// the Goodreads original for each edition (size suffix stripped; suffixes only ever downscale), the Open Library
// edition cover, the work cover, then a typographic placeholder drawn by the site. Accepted images become
// 200/400-wide WebP files named by content hash, committed under covers/. data/covers.json remembers every
// verdict per source URL so a cover is downloaded, checked and coloured exactly once.
import {createHash} from 'node:crypto';
import {mkdir, readdir, rm, writeFile, access} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {extractColors, placeholderColors} from './colors.mjs';
import {coverUrl} from './openlibrary.mjs';

export const PIPELINE = 1; // bumping this renames every file (the hash covers it) and re-encodes from .cache/originals

const NOPHOTO = /\/(?:assets\/)?nophoto\//i;
export function goodreadsOriginal(url) {
  if (!url || NOPHOTO.test(url)) return null;
  return url.replace(/\._[^/]*_(?=\.(?:jpe?g|png)$)/i, '');
}
// The ._SX400_ rendition is only worth trying when the original failed with an HTTP error.
export const sx400 = original => original.replace(/(\.(?:jpe?g|png))$/i, '._SX400_$1');

// book: {id, members: [{image, editionCover, workCover}], substackImage, overrideKey}
export function coverCandidates(book, {overrides = {}} = {}) {
  const out = [], seen = new Set();
  const add = c => { if (c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); } };
  const keys = [book.goodreadsId, ...(book.mergedIds ?? []), book.id].filter(Boolean);
  for (const k of keys) if (overrides.covers?.[k]) add({source: 'override', url: overrides.covers[k]});
  if (book.substackImage) add({source: 'substack', url: book.substackImage});
  for (const m of book.members ?? []) {
    const orig = goodreadsOriginal(m.image);
    if (orig) { add({source: 'goodreads', url: orig}); add({source: 'goodreads', url: sx400(orig), after: orig}); }
  }
  const ols = [...(book.members ?? []), book.ol].filter(Boolean);
  for (const m of ols) if (m.editionCover) add({source: 'openlibrary', url: coverUrl(m.editionCover)});
  for (const m of ols) if (m.workCover) add({source: 'openlibrary', url: coverUrl(m.workCover)});
  return out;
}

const httpFailed = e => e?.s === 'bad' && /^http-/.test(e.why);
const usable = (c, entries) => !c.after || httpFailed(entries[c.after]);

// The walk shared by sync and build: the first candidate whose cached entry is ok wins.
export function chooseCover(candidates, entries = {}) {
  for (const c of candidates) if (usable(c, entries) && entries[c.url]?.s === 'ok') return {...c, entry: entries[c.url]};
  return null;
}

export function coverObject(book, chosen) {
  if (!chosen) return {stem: null, src: null, src2x: null, w: 400, h: 600, square: false, source: 'placeholder', colors: placeholderColors(book.id)};
  const e = chosen.entry;
  return {stem: e.hash, src: `covers/${e.hash}-200.webp`, src2x: `covers/${e.hash}-400.webp`, w: e.w, h: e.h,
    square: !!e.square, source: chosen.source, colors: {...e.colors}};
}

export async function checkImage(buf) {
  if (buf.length < 1000) return {ok: false, why: 'tiny'}; // the 43-byte transparent GIF
  let meta;
  try { meta = await sharp(buf, {failOn: 'none'}).metadata(); } catch { return {ok: false, why: 'decode'}; }
  if (meta.format === 'gif') return {ok: false, why: 'gif'};
  let {width: w, height: h} = meta;
  if (meta.orientation >= 5) [w, h] = [h, w];
  if (!w || !h) return {ok: false, why: 'decode'};
  if (w < 180) return {ok: false, why: 'small'};
  const r = w / h;
  const square = r >= 0.92 && r <= 1.08; // audiobook art, allowed and flagged
  if (!square && !(r >= 0.45 && r < 0.92)) return {ok: false, why: 'aspect'};
  try {
    const {channels} = await sharp(buf, {failOn: 'none'}).stats();
    if (channels.slice(0, 3).every(c => c.stdev < 4)) return {ok: false, why: 'blank'};
  } catch { return {ok: false, why: 'decode'}; }
  return {ok: true, square, format: meta.format};
}

export const coverHash = buf => createHash('sha256').update(`cover-v${PIPELINE}\n`).update(buf).digest('hex').slice(0, 16);
const exists = p => access(p).then(() => true, () => false);

export async function processImage(buf, {dir, originalsDir, format = 'jpg'}) {
  const hash = coverHash(buf);
  await mkdir(dir, {recursive: true});
  let size = null;
  for (const width of [200, 400]) {
    const {data, info} = await sharp(buf, {failOn: 'none'}).rotate().flatten({background: '#ffffff'})
      .resize({width, withoutEnlargement: true}).webp({quality: 78, effort: 5, smartSubsample: true}).toBuffer({resolveWithObject: true});
    const path = join(dir, `${hash}-${width}.webp`);
    if (!(await exists(path))) await writeFile(path, data);
    if (width === 400) size = {w: info.width, h: info.height};
  }
  if (originalsDir) {
    await mkdir(originalsDir, {recursive: true});
    const p = join(originalsDir, `${hash}.${format === 'jpeg' ? 'jpg' : format}`);
    if (!(await exists(p))) await writeFile(p, buf);
  }
  return {hash, ...size};
}

// One source URL -> a cache entry. Transient failures count up and become bad/retries at 3.
export async function fetchCover(url, prev, {http, dir, originalsDir}) {
  let res;
  try { res = await http.get(url, {kind: 'image', attempts: 2, backoff: [3000]}); }
  catch (err) {
    if (err.code === 'too-large') return {s: 'bad', why: 'large'};
    if (err.status >= 400 && err.status < 500 && ![408, 425, 429].includes(err.status)) return {s: 'bad', why: `http-${err.status}`};
    const n = (prev?.s === 'err' ? prev.n : 0) + 1;
    return n >= 3 ? {s: 'bad', why: 'retries'} : {s: 'err', n};
  }
  const check = await checkImage(res.bytes);
  if (!check.ok) return {s: 'bad', why: check.why};
  try {
    const {hash, w, h} = await processImage(res.bytes, {dir, originalsDir, format: check.format});
    const colors = await extractColors(res.bytes);
    return {s: 'ok', hash, w, h, square: check.square, colors};
  } catch { return {s: 'bad', why: 'decode'}; }
}

// Priority: tier-1 favourites, read, favourites-only, currently reading, did not finish, then to-read newest first.
export function coverPriority(books) {
  const tier = b => (b.favourite?.tier === 1 ? 0 : b.shelf === 'read' ? 1 : b.shelf === null ? 2 : b.shelf === 'currently-reading' ? 3 : b.shelf === 'did-not-finish' ? 4 : 5);
  return [...books].sort((a, b) => tier(a) - tier(b) || (a.favourite?.rank ?? 0) - (b.favourite?.rank ?? 0)
    || (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || (a.id < b.id ? -1 : 1));
}

// Fetches err/unknown candidates above each book's current winner while budget and time remain.
export async function ensureCovers(books, cache, {http, dir, originalsDir, maxNew = 120, deadline = Infinity, refresh = false,
  dryRun = false, now = Date.now, concurrency = 4, log = () => {}}) {
  const entries = {...(cache?.entries ?? {})};
  if (refresh) for (const [u, e] of Object.entries(entries)) if (httpFailed(e) || e.s === 'err') delete entries[u];
  const stats = {fetched: 0, ok: 0, bad: 0, err: 0, pending: 0, wouldFetch: 0};
  let budget = maxNew;
  const inflight = new Map();
  const queue = coverPriority(books);
  const fetchOnce = url => {
    if (!inflight.has(url)) inflight.set(url, fetchCover(url, entries[url], {http, dir, originalsDir}).then(e => { entries[url] = e; stats[e.s]++; return e; }));
    return inflight.get(url);
  };
  async function walk(book) {
    for (const c of book.candidates) {
      if (!usable(c, entries)) continue;
      const e = entries[c.url];
      if (e?.s === 'ok') return;
      if (e?.s === 'bad') continue;
      if (dryRun) { stats.wouldFetch++; return; }
      if (budget <= 0 || now() > deadline) { stats.pending++; return; }
      budget--;
      stats.fetched++;
      const r = await fetchOnce(c.url);
      if (r.s === 'ok') return;
    }
  }
  const workers = Array.from({length: concurrency}, async () => { while (queue.length) await walk(queue.shift()); });
  await Promise.all(workers);
  if (stats.fetched) log(`covers: fetched ${stats.fetched} (ok ${stats.ok}, bad ${stats.bad}, err ${stats.err}), pending ${stats.pending}`);
  return {cache: {pipeline: PIPELINE, entries}, stats};
}

// Keeps ok entries some book chose and bad/err entries that are still candidates; deletes unreferenced WebP files.
export async function gcCovers(cache, books, dir, {dryRun = false} = {}) {
  const chosen = new Set(books.map(b => b.coverUrl).filter(Boolean));
  const candidates = new Set(books.flatMap(b => b.candidates.map(c => c.url)));
  const entries = {};
  for (const [url, e] of Object.entries(cache.entries)) {
    if (e.s === 'ok' ? chosen.has(url) : candidates.has(url)) entries[url] = e;
  }
  const keep = new Set(Object.values(entries).filter(e => e.s === 'ok').map(e => e.hash));
  const removed = [];
  let files = [];
  try { files = await readdir(dir); } catch { /* no covers yet */ }
  for (const f of files) {
    const m = /^([0-9a-f]{16})-(?:200|400)\.webp$/.exec(f);
    if (m && !keep.has(m[1])) { removed.push(f); if (!dryRun) await rm(join(dir, f)); }
  }
  return {cache: {pipeline: PIPELINE, entries}, removed};
}
