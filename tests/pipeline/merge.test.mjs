// Title clean-up and the duplicate-edition ladder, pinned on his real traps (tests/fixtures/pipeline/merge-cases.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitTitle, normalizeGoodreads, pickPages} from '../../lib/normalize.mjs';
import {mergeRecords, mergeGroup, pickPrimary} from '../../lib/merge.mjs';
import {goodreadsOriginal, sx400} from '../../lib/covers.mjs';
import {fixtureJson} from './helpers.mjs';

const cases = await fixtureJson('merge-cases.json');
const records = cases.items.map(({shelf, item}) => normalizeGoodreads(item, shelf));
const rec = id => records.find(r => r.goodreadsId === id);
const grouped = (recs, opts) => {
  const {groups} = mergeRecords(recs, opts);
  const of = new Map();
  groups.forEach((g, i) => g.forEach(r => of.set(r.goodreadsId, i)));
  return (a, b) => of.get(a) === of.get(b);
};

test('splitTitle: series, subtitles and edition junk', () => {
  assert.deepEqual(splitTitle('Foundation (Foundation, #1)'), {title: 'Foundation', subtitle: null, series: {name: 'Foundation', index: '1'}});
  assert.deepEqual(splitTitle('Tinker, Tailor, Soldier, Spy (George Smiley, #5; Karla Trilogy, #1)'),
    {title: 'Tinker, Tailor, Soldier, Spy', subtitle: null, series: {name: 'George Smiley', index: '5'}}, 'first series only');
  assert.deepEqual(splitTitle('Gödel, Escher, Bach: An Eternal Golden Braid'), {title: 'Gödel, Escher, Bach', subtitle: 'An Eternal Golden Braid', series: null});
  assert.equal(splitTitle('"Surely You\'re Joking, Mr. Feynman!": Adventures of a Curious Character').title, "Surely You're Joking, Mr. Feynman!");
  assert.deepEqual(splitTitle('Buffett: The Making of an American Capitalist by Roger Lowenstein(2008-04-29)', 'Roger Lowenstein'),
    {title: 'Buffett', subtitle: 'The Making of an American Capitalist', series: null});
  assert.deepEqual(splitTitle('By Maggie Mahar - Bull: A History of the Boom and Bust, 1982-2004 (9.12.2004)', 'Maggie Mahar'),
    {title: 'Bull', subtitle: 'A History of the Boom and Bust, 1982-2004', series: null});
  assert.equal(splitTitle('Death by Black Hole: And Other Cosmic Quandaries', 'Neil deGrasse Tyson').title, 'Death by Black Hole', 'not the author, so not junk');
  assert.deepEqual(splitTitle('R. N. Kao: Gentleman Spymaster'), {title: 'R. N. Kao', subtitle: 'Gentleman Spymaster', series: null});
  assert.equal(splitTitle('Meditations (Penguin Classics)').title, 'Meditations');
  assert.equal(splitTitle('Dune (Paperback)').title, 'Dune');
  assert.equal(splitTitle('Les Miserables (Classics Illustrated #9)').series.name, 'Classics Illustrated');
  assert.equal(splitTitle('A (Mis)Behavior: x (y: z)').title, 'A (Mis)Behavior', 'colon inside parentheses is not a split');
});

test('pages: Goodreads if plausible, else Open Library, else null', () => {
  assert.equal(pickPages(16, 350), 350, 'audiobook page count');
  assert.equal(pickPages(0, null), null);
  assert.equal(pickPages(null, 20), null);
  assert.equal(pickPages(777, 790), 777);
});

test('Goodreads cover URLs: original without suffix, nophoto rejected', () => {
  const base = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1774819392l/242105169';
  for (const s of ['._SY475_', '._SX98_', '._SX318_SY475_', '']) assert.equal(goodreadsOriginal(`${base}${s}.jpg`), `${base}.jpg`);
  assert.equal(goodreadsOriginal('https://s.gr-assets.com/assets/nophoto/book/111x148-bcc042a9c91a29c1d680899eff700a03.png'), null);
  assert.equal(sx400(`${base}.jpg`), `${base}._SX400_.jpg`);
});

test('must merge: his real duplicate editions', () => {
  const same = grouped(records);
  for (const [a, b] of cases.mustMerge) assert.ok(same(a, b), `${a} + ${b} (${rec(a).rawTitle} / ${rec(b).rawTitle})`);
});

