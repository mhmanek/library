// The shared contract: the sample catalog validates, and the shared matcher honours the calibrated traps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBooks, validateWall, unsafeHtml} from '../lib/schema.mjs';
import {fold, slug, shortTitle, surname, markers, similarity} from '../src/shared/normalize.js';
import {sameWork, findInIndex} from '../src/shared/match.js';
import {contrast, hexToOklch, oklchToHex} from '../lib/color-math.mjs';
import {stableStringify} from '../lib/json.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/catalog-sample.json', import.meta.url), 'utf8'));

test('sample catalog satisfies the books.json contract', () => {
  assert.deepEqual(validateBooks(sample), []);
});

test('sample catalog is sorted the way the contract says', async () => {
  const {sortKey} = await import('../src/shared/normalize.js');
  const rank = s => ['read', 'currently-reading', 'did-not-finish', 'to-read', null].indexOf(s);
  const sorted = [...sample.books].sort((a, b) => rank(a.shelf) - rank(b.shelf)
    || (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || (sortKey(a.title) < sortKey(b.title) ? -1 : sortKey(a.title) > sortKey(b.title) ? 1 : 0)
    || (a.id < b.id ? -1 : 1));
  assert.deepEqual(sample.books.map(b => b.id), sorted.map(b => b.id));
});

test('validator rejects unsafe HTML and emails on the wall', () => {
  assert.ok(unsafeHtml('<script>x</script>').length);
  assert.ok(unsafeHtml('<a href="javascript:alert(1)">x</a>').length);
  assert.ok(unsafeHtml('<a href="https://x.org" onclick="x">x</a>').length);
  assert.deepEqual(unsafeHtml('<p><em>a</em> <a href="https://x.org" rel="noopener">b</a><br></p>'), []);
  assert.ok(validateWall({items: [{id: '1', title: 't', author: '', name: '', note: '', date: '2026-10-11', email: 'a@b.c', coverId: null, olWork: null}]}).length);
});

test('fold and friends', () => {
  assert.equal(fold('Gödel, Escher, Bach '), 'godel escher bach');
  assert.equal(fold('Surely You’re Joking, Mr. Feynman!'), 'surely youre joking mr feynman');
  assert.equal(fold('Invent & Wander'), 'invent and wander');
  assert.equal(fold('三体'), '三体');
  assert.equal(slug('The Left Hand of Darkness'), 'the-left-hand-of-darkness');
  assert.equal(shortTitle('Foundation (Foundation, #1)'), 'foundation');
  assert.equal(shortTitle('Buffett: The Making of an American Capitalist'), 'buffett');
  assert.equal(surname('Ursula K. Le Guin'), 'guin');
  assert.equal(surname('Martin Luther King Jr.'), 'king');
  assert.equal(markers('Knit India Through Literature Vol III').volume, 3);
  assert.equal(markers('John Maynard Keynes: Hopes Betrayed, 1883-1920').years, '1883-1920');
  assert.ok(similarity('kitten', 'sitting') > 0.5 && similarity('a', 'a') === 1);
});

test('sameWork: merges real editions, refuses the traps', () => {
  const w = (title, authors, extra = {}) => ({title, authors, ...extra});
  assert.ok(sameWork(w('Buffett: The Making of an American Capitalist', ['Roger Lowenstein']), w('Buffett', ['Roger Lowenstein'])));
  assert.ok(sameWork(w('The Cyberiad', ['Stanisław Lem']), w('The Cyberiad: Fables for the Cybernetic Age', ['Stanislaw Lem'])));
  assert.ok(!sameWork(w('The Outsiders', ['S.E. Hinton']), w('The Outsiders', ['Rachel Thorndike'])));
  assert.ok(!sameWork(w('Elon Musk', ['Walter Isaacson']), w('Elon Musk', ['Ashlee Vance'])));
  assert.ok(!sameWork(w('Knit India Through Literature Vol I', ['Sivasankari']), w('Knit India Through Literature Vol II', ['Sivasankari'])));
  assert.ok(!sameWork(w('John Maynard Keynes: Hopes Betrayed, 1883-1920', ['Robert Skidelsky']), w('John Maynard Keynes: The Economist as Saviour, 1920-1937', ['Robert Skidelsky'])));
  assert.ok(!sameWork(w('The Black Swan: Summary', ['Instaread Summaries']), w('The Black Swan', ['Nassim Nicholas Taleb'])));
  assert.ok(!sameWork(w('Les Misérables (Classics Illustrated, #9)', ['Victor Hugo']), w('Les Misérables', ['Victor Hugo'])));
});

test('findInIndex matches by work key or title + surname', () => {
  const index = [{i: 'anathem-stephenson', s: 'read', r: 5, f: null, ol: 'OL5720023W', t: 'anathem', a: ['stephenson']}];
  assert.equal(findInIndex({title: 'Anathem', author: 'Neal Stephenson'}, index)?.i, 'anathem-stephenson');
  assert.equal(findInIndex({title: 'Whatever', author: 'X', olWork: 'OL5720023W'}, index)?.i, 'anathem-stephenson');
  assert.equal(findInIndex({title: 'Anathem', author: 'Someone Else'}, index), null);
});

test('colour maths round-trips and measures contrast', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(contrast('#efe4c8', '#0b1634') > 13);
  assert.equal(oklchToHex(hexToOklch('#d9b45a')), '#d9b45a');
});

test('stableStringify prints one record per line and sorts maps', () => {
  const text = stableStringify({a: 1, items: [{x: 1}, {x: 2}], map: {b: 2, a: 1}}, {records: ['items', 'map']});
  assert.equal(text, '{\n  "a": 1,\n  "items": [\n    {"x":1},\n    {"x":2}\n  ],\n  "map": {\n    "a": 1,\n    "b": 2\n  }\n}\n');
});
