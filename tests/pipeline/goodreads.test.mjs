// Goodreads RSS: parsing real feed quirks, validation traps, pagination, ETags, retries and last-good per shelf.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed, validatePage, validateShelf, validateResponse, fetchShelf, syncGoodreads, literalDate, literalDateTime, feedUrl} from '../../lib/goodreads.mjs';
import {createHttp, BACKOFF} from '../../lib/http.mjs';
import {fixture, fakeFetch, fakeClock, xmlResponse, testConfig} from './helpers.mjs';

const cfg = testConfig();
const read = parseFeed(await fixture('goodreads/read-sample.xml'));
const byId = id => read.items.find(i => i.bookId === id);

test('parse: real read-shelf quirks', async () => {
  assert.equal(read.channelTitle, "Malhar's bookshelf: read");
  assert.equal(byId('212959736').title, "Lucas' wars", 'entity outside CDATA decodes');
  assert.equal(byId('30292').published, -385, 'Plato is BCE');
  assert.equal(byId('150713547').isbn, null, 'empty isbn');
  assert.match(byId('150713547').image, /nophoto/);
  assert.equal(byId('629').isbn, '0060589469', 'leading zero kept');
  assert.equal(byId('137893498').rating, 4.75, 'quarter-star rating parses as a float');
  assert.equal(byId('137893498').readAt, '2025-10-04', 'unpadded day');
  assert.equal(byId('60321447').author, 'Chris Miller', 'runs of spaces collapse');
  assert.match(byId('24113').addedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/);
  assert.deepEqual(byId('24113').shelves, [], 'read items carry no shelf name');
  assert.match(byId('26210508').review, /<script>/, 'raw review kept for the sanitizer');
  assert.equal(byId('137252761').title, 'Buffett: The Making of an American Capitalist by Roger Lowenstein(2008-04-29)');
  assert.ok(read.items.every(i => typeof i.title === 'string' && i.userName === 'Malhar'));
  const toRead = parseFeed(await fixture('goodreads/to-read-p1.xml'));
  assert.equal(toRead.items.find(i => i.bookId === '40961427').title, '1984', 'a numeric title stays a string');
  const dnf = parseFeed(await fixture('goodreads/did-not-finish.xml'));
  assert.ok(dnf.items.some(i => i.title === 'Tinker, Tailor, Soldier, Spy (George Smiley, #5; Karla Trilogy, #1)'));
  assert.deepEqual(parseFeed(await fixture('goodreads/currently-reading-empty.xml')).items, [], 'an empty shelf is a valid empty array');
});

test('literal dates never shift time zones', () => {
  assert.equal(literalDate('Sat, 5 Oct 2024 00:00:00 +0000'), '2024-10-05');
  assert.equal(literalDateTime('Thu, 02 Jul 2026 20:31:19 -0700'), '2026-07-02T20:31:19-07:00');
  assert.equal(literalDate(''), null);
});

test('validation catches the real traps', async () => {
  assert.doesNotThrow(() => validatePage(read, 'read', cfg.goodreads));
  const wrong = parseFeed(await fixture('goodreads/all-books-wrong-title.xml'));
  assert.throws(() => validatePage(wrong, 'read', cfg.goodreads), {code: 'channel-title'});
  const mixed = parseFeed(await fixture('goodreads/invalid-shelf-mixed.xml'));
  assert.throws(() => validatePage(mixed, 'read', cfg.goodreads), {code: 'shelf-mismatch'}, 'an invalid shelf name returns every book, titled "read"');
  const toRead = parseFeed(await fixture('goodreads/to-read-p1.xml'));
  assert.doesNotThrow(() => validatePage(toRead, 'to-read', cfg.goodreads));
  assert.throws(() => validatePage({...toRead, channelTitle: "Malhar's bookshelf: to-read", items: [{...toRead.items[0], shelves: ['to-read', 'did-not-finish']}]}, 'to-read', cfg.goodreads), {code: 'shelf-mismatch'});
  assert.throws(() => validatePage({...read, items: [{...read.items[0], shelves: ['to-read']}]}, 'read', cfg.goodreads), {code: 'shelf-mismatch'});
  assert.doesNotThrow(() => validatePage({...toRead, items: [{...toRead.items[0], shelves: ['favourites', 'to-read']}]}, 'to-read', cfg.goodreads), 'tags are tolerated');
  assert.throws(() => validatePage({...read, items: [{...read.items[0], userName: 'Otis'}]}, 'read', cfg.goodreads), {code: 'item-owner'});
  assert.throws(() => validatePage({...read, items: [{...read.items[0], bookId: ''}]}, 'read', cfg.goodreads), {code: 'item-schema'});
  assert.doesNotThrow(() => validatePage({...read, channelTitle: 'Malhar’s bookshelf: read'}, 'read', cfg.goodreads), 'curly apostrophe');
});