test('must not merge: the calibrated traps', () => {
  const same = grouped(records);
  for (const [a, b] of cases.mustNotMerge) {
    if (a === '35419' && b === '758647') continue; // no rule can tell these apart; see below
    assert.ok(!same(a, b), `${a} vs ${b} (${rec(a).rawTitle} / ${rec(b).rawTitle})`);
  }
  // "The Making of Star Wars" vs "…: Revenge of the Sith" looks exactly like "The Cyberiad" vs "The Cyberiad: Fables…",
  // and Open Library even files both under one work, so only a differentWork override separates them.
  const ol = records.map(r => (['35419', '758647'].includes(r.goodreadsId) ? {...r, olWork: 'OL5737104W'} : r));
  assert.ok(grouped(ol)('35419', '758647'), 'known false merge without the override');
  assert.ok(!grouped(ol, {overrides: {differentWork: [['35419', '758647']]}})('35419', '758647'));
  // Totto-chan vs Totto-chan: The Sequel (the sequel is not on Goodreads, so this pins the rule itself).
  const totto = normalizeGoodreads({bookId: '1', title: 'Totto-chan', author: 'Tetsuko Kuroyanagi', rating: 5, addedAt: null}, 'read');
  const sequel = normalizeGoodreads({bookId: '2', title: 'Totto-chan: The Sequel', author: 'Tetsuko Kuroyanagi', rating: 0, addedAt: null}, 'to-read');
  assert.ok(!grouped([totto, sequel])('1', '2'));
});

test('ladder: ISBN-13 merges different titles; OL work needs a shared surname and equal markers; overrides win', () => {
  const r = (id, title, author, extra = {}) => ({...normalizeGoodreads({bookId: id, title, author, rating: 0, addedAt: null}, 'to-read'), ...extra});
  const a = r('10', 'Alpha', 'Ann Smith', {isbn13: '9780306406157'}), b = r('11', 'Totally Different', 'Bob Jones', {isbn13: '9780306406157'});
  assert.ok(grouped([a, b])('10', '11'));
  const c = r('12', 'Sapiens', 'Yuval Harari', {olWork: 'OL9W'}), d = r('13', 'Sapiens Graphic Novel', 'Yuval Harari', {olWork: 'OL9W'});
  const e = r('14', 'Something', 'Other Person', {olWork: 'OL9W'}), f = r('15', 'Sapiens: A Brief History', 'Yuval Noah Harari', {olWork: 'OL9W'});
  const same = grouped([c, d, e, f]);
  assert.ok(same('12', '15') && !same('12', '13') && !same('12', '14'), 'adaptation marker and author guard the OL merge');
  assert.ok(!grouped([c, f], {overrides: {differentWork: [['12', '15']]}})('12', '15'), 'differentWork beats OL equality');
  assert.ok(grouped([a, e], {overrides: {sameWork: [['10', '14']]}})('10', '14'), 'sameWork forces a merge');
  const moved = [r('20', 'Anathem', 'Neal Stephenson'), {...r('20', 'Anathem', 'Neal Stephenson'), shelf: 'read'}];
  assert.equal(mergeRecords(moved).groups.length, 1, 'the same id on two shelves (moved mid-sync) is one book');
});

test('shelf precedence and primary edition', () => {
  const r = (id, shelf, item = {}, extra = {}) => ({...normalizeGoodreads({bookId: id, title: 'Anathem', author: 'Neal Stephenson', rating: 0, addedAt: '2026-01-01T00:00:00-08:00', ...item}, shelf), ...extra});
  for (const [s1, s2, want] of [['read', 'to-read', 'read'], ['currently-reading', 'to-read', 'currently-reading'], ['did-not-finish', 'to-read', 'did-not-finish']]) {
    const g = mergeRecords([r('1', s2), r('2', s1)]).groups;
    assert.equal(g.length, 1);
    assert.equal(mergeGroup(g[0]).shelf, want);
  }
  const g = [r('5', 'read', {rating: 0, addedAt: '2025-01-01T00:00:00-08:00', readAt: '2025-02-01'}), r('9', 'read', {rating: 4, readAt: '2026-03-01', pages: 16}, {olPages: 900})];
  assert.equal(pickPrimary(g).goodreadsId, '9', 'rated beats unrated');
  assert.equal(pickPrimary(g, new Set(['5'])).goodreadsId, '5', 'a favourites pin wins');
  const m = mergeGroup(g);
  assert.deepEqual([m.goodreadsId, m.mergedIds, m.rating, m.dateAdded, m.readAt, m.pages], ['9', ['5'], 4, '2025-01-01', '2026-03-01', 900]);
});

test('merging is order independent', () => {
  const shuffled = [...records].reverse();
  const key = recs => JSON.stringify(mergeRecords(recs).groups.map(g => g.map(r => r.goodreadsId)));
  assert.equal(key(shuffled), key(records));
  const primaries = recs => mergeRecords(recs).groups.map(g => mergeGroup(g).goodreadsId).join();
  assert.equal(primaries(shuffled), primaries(records));
});
