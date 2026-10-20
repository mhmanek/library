// books.json assembly (CONTRACT Catalog), stats, health, the visitor-shelf sanitiser and the reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalog, assemble, catalogFrom, compareBooks, assignSlugs, duplicatesNote} from '../../lib/catalog.mjs';
import {computeStats} from '../../lib/stats.mjs';
import {updateHealth} from '../../lib/health.mjs';
import {sanitizeItems, syncWall} from '../../lib/wall.mjs';
import {diffCatalog, commitMessage, renderSummary, alertMessage, remedy} from '../../lib/report.mjs';
import {parseFeed} from '../../lib/goodreads.mjs';
import {snapshotFromPost} from '../../lib/substack.mjs';
import {createHttp} from '../../lib/http.mjs';
import {validateBooks, validateWall} from '../../lib/schema.mjs';
import {fixture, fixtureJson, fakeFetch, fakeClock, jsonResponse, testConfig} from './helpers.mjs';

const config = testConfig();
const snap = async (shelf, files) => {
  const items = [];
  for (const f of files) items.push(...parseFeed(await fixture(`goodreads/${f}`)).items.map(({userName, ...i}) => i));
  items.sort((a, b) => Number(a.bookId) - Number(b.bookId));
  return {shelf, channelTitle: `Malhar's bookshelf: ${shelf}`, count: items.length, etags: [], items};
};
export async function fixtureData() {
  return {
    goodreads: {
      'read': await snap('read', ['read-sample.xml']), 'currently-reading': await snap('currently-reading', ['currently-reading-empty.xml']),
      'did-not-finish': await snap('did-not-finish', ['did-not-finish.xml']), 'to-read': await snap('to-read', ['to-read-p1.xml', 'to-read-p2.xml']),
    },
    substack: snapshotFromPost(await fixtureJson('substack/books-full.json')),
    wall: {items: []},
    openlibrary: {version: 1, entries: {24113: {checked: '2026-10-11', work: '/works/OL716850W', edition: '/books/OL85373M', editionCover: 15247757, workCover: 14368453, pages: 777, year: 1979},
      150713547: {checked: '2026-10-11', miss: true}}},
    covers: {pipeline: 1, entries: {}},
    sync: {syncedAt: '2026-10-11T14:17:03Z', sources: {goodreads: {changedAt: '2026-10-11T14:17:03Z', failingSince: null, notifiedAt: null}}},
    manual: {favouritesMap: JSON.parse(await fixture('../../../data/manual/favourites-map.json')), overrides: {covers: {}, sameWork: [], differentWork: [], hide: []}},
  };
}