test('drop guard: max(5, 20%) with allowDrop override', () => {
  const items = n => Array.from({length: n}, (_, i) => ({bookId: String(i)}));
  assert.throws(() => validateShelf(items(120), 'read', {count: 169}), {code: 'drop'});
  assert.doesNotThrow(() => validateShelf(items(140), 'read', {count: 169}));
  assert.doesNotThrow(() => validateShelf(items(0), 'did-not-finish', {count: 3}), 'the floor protects small shelves');
  assert.doesNotThrow(() => validateShelf(items(120), 'read', {count: 169}, {allowDrop: true}));
  assert.doesNotThrow(() => validateShelf(items(1), 'read', null), 'no drop check on the first run');
});

test('a 200 that is not RSS is retriable', async () => {
  const html = await fixture('goodreads/html-error.html');
  const res = {status: 200, headers: new Headers({'content-type': 'text/html'}), bytes: Buffer.from(html)};
  assert.throws(() => validateResponse(res), e => e.code === 'not-rss' && e.retriable);
});

const pageRoutes = (pages, {etags = []} = {}) => [[u => u.includes('list_rss'), (u, init) => {
  const page = Number(new URL(u).searchParams.get('page'));
  const tag = etags[page - 1];
  if (tag && init.headers?.['If-None-Match'] === tag) return xmlResponse(null, {status: 304, etag: tag});
  return xmlResponse(pages[page - 1] ?? pages.at(-1), {etag: tag});
}]];

test('fetch: pagination to the empty page, union sorted by id, ETags only move with items', async () => {
  const pages = [await fixture('goodreads/to-read-p1.xml'), await fixture('goodreads/to-read-p2.xml'), await fixture('goodreads/to-read-p3-empty.xml')];
  const clock = fakeClock();
  const etags = ['W/"a"', 'W/"b"', 'W/"c"'];
  const f = fakeFetch(pageRoutes(pages, {etags}));
  const http = createHttp({userAgent: cfg.sync.userAgent, fetchImpl: f, ...clock});
  const g = {...cfg.goodreads, perPage: 3};
  const r = await fetchShelf('to-read', null, {http, cfg: g, sync: cfg.sync});
  assert.equal(r.snapshot.count, 6);
  assert.deepEqual(r.snapshot.items.map(i => i.bookId), ['18194', '24280', '231804', '1118485', '6648041', '40961427']);
  assert.deepEqual(r.snapshot.etags, etags);
  assert.ok(!('userName' in r.snapshot.items[0]), 'validation-only fields are not stored');
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(c => c.headers['User-Agent'] === cfg.sync.userAgent), 'UA always sent');
  assert.match(f.calls[0].url, /shelf=to-read&per_page=3&page=1&sort=date_added/);
  assert.ok(clock.sleeps.every(ms => ms >= 1400), 'Goodreads requests are spaced out');

  // All pages 304 -> the previous snapshot is reused untouched.
  const f2 = fakeFetch(pageRoutes(pages, {etags}));
  const r2 = await fetchShelf('to-read', r.snapshot, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f2, ...fakeClock()}), cfg: g, sync: cfg.sync});
  assert.equal(r2.unchanged, true);
  assert.equal(r2.snapshot, r.snapshot);

  // New ETags but the same items: nothing changes, old ETags kept (no noise commit).
  const f3 = fakeFetch(pageRoutes(pages, {etags: ['W/"x"', 'W/"y"', 'W/"z"']}));
  const r3 = await fetchShelf('to-read', r.snapshot, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f3, ...fakeClock()}), cfg: g, sync: cfg.sync});
  assert.equal(r3.changed, false);
  assert.deepEqual(r3.snapshot.etags, etags);

  // A page that repeats earlier items fails pagination, as does running past maxPages.
  const f4 = fakeFetch(pageRoutes([pages[0], pages[0], pages[2]]));
  await assert.rejects(fetchShelf('to-read', null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f4, ...fakeClock()}), cfg: g, sync: cfg.sync}), {code: 'pagination'});
  const f5 = fakeFetch(pageRoutes([pages[0], pages[1], pages[2]]));
  await assert.rejects(fetchShelf('to-read', null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f5, ...fakeClock()}), cfg: {...g, maxPages: 1}, sync: cfg.sync}), {code: 'pagination'});
});

