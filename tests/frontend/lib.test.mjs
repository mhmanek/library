// Pure browser libraries (format, url, card records, wall merge) and the build's derive and sanitise steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDay, formatYear, formatRating, formatAvg, relativeTime, syncTime, joinNames, formatDelta} from '../../src/js/lib/format.js';
import {parseHash} from '../../src/js/lib/url.js';
import {readRecords} from '../../src/js/card.js';
import {mergeWall, cleanItem} from '../../src/js/lib/wall-merge.js';
import {spineWidth, spineHeight, bindings, displaySurname, deriveCatalog, viewModel} from '../../src/build/derive.mjs';
import {safeFragment} from '../../src/build/sanitize.mjs';
import {unsafeHtml} from '../../lib/schema.mjs';
import {badgeFor, shelfMessage, mailtoFor} from '../../src/js/recommend.js';
import {sample} from './helpers.mjs';

test('format: years, including BCE', () => {
  assert.equal(formatYear(-385), 'c. 385 BCE');
  assert.equal(formatYear(2008), '2008');
  assert.equal(formatYear(null), 'Unknown');
  assert.equal(formatYear(0), 'Unknown');
});

test('format: ratings, averages, deltas, names', () => {
  assert.equal(formatRating(5), '5');
  assert.equal(formatRating(4.25), '4.25');
  assert.equal(formatAvg(4.1), '4.10');
  assert.equal(formatDelta(0.79), '+0.79');
  assert.equal(formatDelta(-0.9), '−0.90');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('format: dates never say "Sept" and are read literally', () => {
  assert.equal(formatDay('2025-09-04'), '4 Sep 2025');
  assert.equal(formatDay('20251004'), '4 Oct 2025');
  assert.equal(formatDay('2026-01-01'), '1 Jan 2026');
});

test('format: relative and Chicago sync times', () => {
  const now = Date.parse('2026-10-11T16:00:00Z');
  assert.equal(relativeTime('2026-10-11T14:00:00Z', now), '2 h ago');
  assert.equal(relativeTime('2026-10-08T16:00:00Z', now), '3 days ago');
  assert.equal(relativeTime('2026-10-11T15:59:50Z', now), 'just now');
  assert.equal(syncTime('2026-10-11T14:17:03Z'), '11 Oct 2026, 09:17 CDT');
  assert.equal(syncTime('2026-01-15T14:17:03Z'), '15 Jan 2026, 08:17 CST');
});

test('url: #book/ deep links only', () => {
  assert.equal(parseHash('#book/anathem-stephenson'), 'anathem-stephenson');
  assert.equal(parseHash('#book/gr-2845024'), 'gr-2845024');
  assert.equal(parseHash('#read'), null);
  assert.equal(parseHash('#book/<script>'), null);
});

test('card records: defaults fill the fields the build leaves out; bad JSON is no records', () => {
  const [r] = readRecords('[{"i":"x","t":"T","au":"A","fav":"2"}]');
  assert.deepEqual(r, {s: null, sub: '', r: 0, wr: null, p: null, y: null, d: '', ra: '', fav: '2', alt: [], c: null, gr: null, ser: '', i: 'x', t: 'T', au: 'A'});
  assert.deepEqual(readRecords('{nope'), []);
  assert.deepEqual(readRecords(undefined), []);
});

test('wall merge: live list wins, identical list is a no-op, new ids flagged', () => {
  const items = [{id: '3'}, {id: '2'}];
  assert.equal(mergeWall(['3', '2'], items).changed, false);
  const m = mergeWall(['2', '1'], items);
  assert.equal(m.changed, true);
  assert.deepEqual(m.items.map(x => [x.item.id, x.isNew]), [['3', true], ['2', false]]);
  assert.equal(cleanItem({id: '1', title: '  '}), null);
  assert.equal(cleanItem({id: 'x', title: 'T'}), null);
  const c = cleanItem({id: 5, title: 'T'.repeat(500), author: 7, email: 'a@b.c', name: 'N', note: 'n', date: '2026-10-01', coverId: -3, olWork: 'bad'});
  assert.equal(c.title.length, 200);
  assert.equal(c.author, '');
  assert.equal(c.coverId, null);
  assert.equal(c.olWork, null);
  assert.ok(!('email' in c));
});

test('derive: spine geometry', () => {
  assert.equal(spineWidth(100, 'gr-1'), 24);
  assert.equal(spineWidth(300, 'gr-1'), 27);
  assert.equal(spineWidth(937, 'gr-1'), 59);
  assert.equal(spineWidth(1200, 'gr-1'), 64);
  for (let i = 0; i < 200; i++) {
    const w = spineWidth(null, `gr-${i}`), h = spineHeight(`gr-${i}`);
    assert.ok(w >= 26 && w <= 34);
    assert.ok(h >= 78 && h <= 100);
    assert.equal(h, spineHeight(`gr-${i}`));
  }
});

test('derive: bindings, surnames, favourites order and review dedupe', async () => {
  const fav = t => ({tier: t, rank: t === 1 ? 1 : null, order: 1, position: 1, groupId: 'g', score: t === 1 ? '11/10' : null, bylineHtml: '', noteHtml: ''});
  assert.deepEqual(bindings({shelf: 'read', rating: 5, favourite: null}), ['g']);
  assert.deepEqual(bindings({shelf: 'read', rating: 5, favourite: fav(1)}), ['g', 'x']);
  assert.deepEqual(bindings({shelf: 'read', rating: 4, favourite: null}), ['t4']);
  assert.deepEqual(bindings({shelf: 'read', rating: 3, favourite: null}), []);
  assert.deepEqual(bindings({shelf: 'to-read', rating: 0, favourite: null}), []);
  assert.equal(displaySurname('Ursula K. Le Guin'), 'Le Guin');
  assert.equal(displaySurname('Martin Luther King Jr.'), 'King');
  assert.equal(displaySurname('Plato'), 'Plato');
  const cat = await sample();
  const d = deriveCatalog(cat);
  assert.equal(d.tier1.length, 2);
  assert.deepEqual(d.favourites.map(m => m.slug), ['godel-escher-bach-hofstadter', 'zero-to-one-thiel', ...d.tier2Groups.flatMap(g => g.books.map(m => m.slug))]);
  assert.ok(d.favourites.some(m => m.slug === 'the-art-of-learning-waitzkin' && !m.shelf), 'favourites-only books are in the list');
  assert.ok(!('read' in d) && !('toRead' in d), 'no shelves are derived any more');
  const b = structuredClone(cat.books.find(x => x.slug === 'godel-escher-bach-hofstadter'));
  b.reviewHtml = `<p>${b.favourite.noteHtml}</p>`;
  assert.equal(viewModel(b).review, null, 'a review that repeats the note is dropped');
  b.reviewHtml = '<p>Something else entirely, and quite long enough to differ.</p>';
  assert.ok(viewModel(b).review);
});

test('sanitise: allowlist only, safe links, escaped text', () => {
  const out = safeFragment('<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://ok.org" target="_blank">ok</a> <em>e</em> <b>b</b> <img src=x onerror=alert(1)> 1 < 2 & 3</p><style>p{}</style>', {block: true});
  assert.equal(out, '<p>Hi bad <a href="https://ok.org" rel="noopener">ok</a> <em>e</em> <strong>b</strong>  1 &lt; 2 &amp; 3</p>');
  assert.deepEqual(unsafeHtml(out), []);
  assert.equal(safeFragment('<p>a</p>'), 'a', 'inline mode drops blocks');
  assert.equal(safeFragment('<a href="mailto:m@x.org">m</a>'), '<a href="mailto:m@x.org" rel="noopener">m</a>');
  assert.equal(safeFragment('<a href=" java\tscript:alert(1)">x</a>'), 'x');
});

test('browser helpers: recommend messages', () => {
  assert.equal(badgeFor({s: 'read', r: 5, f: null}), 'Read · 5★');
  assert.equal(badgeFor({s: 'read', r: 5, f: '1:4'}), 'Nº 4');
  assert.equal(badgeFor({s: 'to-read', r: 0, f: null}), 'Antilibrary');
  assert.match(shelfMessage({s: 'did-not-finish', r: 0, f: null}), /gave up/);
  assert.match(shelfMessage({s: 'to-read', r: 0, f: null}), /antilibrary/);
  const m = mailtoFor('m@x.org', {title: 'Dune & more', author: 'Herbert', note: 'Spice', name: 'Ana'});
  assert.ok(m.startsWith('mailto:m@x.org?subject=Book%20recommendation%3A%20Dune%20%26%20more&body='));
  assert.ok(decodeURIComponent(m).includes('— Ana'));
});

test('postcards: a stable tilt, note sizes, Open Library cover URLs', async () => {
  const {tiltFor, noteSize, coverUrl} = await import('../../src/js/lib/postcard.js');
  assert.equal(tiltFor('14'), tiltFor('14'));
  for (const id of ['1', '9', '14', '123', '99999']) assert.ok(Math.abs(+tiltFor(id)) <= 1.4, id);
  assert.equal(noteSize('Short and sweet.'), 's');
  assert.equal(noteSize('x'.repeat(120)), 'm');
  assert.equal(noteSize('x'.repeat(280)), 'l');
  assert.equal(coverUrl(116079), 'https://covers.openlibrary.org/b/id/116079-M.jpg');
  assert.equal(coverUrl(116079, 'L'), 'https://covers.openlibrary.org/b/id/116079-L.jpg');
});