test('fixture catalog satisfies the contract and its sort order', async () => {
  const data = await fixtureData();
  // Every favourite is on Goodreads now; one not-on-Goodreads entry keeps its ISBN pass-through covered.
  data.manual.favouritesMap.notOnGoodreads = {'The Art of Learning': {isbn13: '9780743277457'}};
  const cat = buildCatalog(data, config);
  assert.deepEqual(validateBooks(cat), []);
  assert.deepEqual(Object.keys(cat), ['version', 'syncedAt', 'sources', 'counts', 'stats', 'books']);
  assert.deepEqual(cat.sources.goodreads.items, {'read': 26, 'currently-reading': 0, 'did-not-finish': 3, 'to-read': 6});
  assert.equal(cat.sources.substack.updatedAt, '2026-05-24T17:04:24.158Z');
  const sorted = [...cat.books].sort((a, b) => compareBooks(a, b));
  assert.deepEqual(cat.books.map(b => b.id), sorted.map(b => b.id));
  assert.deepEqual([...new Set(cat.books.map(b => b.shelf))], ['read', 'did-not-finish', 'to-read', null]);
  assert.deepEqual(Object.keys(cat.books[0]), ['id', 'slug', 'goodreadsId', 'title', 'subtitle', 'series', 'authors', 'shelf', 'rating', 'avgRating', 'pages',
    'published', 'dateAdded', 'readAt', 'isbn13', 'olWork', 'reviewHtml', 'goodreadsUrl', 'cover', 'favourite', 'mergedIds']);
  const byId = id => cat.books.find(b => b.id === id);
  const geb = byId('gr-24113');
  assert.deepEqual([geb.slug, geb.olWork, geb.isbn13, geb.favourite.rank, geb.favourite.order, geb.favourite.groupId, geb.favourite.score],
    ['godel-escher-bach-hofstadter', 'OL716850W', '9780465026562', 1, 1, 'godel-escher-bach', '11/10']);
  assert.equal(geb.goodreadsUrl, 'https://www.goodreads.com/book/show/24113');
  const swan = byId('gr-28226413');
  assert.deepEqual([swan.title, swan.subtitle, swan.authors], ['The Black Swan', null, ['Nassim Nicholas Taleb']], 'useSubstackTitle replaces the Instaread record');
  assert.equal(byId('gr-150713547').title, 'How To Lie With Statistics');
  const buffett = byId('gr-137252761');
  assert.deepEqual([buffett.mergedIds, buffett.isbn13, buffett.pages], [['1155'], '9780385484916', 475]);
  assert.deepEqual(byId('gr-241434373').mergedIds, ['242105169']);
  const musk = cat.books.filter(b => b.favourite?.groupId === 'elon-musk');
  assert.equal(musk.length, 2);
  assert.equal(new Set(musk.map(b => b.favourite.order)).size, 1);
  // The trimmed fixture holds 26 of his 169 read books, so most favourites fall back to favourites-only here.
  const only = cat.books.filter(b => b.id.startsWith('fav-'));
  const offGoodreads = ['fav-finite-and-infinite-games', 'fav-how-to-create-a-mind', 'fav-the-art-of-learning', 'fav-totto-chan-the-sequel'];
  assert.deepEqual(only.map(b => b.id).filter(id => offGoodreads.includes(id)).sort(), offGoodreads);
  for (const b of only) assert.deepEqual([b.shelf, b.goodreadsId, b.goodreadsUrl, b.rating, b.avgRating, b.dateAdded], [null, null, null, 0, null, null]);
  assert.equal(only.find(b => b.id === 'fav-the-art-of-learning').isbn13, '9780743277457');
  assert.equal(cat.counts.favouritesOnly, only.length);
  assert.equal(cat.stats.favourites.offGoodreads, only.length);
  assert.equal(cat.counts.favourites, cat.books.filter(b => b.favourite).length);
  assert.ok(cat.books.every(b => b.cover.source === 'placeholder' || b.cover.src), 'no cover cache yet');
  const plato = byId('gr-30292');
  assert.equal(plato.published, -385);
  assert.equal(cat.stats.read.oldest.id, 'gr-30292');
});

test('reviews are sanitised and dropped when they repeat the favourite note', async () => {
  const data = await fixtureData();
  const cat = buildCatalog(data, config);
  const alchemy = cat.books.find(b => b.id === 'gr-26210508');
  assert.equal(alchemy.reviewHtml, null, 'his Alchemy review is a copy of his blurb');
  data.substack = {...data.substack, entries: data.substack.entries.filter(e => e.key !== 'alchemy')};
  const again = buildCatalog(data, config).books.find(b => b.id === 'gr-26210508');
  assert.ok(again.reviewHtml && !/script|onclick|steal|span/.test(again.reviewHtml), again.reviewHtml);
  assert.match(again.reviewHtml, /<a href="https:\/\/malharmanek\.substack\.com\/p\/rorysutherland" rel="noopener">/);
  assert.equal(duplicatesNote('<p>A wonderful read on perception.</p>', 'A wonderful read on perception. Great ideas too.'), true);
  assert.equal(duplicatesNote('<p>Totally different words here.</p>', 'Nothing in common at all'), false);
});