test('retries: 503, 503, 200 succeeds with backoff; Retry-After honoured and capped; 403 not retried', async () => {
  const xml = await fixture('goodreads/currently-reading-empty.xml');
  const clock = fakeClock();
  const f = fakeFetch([[() => true, (u, i, n) => (n <= 2 ? new Response('busy', {status: 503}) : xmlResponse(xml))]]);
  const http = createHttp({userAgent: 'x-agent/1', fetchImpl: f, ...clock, random: () => 0.5});
  const r = await fetchShelf('currently-reading', null, {http, cfg: cfg.goodreads, sync: cfg.sync});
  assert.equal(r.snapshot.count, 0);
  assert.equal(f.calls.length, 3);
  assert.ok(clock.sleeps.includes(BACKOFF[0]) && clock.sleeps.includes(BACKOFF[1]), `backoff delays recorded: ${clock.sleeps}`);

  const c2 = fakeClock();
  const f2 = fakeFetch([[() => true, (u, i, n) => (n === 1 ? new Response('', {status: 429, headers: {'retry-after': '600'}}) : xmlResponse(xml))]]);
  await fetchShelf('currently-reading', null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f2, ...c2}), cfg: cfg.goodreads, sync: cfg.sync});
  assert.ok(c2.sleeps.includes(120_000), `Retry-After capped at 120 s: ${c2.sleeps}`);

  const f3 = fakeFetch([[() => true, () => new Response('blocked', {status: 403})]]);
  await assert.rejects(fetchShelf('read', null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f3, ...fakeClock()}), cfg: cfg.goodreads, sync: cfg.sync}), {code: 'http-403'});
  assert.equal(f3.calls.length, 1);

  const html = await fixture('goodreads/html-error.html');
  const f4 = fakeFetch([[() => true, () => new Response(html, {status: 200, headers: {'content-type': 'text/html'}})]]);
  await assert.rejects(fetchShelf('read', null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f4, ...fakeClock()}), cfg: cfg.goodreads, sync: cfg.sync}), {code: 'not-rss'});
  assert.equal(f4.calls.length, 4, 'non-RSS 200s are retried');

  const f5 = fakeFetch([[() => true, () => new TypeError('fetch failed')]]);
  await assert.rejects(createHttp({userAgent: 'x-agent/1', fetchImpl: f5, ...fakeClock()}).get('https://www.goodreads.com/x', {kind: 'rss'}), {code: 'network'});
});

test('a failing shelf keeps its last good snapshot while the others update', async () => {
  const read1 = await fixture('goodreads/read-sample.xml');
  const empty = await fixture('goodreads/currently-reading-empty.xml');
  const dnf = await fixture('goodreads/did-not-finish.xml');
  const routes = [[u => u.includes('shelf=to-read'), () => new Response('down', {status: 500})],
    [u => u.includes('shelf=read'), (u) => xmlResponse(new URL(u).searchParams.get('page') === '1' ? read1 : empty.replace('currently-reading', 'read').replace('currently-reading', 'read'))],
    [u => u.includes('shelf=currently-reading'), () => xmlResponse(empty)],
    [u => u.includes('shelf=did-not-finish'), (u) => xmlResponse(new URL(u).searchParams.get('page') === '1' ? dnf : empty.replace(/currently-reading/g, 'did-not-finish'))]];
  const prevToRead = {shelf: 'to-read', channelTitle: "Malhar's bookshelf: to-read", count: 1, etags: [null], items: [{bookId: '1'}]};
  const http = createHttp({userAgent: 'x-agent/1', fetchImpl: fakeFetch(routes), ...fakeClock()});
  const r = await syncGoodreads({'to-read': prevToRead}, {http, config: cfg});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'http-500');
  assert.equal(r.snapshots['to-read'], prevToRead);
  assert.equal(r.snapshots.read.count, read.items.length);
  assert.equal(r.shelves.read.ok, true);
  assert.equal(r.snapshots['did-not-finish'].count, 3);
  assert.match(feedUrl(cfg.goodreads, 'read', 2), /^https:\/\/www\.goodreads\.com\/review\/list_rss\/113503174\?shelf=read&per_page=200&page=2&sort=date_added$/);
});
