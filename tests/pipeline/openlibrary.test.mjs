// Open Library enrichment against real responses: batch mapping, single queries, misses, retries, circuit breaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichOpenLibrary, matchDocs, needsLookup, olFacts, coverUrl, workId} from '../../lib/openlibrary.mjs';
import {createHttp} from '../../lib/http.mjs';
import {fixtureJson, fakeFetch, fakeClock, jsonResponse} from './helpers.mjs';

const isbnResp = await fixtureJson('openlibrary/search-isbn.json');
const grResp = await fixtureJson('openlibrary/search-goodreads.json');
const empty = await fixtureJson('openlibrary/search-empty.json');
const GEB = {key: '24113', goodreadsId: '24113', isbn10: '0465026567', isbn13: '9780465026562', title: 'Gödel, Escher, Bach', authors: ['Douglas R. Hofstadter']};
const ACC = {key: '17863', goodreadsId: '17863', isbn10: '0441014151', isbn13: '9780441014156', title: 'Accelerando', authors: ['Charles Stross']};
const CYB = {key: '18194', goodreadsId: '18194', isbn10: null, isbn13: null, title: 'The Cyberiad', authors: ['Stanisław Lem']};
const NONE = {key: '999', goodreadsId: '999', isbn10: '0306406152', isbn13: '9780306406157', title: 'Nothing', authors: ['No One']};
const now = () => Date.parse('2026-10-11T12:00:00Z');

test('real ISBN batch maps back through editions (full hits) and id_goodreads (work hits)', () => {
  const hits = matchDocs(isbnResp.docs, [GEB, ACC], '2026-10-11');
  assert.deepEqual(hits.get('24113'), {checked: '2026-10-11', work: '/works/OL716850W', edition: '/books/OL85373M', editionCover: 15247757, workCover: 14368453, pages: 777, year: 1979});
  assert.equal(hits.get('17863').year, 1900, 'Open Library years can be wrong; they never feed the oldest-book stat');
  const work = matchDocs(grResp.docs, [CYB], '2026-10-11', {byIsbn: false});
  assert.equal(work.get('18194').work, '/works/OL2683553W');
  assert.equal(work.get('18194').edition, null);
  assert.deepEqual(olFacts(hits.get('24113')), {olWork: 'OL716850W', olPages: 777, olYear: 1979, editionCover: 15247757, workCover: 14368453});
  assert.equal(olFacts({checked: '2026-10-11', miss: true}), null);
  assert.equal(coverUrl(15247757), 'https://covers.openlibrary.org/b/id/15247757-L.jpg?default=false');
  assert.equal(workId('/works/OL1W'), 'OL1W');
});

test('passes, misses with a checked date, budget and the 90-day retry', async () => {
  const f = fakeFetch([
    [u => /q=isbn%3A\(/.test(u), () => jsonResponse(isbnResp)],
    [u => /q=id_goodreads/.test(u), () => jsonResponse(grResp)],
    [u => /q=isbn%3A9780306406157/.test(u), () => jsonResponse(empty)],
  ]);
  const http = createHttp({userAgent: 'mhmanek-library-sync/1.0 (+https://github.com/mhmanek/library)', fetchImpl: f, ...fakeClock()});
  const r = await enrichOpenLibrary([GEB, ACC, CYB, NONE], {entries: {}}, {http, now});
  assert.equal(r.circuitOpen, false);
  assert.equal(r.cache.entries['24113'].edition, '/books/OL85373M');
  assert.equal(r.cache.entries['18194'].work, '/works/OL2683553W', 'no ISBN: found by Goodreads id');
  assert.deepEqual(r.cache.entries['999'], {checked: '2026-10-11', miss: true});
  assert.deepEqual(f.calls.map(c => new URL(c.url).searchParams.get('q')), [
    'isbn:(9780465026562 OR 0465026567 OR 9780441014156 OR 0441014151 OR 9780306406157 OR 0306406152)',
    'id_goodreads:(18194 OR 999)', 'isbn:9780306406157']);
  assert.ok(f.calls.every(c => /github\.com\/mhmanek\/library/.test(c.headers['User-Agent'])), 'the UA carries the repo contact');

  // Hits are permanent, misses wait 90 days unless refreshed.
  assert.equal(needsLookup(r.cache.entries['24113'], {now, refresh: true}), false);
  assert.equal(needsLookup(r.cache.entries['999'], {now}), false);
  assert.equal(needsLookup(r.cache.entries['999'], {now: () => now() + 91 * 864e5}), true);
  assert.equal(needsLookup(r.cache.entries['999'], {now, refresh: true}), true);
  const f2 = fakeFetch([[() => true, () => jsonResponse(empty)]]);
  const again = await enrichOpenLibrary([GEB, ACC, CYB, NONE], r.cache, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f2, ...fakeClock()}), now});
  assert.equal(f2.calls.length, 0, 'nothing to look up');
  assert.deepEqual(again.cache, r.cache);

  // A spent single-query budget defers instead of recording a miss.
  const f3 = fakeFetch([[() => true, () => jsonResponse(empty)]]);
  const d = await enrichOpenLibrary([NONE], {entries: {}}, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f3, ...fakeClock()}), now, budget: 0});
  assert.equal(d.cache.entries['999'], undefined);
  assert.equal(d.stats.deferred, 1);
});

test('a 503 after retries opens the circuit and caches nothing for the rest', async () => {
  const clock = fakeClock();
  const f = fakeFetch([[() => true, () => new Response('down', {status: 503})]]);
  const r = await enrichOpenLibrary([GEB, CYB], {entries: {}}, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f, ...clock}), now});
  assert.equal(r.circuitOpen, true);
  assert.deepEqual(r.cache.entries, {});
  assert.equal(f.calls.length, 4, 'one batch, retried, then the breaker stops every later pass');
});

test('favourites-only title search must match the whole title when it has a subtitle', async () => {
  const totto = await fixtureJson('openlibrary/search-title.json'); // the original Totto-chan
  const f = fakeFetch([[() => true, () => jsonResponse(totto)]]);
  const sequel = {key: 'fav:totto-chan-the-sequel', goodreadsId: null, isbn10: null, isbn13: null, title: 'Totto-chan: The Sequel', authors: ['Tetsuko Kuroyanagi']};
  const r = await enrichOpenLibrary([sequel], {entries: {}}, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f, ...fakeClock()}), now});
  assert.deepEqual(r.cache.entries['fav:totto-chan-the-sequel'], {checked: '2026-10-11', miss: true});
  const orig = {...sequel, key: 'fav:totto-chan', title: 'Totto-chan'};
  const r2 = await enrichOpenLibrary([orig], {entries: {}}, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: f, ...fakeClock()}), now});
  assert.equal(r2.cache.entries['fav:totto-chan'].work, totto.docs[0].key);
});
