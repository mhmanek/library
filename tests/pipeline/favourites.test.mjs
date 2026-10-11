// The "My Favourite Books" post (full real response) and how its titles land on Goodreads books.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFavourites, snapshotFromPost, syncSubstack, validateFavourites} from '../../lib/substack.mjs';
import {matchFavourites} from '../../lib/favourites.mjs';
import {parseFeed} from '../../lib/goodreads.mjs';
import {normalizeGoodreads} from '../../lib/normalize.mjs';
import {mergeRecords, mergeGroup} from '../../lib/merge.mjs';
import {createHttp} from '../../lib/http.mjs';
import {unsafeHtml} from '../../lib/schema.mjs';
import {fixture, fixtureJson, fakeFetch, fakeClock, jsonResponse, testConfig} from './helpers.mjs';

const post = await fixtureJson('substack/books-full.json');
const entries = parseFavourites(post.body_html);
const entry = key => entries.find(e => e.key === key);
const map = JSON.parse(await fixture('../../../data/manual/favourites-map.json'));

test('tiers, ranks and scores', () => {
  const t1 = entries.filter(e => e.tier === 1), t2 = entries.filter(e => e.tier === 2);
  assert.equal(t1.length, 20);
  assert.equal(t2.length, 46);
  assert.equal(entries.reduce((n, e) => n + e.titles.length, 0), 67);
  assert.deepEqual(t1.map(e => e.rank), Array.from({length: 20}, (_, i) => i + 1));
  assert.deepEqual(t1.slice(0, 3).map(e => e.score), ['11/10', '11/10', '11/10']);
  assert.ok(t1.slice(3).every(e => e.score === '10/10'));
  assert.ok(t2.every(e => e.rank === null && e.score === null && e.image === null));
  assert.deepEqual(entries.map(e => e.order), Array.from({length: 66}, (_, i) => i + 1));
  assert.deepEqual(t2.map(e => e.position), Array.from({length: 46}, (_, i) => i + 1));
});

test('titles and bylines as he wrote them', () => {
  assert.equal(entry('godel-escher-bach').titles[0].title, 'Gödel, Escher, Bach', 'the space inside the em is trimmed');
  assert.equal(entry('a-mind-at-play').titles[0].bylineHtml, '<a href="https://malharmanek.substack.com/p/jimmysoni" rel="noopener">Jimmy Soni</a> and Rob Goodman');
  assert.deepEqual(entry('a-mind-at-play').titles[0].authors, ['Jimmy Soni', 'Rob Goodman']);
  assert.equal(entry('poor-charlies-almanack').titles[0].bylineHtml, 'edited by Peter Kaufman');
  assert.deepEqual(entry('poor-charlies-almanack').titles[0].authors, ['Peter Kaufman']);
  assert.equal(entry('capital-returns').titles[0].bylineHtml, 'edited by Edward Chancellor');
  assert.deepEqual(entry('gautam-adani').titles[0].authors, ['R. N. Bhaskar'], 'initials do not end the byline');
  assert.deepEqual(entry('the-spy-who-came-in-from-the-cold').titles[0].authors, ['John le Carré']);
  assert.equal(entry('megatrends-ten-new-directions-transforming-our-lives').titles[0].bylineHtml, 'John Naisbitt (the original 1982 book)');
  assert.deepEqual(entry('megatrends-ten-new-directions-transforming-our-lives').titles[0].authors, ['John Naisbitt']);
  assert.equal(entry('invent-and-wander').titles[0].title, 'Invent & Wander', 'entity decoded');
  const musk = entry('elon-musk');
  assert.deepEqual(musk.titles.map(t => [t.title, t.authors[0]]), [['Elon Musk', 'Walter Isaacson'], ['Elon Musk', 'Ashlee Vance']]);
  assert.equal(musk.noteHtml, 'Both biographies are well-written.');
});

test('notes: paragraphs joined, score stripped, links and emphasis kept, all sanitised', () => {
  const maniac = entry('the-maniac');
  assert.match(maniac.noteHtml, /Jim O’Shaughnessy<\/a> and <a href="https:\/\/mahadesh\.substack\.com\/" rel="noopener">Gandhar Mahadeshwar<\/a> for the recommendation\.$/);
  assert.ok(!/10\/10/.test(maniac.noteHtml));
  assert.match(entry('godel-escher-bach').noteHtml, /^<strong>My favourite book\.<\/strong> Beyond brilliant\./);
  assert.match(entry('zero-to-one').noteHtml, /<a href="https:\/\/malharmanek\.substack\.com\/p\/thieleology" rel="noopener">this essay<\/a>/);
  assert.match(entry('the-art-of-learning').noteHtml, /edited by ESPN Cricinfo\)\.$/);
  for (const e of entries) {
    assert.deepEqual(unsafeHtml(e.noteHtml), [], e.key);
    for (const t of e.titles) assert.deepEqual(unsafeHtml(t.bylineHtml), [], e.key);
  }
});

