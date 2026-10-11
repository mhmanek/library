// Goodreads shelf RSS: the only unauthenticated list source left (HTML lists went behind login in Sep 2026).
// Each shelf is fetched page by page until an empty page, validated hard, and only then replaces the last good
// snapshot. A failing shelf keeps its previous copy; there is never a partial shelf.
import {XMLParser} from 'fast-xml-parser';
import {decodeEntities} from './html.mjs';
import {cleanIsbn} from './isbn.mjs';
import {HttpError} from './http.mjs';

export class FeedError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

export const EXCLUSIVE = ['read', 'currently-reading', 'did-not-finish', 'to-read'];

export const feedUrl = (cfg, shelf, page) =>
  `https://www.goodreads.com/review/list_rss/${cfg.userId}?shelf=${encodeURIComponent(shelf)}&per_page=${cfg.perPage}&page=${page}&sort=${cfg.sort ?? 'date_added'}`;

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_',
  parseTagValue: false,     // keeps ISBN leading zeros; a title "1984" stays a string
  parseAttributeValue: false, trimValues: true, processEntities: true, htmlEntities: true,
  isArray: (name, jpath) => jpath === 'rss.channel.item',
});

const text = v => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const collapse = s => s.replace(/\s+/g, ' ').trim();
// Entities inside CDATA are not decoded by the XML parser; decode again only where one is visibly left.
const clean = v => { const s = text(v); return collapse(/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s) ? decodeEntities(s) : s); };

const MONTHS = {jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'};

// "Sat, 5 Oct 2024 00:00:00 +0000" -> "2024-10-05". Literal: no Date objects, no time-zone maths
// (converting read_at to US time would shift The Great Revival a day).
export function literalDate(s) {
  const m = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* (\d{4})/i.exec(text(s));
  return m ? `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}` : null;
}

// "Thu, 02 Jul 2026 20:31:19 -0700" -> "2026-07-02T20:31:19-07:00"
export function literalDateTime(s) {
  const d = literalDate(s);
  const m = /(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2}):?(\d{2})/.exec(text(s));
  return d && m ? `${d}T${m[1]}:${m[2]}:${m[3]}${m[4]}${m[5]}:${m[6]}` : d;
}

