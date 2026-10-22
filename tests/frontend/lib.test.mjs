// Pure browser libraries (format, wall merge, postcards, recommend messages) and the build's derive and
// sanitise steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDay, formatNumber, joinNames} from '../../src/js/lib/format.js';
import {mergeWall, cleanItem} from '../../src/js/lib/wall-merge.js';
import {spineWidth, spineHeight, bindings, displaySurname, deriveCatalog, viewModel} from '../../src/build/derive.mjs';
import {safeFragment} from '../../src/build/sanitize.mjs';
import {unsafeHtml} from '../../lib/schema.mjs';
import {badgeFor, shelfMessage, mailtoFor, olQuery, cleanDocs} from '../../src/js/recommend.js';
import {sample} from './helpers.mjs';

test('format: numbers and names', () => {
  assert.equal(formatNumber(1093), '1,093');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('format: dates never say "Sept" and are read literally', () => {
  assert.equal(formatDay('2025-09-04'), '4 Sep 2025');
  assert.equal(formatDay('20251004'), '4 Oct 2025');
  assert.equal(formatDay('2026-01-01'), '1 Jan 2026');
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

test('browser helpers: book search matches the word being typed as a prefix, minus junk and repeats', () => {
  assert.equal(olQuery('Harry Pot'), 'harry pot*');
  assert.equal(olQuery('harry potter '), 'harry potter', 'a finished word is matched whole');
  assert.equal(olQuery('Totto-chan: "the" (sequel) a'), 'totto chan the sequel a', 'Solr syntax is stripped; one letter is no prefix');
  assert.equal(olQuery('  '), '');
  const d = (title, author, coverId = null) => ({title, author, coverId, year: null, olWork: null});
  const out = cleanDocs([d('Atomic Habits', 'James Clear'), d('Summary of Atomic Habits by James Clear', 'X'), d('Companion Workbook : Atomic Habits', 'Y'),
    d('A Macat Analysis of Daniel Kahneman\'s Thinking, Fast and Slow', 'Z'), d('Atomic habits', 'James  Clear', 7), d('Atomic Habits Journal', 'W')]);
  assert.deepEqual(out.map(x => [x.title, x.coverId]), [['Atomic habits', 7], ['Atomic Habits Journal', null]], 'the repeat with a cover wins');
  assert.equal(cleanDocs(Array.from({length: 20}, (_, i) => d(`Book ${i}`, 'A'))).length, 8);
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