test('every tier-1 entry gets the image he chose, from figures inside or after the list', () => {
  const t1 = entries.filter(e => e.tier === 1);
  assert.ok(t1.every(e => e.image && /^https:\/\/substack-post-media\.s3\.amazonaws\.com\/public\/images\//.test(e.image.url)));
  assert.deepEqual(entry('godel-escher-bach').image, {url: 'https://substack-post-media.s3.amazonaws.com/public/images/b431ffbc-ce0f-4e2b-8c8b-5b169e57577a_658x1000.jpeg', w: 658, h: 1000});
  assert.match(entry('zero-to-one').image.url, /2aa22f5b.*_1100x1100\.jpeg$/, 'figure inside the li');
  assert.match(entry('totto-chan').image.url, /_839x1400\.jpeg$/, 'figure after the ul');
  assert.equal(new Set(t1.map(e => e.image.url)).size, 20);
});

test('structure validation keeps the last good copy on a broken post', async () => {
  assert.throws(() => validateFavourites(entries.slice(0, 25)), {code: 'favourites-structure'});
  assert.throws(() => validateFavourites(entries.slice(0, 50), {entries}), {code: 'favourites-structure'}, 'more than 20% fewer entries');
  const prev = snapshotFromPost(post);
  const http = createHttp({userAgent: 'x-agent/1', fetchImpl: fakeFetch([
    [u => u.includes('www.malharmanek.com'), () => new Response('<html>challenge</html>', {status: 403})],
    [u => u.includes('malharmanek.substack.com'), () => jsonResponse({...post, body_html: '<p>Hello</p>'})]]), ...fakeClock()});
  const r = await syncSubstack(prev, {http, config: testConfig()});
  assert.equal(r.ok, false);
  assert.equal(r.snapshot, prev);
  assert.equal(r.error.code, 'favourites-structure');
  const ok = await syncSubstack(null, {http: createHttp({userAgent: 'x-agent/1', fetchImpl: fakeFetch([[() => true, () => jsonResponse(post)]]), ...fakeClock()}), config: testConfig()});
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshot.entries.length, 66);
  assert.equal(ok.snapshot.updatedAt, post.updated_at);
});

test('matching: pins, the not-on-Goodreads list, fuzzy titles and the traps', async () => {
  const items = [...parseFeed(await fixture('goodreads/read-sample.xml')).items.map(i => [i, 'read']),
    ...parseFeed(await fixture('goodreads/to-read-p1.xml')).items.map(i => [i, 'to-read'])];
  const records = items.map(([i, s]) => normalizeGoodreads(i, s));
  const books = mergeRecords(records).groups.map(g => mergeGroup(g, {pinned: new Set(Object.keys(map.pins))}));
  const r = matchFavourites(entries, books, map);
  const link = title => r.links.find(l => l.title.title === title);
  assert.equal(link('The Black Swan').book.goodreadsId, '28226413', 'the Instaread record he logged, by pin');
  assert.equal(link('The Black Swan').pin.useSubstackTitle, true);
  assert.equal(link('How To Lie With Statistics').book.goodreadsId, '150713547');
  assert.equal(link('Invent & Wander').book.goodreadsId, '54505323');
  assert.equal(link('Poor Charlie’s Almanack').book.goodreadsId, '944652');
  assert.equal(link('Buffett').book.goodreadsId, '137252761', 'the pin is the primary of the merged Buffett book');
  assert.deepEqual(link('Buffett').book.mergedIds, ['1155']);
  for (const [t, id] of [['Gödel, Escher, Bach', '24113'], ['Totto-chan', '328802'], ['Surely You’re Joking, Mr. Feynman', '35167685'], ['Feynman’s Rainbow', '45776']]) {
    assert.equal(link(t).book.goodreadsId, id, t);
  }
  assert.equal(link('The Outsiders').book.goodreadsId, '13586932', "Thorndike's book, not Hinton's novel on to-read");
  const musk = r.links.filter(l => l.entry.key === 'elon-musk').map(l => l.book.goodreadsId).sort();
  assert.deepEqual(musk, ['122765395', '25541028'], 'two Elon Musk biographies, one entry');
  const only = r.favouritesOnly.map(f => f.key).sort();
  assert.deepEqual(only.filter(k => ['totto-chan-the-sequel', 'how-to-create-a-mind', 'the-art-of-learning', 'finite-and-infinite-games'].includes(k)),
    ['finite-and-infinite-games', 'how-to-create-a-mind', 'the-art-of-learning', 'totto-chan-the-sequel']);
  assert.ok(r.favouritesOnly.every(f => f.title.title !== 'Totto-chan'));
});

test('warnings: unused pins, favourites on to-read, not found', () => {
  const rec = (id, title, author, shelf) => normalizeGoodreads({bookId: id, title, author, rating: 0, addedAt: null}, shelf);
  const books = mergeRecords([rec('1', 'Anathem', 'Neal Stephenson', 'to-read')]).groups.map(g => mergeGroup(g));
  const e = [{key: 'anathem', tier: 2, rank: null, order: 1, position: 1, score: null, noteHtml: 'x', titles: [{title: 'Anathem', bylineHtml: 'Neal Stephenson', authors: ['Neal Stephenson']}]},
    {key: 'nowhere', tier: 2, rank: null, order: 2, position: 2, score: null, noteHtml: 'y', titles: [{title: 'Nowhere Book', bylineHtml: 'A B', authors: ['A B']}]}];
  const r = matchFavourites(e, books, {pins: {'999': {title: 'Ghost'}}, notOnGoodreads: {}});
  assert.ok(r.warnings.some(w => /on to-read/.test(w)));
  assert.ok(r.warnings.some(w => /pin 999 .* matched no favourite; safe to delete/.test(w)));
  assert.ok(r.warnings.some(w => /"Nowhere Book" was not found/.test(w)));
  assert.equal(r.favouritesOnly[0].key, 'nowhere-book');
});