const int = v => { const s = text(v).trim(); return /^-?\d+$/.test(s) && Number(s) !== 0 ? Number(s) : null; };
const num2 = v => { const n = parseFloat(text(v)); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

export function toItem(raw) {
  const isbn = cleanIsbn(text(raw.isbn));
  return {
    bookId: text(raw.book_id).trim(),
    title: clean(raw.title),
    author: clean(raw.author_name),
    isbn: isbn || null,
    pages: int(raw.book?.num_pages),
    published: int(raw.book_published),
    rating: num2(raw.user_rating) ?? 0,      // quarter stars since 5 Oct 2026
    avgRating: num2(raw.average_rating),
    readAt: literalDate(raw.user_read_at),
    addedAt: literalDateTime(raw.user_date_added),
    shelves: text(raw.user_shelves).split(',').map(s => s.trim()).filter(Boolean).sort(),
    review: text(raw.user_review).trim() || null,
    image: text(raw.book_large_image_url).trim() || null,
    userName: clean(raw.user_name),          // validation only; not stored
  };
}

export function parseFeed(xml) {
  let doc;
  try { doc = parser.parse(xml); } catch (err) { throw new FeedError('parse', `XML parse failed: ${err.message}`); }
  const channel = doc?.rss?.channel;
  if (!channel || typeof channel !== 'object') throw new FeedError('parse', 'no rss channel');
  return {channelTitle: clean(channel.title), items: (channel.item ?? []).map(toItem)};
}

// A 200 that is not RSS (the "Sorry, not available right now" pages of Dec 2025) is retried.
export function validateResponse(res) {
  const type = res.headers.get('content-type') ?? '';
  const head = res.bytes.subarray(0, 200).toString('utf8').replace(/^﻿/, '').trimStart();
  if (!/xml/i.test(type) || !/^(<\?xml|<rss)/.test(head)) throw new HttpError('not-rss', `200 but not RSS (${type || 'no content-type'})`, {retriable: true});
}

const straight = s => s.replace(/[‘’ʼ′]/g, "'");

export function validatePage(feed, shelf, cfg) {
  // An invalid shelf name silently returns ALL books but still says "read"; requested shelves are checked too.
  if (straight(feed.channelTitle) !== `${straight(cfg.ownerName)}'s bookshelf: ${shelf}`) {
    throw new FeedError('channel-title', `channel title "${feed.channelTitle}" is not "${cfg.ownerName}'s bookshelf: ${shelf}"`);
  }
  for (const it of feed.items) {
    if (!/^\d+$/.test(it.bookId) || !it.title || !it.author) throw new FeedError('item-schema', `item ${it.bookId || '?'} lacks a book id, title or author`);
    if (it.userName !== cfg.ownerName) throw new FeedError('item-owner', `item ${it.bookId} belongs to "${it.userName}"`);
    const exclusive = it.shelves.filter(s => EXCLUSIVE.includes(s));
    const ok = shelf === 'read' ? exclusive.length === 0 : exclusive.length === 1 && exclusive[0] === shelf;
    if (!ok) throw new FeedError('shelf-mismatch', `item ${it.bookId} on "${shelf}" lists shelves [${it.shelves.join(', ')}]`);
  }
}

export function validateShelf(items, shelf, prev, {maxDropFraction = 0.2, maxDropFloor = 5, allowDrop = false} = {}) {
  if (!prev || allowDrop) return;
  const drop = prev.count - items.length;
  if (drop > Math.max(maxDropFloor, maxDropFraction * prev.count)) {
    throw new FeedError('drop', `${shelf} fell from ${prev.count} to ${items.length}; rerun with allow_drop if that was deliberate`);
  }
}

const STORED = ['bookId', 'title', 'author', 'isbn', 'pages', 'published', 'rating', 'avgRating', 'readAt', 'addedAt', 'shelves', 'review', 'image'];
const store = it => Object.fromEntries(STORED.map(k => [k, it[k]]));
export const sameItems = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Returns {snapshot, unchanged, changed, requests}. Throws FeedError/HttpError; the caller keeps the last good copy.
export async function fetchShelf(shelf, prev, {http, cfg, sync = {}, allowDrop = false}) {
  const get = (page, headers) => http.get(feedUrl(cfg, shelf, page), {kind: 'rss', headers, validate: r => r.status === 304 || validateResponse(r)});
  const early = new Map(); // bodies already fetched on the fast path, reused by the full fetch
  let requests = 0;

  // Fast path: every known page answers 304 -> nothing changed, nothing rewritten.
  if (prev?.etags?.length && prev.etags.every(Boolean)) {
    let all304 = true;
    for (let page = 1; page <= prev.etags.length; page++) {
      const res = await get(page, {'If-None-Match': prev.etags[page - 1]});
      requests++;
      if (res.status !== 304) { early.set(page, res); all304 = false; break; }
    }
    if (all304) return {snapshot: prev, unchanged: true, changed: false, requests};
  }

  const byId = new Map(), etags = [];
  let channelTitle = null;
  for (let page = 1; ; page++) {
    if (page > (cfg.maxPages ?? 20)) throw new FeedError('pagination', `${shelf} did not end within ${cfg.maxPages} pages`);
    let res = early.get(page);
    if (!res) { res = await get(page); requests++; }
    if (res.status === 304) throw new FeedError('pagination', `unexpected 304 on page ${page}`);
    const feed = parseFeed(res.text());
    validatePage(feed, shelf, cfg);
    channelTitle = feed.channelTitle;
    etags.push(res.headers.get('etag'));
    if (!feed.items.length) break;
    const before = byId.size;
    for (const it of feed.items) byId.set(it.bookId, store(it));
    if (byId.size === before) throw new FeedError('pagination', `${shelf} page ${page} repeated earlier items`);
  }
  const items = [...byId.values()].sort((a, b) => Number(a.bookId) - Number(b.bookId));
  validateShelf(items, shelf, prev, {maxDropFraction: sync.maxDropFraction, maxDropFloor: sync.maxDropFloor, allowDrop});
  const changed = !prev || !sameItems(prev.items, items) || prev.channelTitle !== channelTitle;
  // ETags move only with the items: a description edit changes the ETag but nothing we store, and committing
  // that would be noise. Later runs then simply fall back to full fetches until a real change.
  const snapshot = {shelf, channelTitle, count: items.length, etags: changed ? etags : prev.etags, items};
  return {snapshot, unchanged: false, changed, requests};
}

// All configured shelves, in order. Per shelf: success replaces the snapshot, failure keeps the previous one.
export async function syncGoodreads(prev, {http, config, allowDrop = false, log = () => {}}) {
  const snapshots = {}, shelves = {};
  for (const shelf of config.goodreads.shelves) {
    try {
      const r = await fetchShelf(shelf, prev?.[shelf] ?? null, {http, cfg: config.goodreads, sync: config.sync, allowDrop});
      snapshots[shelf] = r.snapshot;
      shelves[shelf] = {ok: true, changed: r.changed, unchanged: r.unchanged, count: r.snapshot.count, requests: r.requests};
      log(`goodreads ${shelf}: ${r.snapshot.count} items${r.unchanged ? ' (304)' : r.changed ? ' (changed)' : ''}`);
    } catch (err) {
      snapshots[shelf] = prev?.[shelf] ?? null;
      shelves[shelf] = {ok: false, changed: false, count: prev?.[shelf]?.count ?? null, error: {code: err.code ?? 'crash', message: err.message}};
      log(`goodreads ${shelf}: FAILED ${err.code ?? ''} ${err.message}`);
    }
  }
  const failed = Object.entries(shelves).filter(([, s]) => !s.ok);
  return {
    ok: !failed.length, snapshots, shelves,
    changed: Object.values(shelves).some(s => s.changed),
    error: failed.length ? {code: failed[0][1].error.code, message: failed.map(([k, s]) => `${k}: ${s.error.code}`).join('; ')} : null,
  };
}