test('hide, slugs and cover walk', async () => {
  const data = await fixtureData();
  data.manual.overrides.hide = ['1155'];
  const cat = buildCatalog(data, config);
  assert.ok(!cat.books.some(b => b.id === 'gr-137252761'), 'hiding a merged edition hides the book');
  const books = [{id: 'gr-9', goodreadsId: '9', title: 'Dune', authors: ['Frank Herbert']}, {id: 'gr-3', goodreadsId: '3', title: 'Dune', authors: ['Frank Herbert']},
    {id: 'fav-dune', goodreadsId: null, title: 'Dune', authors: ['Frank Herbert']}, {id: 'gr-5', goodreadsId: '5', title: '三体', authors: ['刘慈欣']}];
  assignSlugs(books);
  assert.deepEqual(books.map(b => b.slug), ['dune-herbert-9', 'dune-herbert', 'dune-herbert-2', 'book-5'], 'the oldest id keeps the plain slug');
  data.covers.entries['https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1410429437l/24113.jpg'] = {s: 'bad', why: 'small'};
  data.covers.entries['https://substack-post-media.s3.amazonaws.com/public/images/b431ffbc-ce0f-4e2b-8c8b-5b169e57577a_658x1000.jpeg'] =
    {s: 'ok', hash: '0123456789abcdef', w: 400, h: 608, square: false, colors: {bg: '#d8d2c4', spine: '#3a4a5c', accent: '#b5452e', ink: '#f1e7d2', bgInk: '#1d1a15'}};
  const geb = buildCatalog(data, config).books.find(b => b.id === 'gr-24113');
  assert.deepEqual(geb.cover, {stem: '0123456789abcdef', src: 'covers/0123456789abcdef-200.webp', src2x: 'covers/0123456789abcdef-400.webp', w: 400, h: 608, square: false,
    source: 'substack', colors: {bg: '#d8d2c4', spine: '#3a4a5c', accent: '#b5452e', ink: '#f1e7d2', bgInk: '#1d1a15'}});
});

test('buildCatalog is deterministic and works on empty data', async () => {
  const data = await fixtureData();
  assert.equal(JSON.stringify(buildCatalog(data, config)), JSON.stringify(buildCatalog(structuredClone(data), config)));
  const empty = buildCatalog({goodreads: {}, substack: null, wall: {items: []}, openlibrary: {entries: {}}, covers: {entries: {}}, sync: {}, manual: {}}, config);
  assert.deepEqual(validateBooks(empty), []);
  assert.equal(empty.syncedAt, null);
  assert.deepEqual(empty.counts, {read: 0, reading: 0, dnf: 0, toRead: 0, favourites: 0, favouritesOnly: 0});
});

test('stats: read shelf only, floors for the histogram, quarter stars, superlatives, no year fields', () => {
  const b = (id, o) => ({id, goodreadsId: id.slice(3), shelf: 'read', rating: 4, avgRating: 4, pages: 300, published: 2000, publishedSource: 'goodreads', authors: ['A'], favourite: null, readAt: null, dateAdded: '2026-01-01', ...o});
  const s = computeStats([
    b('gr-1', {rating: 5, avgRating: 3.68, pages: 4000}), b('gr-2', {rating: 4.75, avgRating: 4.9, published: -385, authors: ['Plato']}),
    b('gr-3', {rating: 2, avgRating: 4.11, published: 1900, publishedSource: 'openlibrary'}), b('gr-4', {rating: 0, pages: null, readAt: '2026-04-14'}),
    b('gr-5', {shelf: 'to-read', pages: 100, dateAdded: '2026-10-11'}), {...b('fav-x', {shelf: null, goodreadsId: null, rating: 0}), favourite: {tier: 1, score: '11/10'}},
    b('gr-6', {shelf: 'did-not-finish'}), {...b('gr-7', {}), favourite: {tier: 2, score: null}},
  ]);
  assert.deepEqual(s.read.hist, {1: 0, 2: 1, 3: 0, 4: 2, 5: 1});
  assert.equal(s.read.count, 5);
  assert.equal(s.read.rated, 4);
  assert.equal(s.read.mean, 3.94);
  assert.deepEqual(s.read.pages, {total: 900, known: 3}, 'nulls and > 3000 ignored');
  assert.deepEqual(s.read.oldest, {id: 'gr-2', year: -385});
  assert.deepEqual(s.read.longest, {id: 'gr-2', pages: 300});
  assert.deepEqual(s.read.topAuthors, [{name: 'A', count: 4}]);
  assert.deepEqual(s.read.crush, {id: 'gr-1', delta: 1.32});
  assert.deepEqual(s.read.harsh, {id: 'gr-3', delta: -2.11});
  assert.equal(s.read.dated, 1);
  assert.deepEqual(s.toRead, {count: 1, pages: {total: 100, known: 1}, lastAdded: {id: 'gr-5', date: '2026-10-11'}});
  assert.deepEqual([s.dnf.count, s.reading.count], [1, 0]);
  assert.deepEqual(s.favourites, {ranked: 1, more: 1, elevens: 1, offGoodreads: 1});
  assert.ok(!/year|timeline/i.test(Object.keys(s.read).join()), 'no year or timeline fields');
});

