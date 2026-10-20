// Pure browser libraries (format, sort, search, url, wall merge) and the build's derive and sanitise steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDay, formatYear, formatRating, formatAvg, relativeTime, syncTime, joinNames, formatDelta} from '../../src/js/lib/format.js';
import {comparator, COMPARATORS} from '../../src/js/lib/sort.js';
import {tokens, haystack, matches} from '../../src/js/lib/search.js';
import {parseState, serializeState, parseHash} from '../../src/js/lib/url.js';
import {mergeWall, cleanItem} from '../../src/js/lib/wall-merge.js';
import {spineWidth, spineHeight, bindings, displaySurname, deriveCatalog, viewModel} from '../../src/build/derive.mjs';
import {safeFragment} from '../../src/build/sanitize.mjs';
import {unsafeHtml} from '../../lib/schema.mjs';
import {hueOf} from '../../src/js/shelf.js';
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

const key = (o, i) => ({r: 0, wr: null, p: null, y: null, d: '', hue: 0, t: '', s: '', fr: null, i, ...o});
const order = (sort, rows) => rows.map(key).sort(comparator(sort)).map(k => k.t);

test('sort: unknowns last, BCE first, articles and surnames', () => {
  assert.deepEqual(order('long', [{t: 'a', p: null}, {t: 'b', p: 900}, {t: 'c', p: 100}]), ['b', 'c', 'a']);
  assert.deepEqual(order('old', [{t: 'mod', y: 2008}, {t: 'none', y: null}, {t: 'plato', y: -385}]), ['plato', 'mod', 'none']);
  assert.deepEqual(order('author', [{t: 'x', s: 'lem'}, {t: 'y', s: 'adams'}]), ['y', 'x']);
  assert.deepEqual(order('', [{t: 'z'}, {t: 'a'}]), ['z', 'a'], 'shelf order keeps the build order');
  assert.deepEqual(order('love', [{t: 'kind', r: 5, wr: 3.9}, {t: 'unrated', r: 0, wr: 4}, {t: 'harsh', r: 2, wr: 4.1}]), ['kind', 'harsh', 'unrated']);
});

test('sort: the read default is rating, then my ranking, then the crowd', () => {
  const rows = [{t: 'b', r: 5, wr: 4.5, fr: null}, {t: 'a', r: 5, wr: 4.0, fr: 2}, {t: 'c', r: 5, wr: 4.1, fr: 1}, {t: 'd', r: 4, wr: 4.9}].map(key);
  assert.deepEqual(rows.sort(COMPARATORS.best).map(k => k.t), ['c', 'a', 'b', 'd']);
});

test('sort: title sort ignores a leading article (via sortKey keys from the build)', async () => {
  const cat = await sample();
  const d = deriveCatalog(cat);
  const keys = d.toRead.map(m => m.keys.t);
  assert.ok(keys.includes('cyberiad'), keys.join());
});

test('search: folded, ANDed word prefixes', () => {
  const geb = haystack('Gödel, Escher, Bach', 'An Eternal Golden Braid', '', 'Douglas R. Hofstadter');
  const lem = haystack('The Cyberiad', '', '', 'Stanisław Lem');
  assert.ok(matches(geb, tokens('godel')));
  assert.ok(matches(geb, tokens('GÖDEL, bach!')));
  assert.ok(matches(lem, tokens('lem')));
  assert.ok(matches(lem, tokens('stanislaw cyber')));
  assert.ok(!matches(lem, tokens('lem asimov')));
  assert.ok(!matches(haystack('A Problem Book', '', '', 'X'), tokens('lem')), 'prefix, not substring');
});

test('url state round-trips and omits defaults', () => {
  assert.deepEqual(parseState(''), {view: 'shelf', sort: '', q: '', gilt: false});
  const s = {view: 'covers', sort: 'old', q: 'le guin', gilt: true};
  assert.deepEqual(parseState(serializeState(s)), s);
  assert.equal(serializeState({view: 'shelf', sort: '', q: '', gilt: false}), '');
  assert.equal(serializeState({view: 'list', sort: '', q: '', gilt: false}, '?utm_source=x'), '?utm_source=x&view=list');
  assert.equal(parseState('?view=evil&sort=drop').view, 'shelf');
  assert.equal(parseHash('#book/anathem-stephenson'), 'anathem-stephenson');
  assert.equal(parseHash('#book/gr-2845024'), 'gr-2845024');
  assert.equal(parseHash('#read'), null);
  assert.equal(parseHash('#book/<script>'), null);
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

test('derive: bindings, surnames, orders and review dedupe', async () => {
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
  assert.deepEqual(d.read.map(m => m.slug).slice(0, 2), ['godel-escher-bach-hofstadter', 'zero-to-one-thiel']);
  assert.deepEqual(d.toRead.map(m => m.slug), ['the-cyberiad-lem', 'the-left-hand-of-darkness-le-guin']);
  assert.equal(d.tier1.length, 2);
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

test('browser helpers: colour keys and recommend messages', () => {
  assert.ok(hueOf('#ffffff') >= 400 && hueOf('#ff0000') === 0 && hueOf('#0000ff') === 240);
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