test('health: grace periods, weekly re-alerts, immediate on manual runs, transition-only state', () => {
  const t0 = Date.parse('2026-10-11T00:00:00Z'), h = 36e5;
  const fail = {goodreads: {ok: false, error: {code: 'http-503'}}};
  let s = updateHealth({}, fail, t0);
  assert.equal(s.alerts.length, 0, 'a one-off blip is silent');
  assert.equal(s.sources.goodreads.failingSince, '2026-10-11T00:00:00Z');
  const quiet = updateHealth(s.sources, fail, t0 + 6 * h);
  assert.deepEqual(quiet.sources, s.sources, 'no state rewrite while within grace');
  s = updateHealth(s.sources, fail, t0 + 12 * h);
  assert.equal(s.alerts[0].source, 'goodreads');
  assert.equal(s.sources.goodreads.notifiedAt, '2026-10-11T12:00:00Z');
  const again = updateHealth(s.sources, fail, t0 + 3 * 24 * h);
  assert.equal(again.alerts.length, 0, 'at most weekly');
  assert.deepEqual(again.sources, s.sources);
  assert.equal(updateHealth(s.sources, fail, t0 + 12 * h + 7 * 24 * h).alerts.length, 1, 'a week later it alerts again');
  const ok = updateHealth(s.sources, {goodreads: {ok: true}}, t0 + 20 * h);
  assert.deepEqual([ok.sources.goodreads.failingSince, ok.sources.goodreads.notifiedAt], [null, null]);
  assert.equal(updateHealth({}, fail, t0, {interactive: true}).alerts.length, 1, 'manual run: Goodreads failure alerts at once');
  const sub = {substack: {ok: false, error: {code: 'not-json'}}};
  const s1 = updateHealth({}, sub, t0);
  assert.equal(updateHealth(s1.sources, sub, t0 + 71 * h).alerts.length, 0);
  assert.equal(updateHealth(s1.sources, sub, t0 + 72 * h).alerts.length, 1, 'Substack grace is 72 h');
  const wall = {wall: {ok: false, error: {code: 'network'}}};
  assert.equal(updateHealth(updateHealth({}, wall, t0).sources, wall, t0 + 24 * h).alerts.length, 1, 'wall grace is 24 h');
  assert.deepEqual(Object.keys(updateHealth({}, {}, t0).sources), ['goodreads', 'substack', 'wall']);
});

test('visitor shelf: whitelisted plain text, caps, sort, never an email', async () => {
  const items = sanitizeItems([
    {id: '17', title: ' Anathem\n\u0007', author: 'Neal Stephenson', olWork: 'OL5720023W', coverId: 123, year: 2008, name: 'A'.repeat(60), note: 'n'.repeat(400), date: '2026-10-01T10:00:00Z', email: 'x@y.z'},
    {id: '18', title: 'Dune', author: '', olWork: 'bad', coverId: -1, year: 0, name: '', note: '', date: '2026-10-02'},
    {id: 'x', title: 'Bad id', date: '2026-10-03'}, {id: '19', title: '', date: '2026-10-03'}, {id: '20', title: 'No date'},
    {id: '16', title: 'Same day', author: 'Z', name: '', note: '', date: '2026-10-01'},
  ]);
  assert.deepEqual(items.map(i => i.id), ['18', '17', '16']);
  assert.deepEqual(items[1], {id: '17', title: 'Anathem', author: 'Neal Stephenson', olWork: 'OL5720023W', coverId: 123, year: 2008, name: 'A'.repeat(40), note: 'n'.repeat(280), date: '2026-10-01'});
  assert.deepEqual([items[0].olWork, items[0].coverId, items[0].year], [null, null, null]);
  assert.deepEqual(validateWall({items}), []);
  assert.ok(!JSON.stringify(items).includes('x@y.z'));
  const none = await syncWall({items: []}, {http: null, config});
  assert.deepEqual([none.ok, none.skipped], [true, true]);
  const cfg = {...config, visitorShelf: {workerUrl: 'https://library-recs.example.workers.dev', turnstileSiteKey: null}};
  const http = createHttp({userAgent: 'x-agent/1', fetchImpl: fakeFetch([[() => true, () => jsonResponse({updatedAt: '2026-10-11T00:00:00Z', items: [{id: '1', title: 'T', author: '', name: '', note: '', date: '2026-10-11', email: 'secret@x.org'}]})]]), ...fakeClock()});
  const w = await syncWall({items: []}, {http, config: cfg});
  assert.deepEqual([w.ok, w.changed, w.snapshot.items.length], [true, true, 1]);
  assert.ok(!JSON.stringify(w.snapshot).includes('secret'));
  const down = await syncWall({items: [{id: '1'}]}, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: fakeFetch([[() => true, () => new Response('', {status: 502})]]), ...fakeClock()}), config: cfg});
  assert.deepEqual([down.ok, down.snapshot.items.length], [false, 1], 'last good copy kept');
});

test('reports: diff, commit message, summary and a plain alert line', async () => {
  const data = await fixtureData();
  const before = buildCatalog(data, config);
  const changed = structuredClone(data);
  changed.goodreads['to-read'].items[0] = {...changed.goodreads['to-read'].items[0], avgRating: 1.23};
  const moved = changed.goodreads['to-read'].items.pop();
  changed.goodreads.read.items.push({...moved, shelves: [], rating: 5});
  const after = buildCatalog(changed, config);
  const diff = diffCatalog(before, after);
  assert.equal(diff.moved.length, 1);
  assert.equal(diff.drift, 1);
  const msg = commitMessage({diff, outcomes: {goodreads: {ok: true}, substack: {ok: false, error: {code: 'not-json'}}, wall: {skipped: true}}});
  assert.match(msg, /^Sync: finished "[^"]+"; 1 world rating moved\n\ngoodreads: ok\nsubstack: failed \(not-json\), kept last good\nwall: skipped\n$/);
  assert.equal(commitMessage({diff: diffCatalog(before, before)}).split('\n')[0], 'Sync: data refresh');
  const md = renderSummary({nowIso: '2026-10-11T14:17:03Z', outcomes: {goodreads: {ok: false, error: {code: 'drop'}}, substack: {ok: true}, wall: {skipped: true}}, diff, warnings: ['a | b']});
  assert.match(md, /\*\*goodreads\*\* `drop`: A shelf shrank by more than 20%/);
  assert.match(md, /a \\\| b/);
  assert.equal(alertMessage([{source: 'goodreads', since: '2026-10-11T00:00:00Z', code: 'http-503\n::error::x'}]), 'goodreads failing since 2026-10-11T00:00:00Z (http-503errorx)', 'no newline or workflow command survives');
  assert.match(remedy('http-403'), /User-Agent/);
});
