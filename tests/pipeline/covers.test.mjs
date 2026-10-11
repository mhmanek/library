// Cover candidates, checks, processing, the shared walk, budgets and garbage collection; colour extraction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {coverCandidates, chooseCover, coverObject, checkImage, processImage, ensureCovers, gcCovers, coverHash, PIPELINE} from '../../lib/covers.mjs';
import {extractColors, placeholderColors, pickColors, GILT} from '../../lib/colors.mjs';
import {createHttp} from '../../lib/http.mjs';
import {hexToOklch, contrast} from '../../lib/color-math.mjs';
import {fakeFetch, fakeClock, imageResponse, makeImage, withTempDir} from './helpers.mjs';

const GR = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1/';
const book = (over = {}) => ({id: 'gr-1', goodreadsId: '1', mergedIds: ['2'], substackImage: null, ol: null,
  members: [{image: `${GR}1._SY475_.jpg`, editionCover: 11, workCover: 12}, {image: `${GR}2._SX98_.jpg`, editionCover: null, workCover: 22}], ...over});

test('candidate order: override > substack > Goodreads originals (primary first) > OL edition > OL work', () => {
  const c = coverCandidates(book({substackImage: 'https://substack-post-media.s3.amazonaws.com/public/images/x_1x2.jpeg'}),
    {overrides: {covers: {2: 'https://example.org/override.jpg'}}});
  assert.deepEqual(c.map(x => [x.source, x.url.replace(GR, 'GR/')]), [
    ['override', 'https://example.org/override.jpg'], ['substack', 'https://substack-post-media.s3.amazonaws.com/public/images/x_1x2.jpeg'],
    ['goodreads', 'GR/1.jpg'], ['goodreads', 'GR/1._SX400_.jpg'], ['goodreads', 'GR/2.jpg'], ['goodreads', 'GR/2._SX400_.jpg'],
    ['openlibrary', 'https://covers.openlibrary.org/b/id/11-L.jpg?default=false'],
    ['openlibrary', 'https://covers.openlibrary.org/b/id/12-L.jpg?default=false'], ['openlibrary', 'https://covers.openlibrary.org/b/id/22-L.jpg?default=false']]);
  const ok = {s: 'ok', hash: 'aaaaaaaaaaaaaaaa', w: 400, h: 600, square: false, colors: placeholderColors('x')};
  const cands = coverCandidates(book());
  assert.equal(chooseCover(cands, {[`${GR}1._SX400_.jpg`]: ok}), null, 'SX400 only counts after the original failed with HTTP');
  assert.equal(chooseCover(cands, {[`${GR}1.jpg`]: {s: 'bad', why: 'http-403'}, [`${GR}1._SX400_.jpg`]: ok}).url, `${GR}1._SX400_.jpg`);
  assert.equal(chooseCover(cands, {[`${GR}1.jpg`]: {s: 'bad', why: 'small'}, [`${GR}2.jpg`]: ok}).url, `${GR}2.jpg`);
  const p = coverObject({id: 'gr-1'}, null);
  assert.deepEqual([p.stem, p.src, p.src2x, p.w, p.h, p.source], [null, null, null, 400, 600, 'placeholder']);
  const o = coverObject({id: 'gr-1'}, {source: 'goodreads', entry: ok});
  assert.deepEqual([o.src, o.src2x, o.stem], ['covers/aaaaaaaaaaaaaaaa-200.webp', 'covers/aaaaaaaaaaaaaaaa-400.webp', 'aaaaaaaaaaaaaaaa']);
});

test('checkImage rejects tiny, gif, small, wide and blank images; accepts square art', async () => {
  assert.equal((await checkImage(Buffer.from('GIF89a\x01\x00\x01\x00'))).why, 'tiny');
  assert.equal((await checkImage(await makeImage({w: 200, h: 300, format: 'gif', blocks: [{x: 0, y: 0, w: 100, h: 300, color: '#aa0000'}]}))).why, 'gif');
  let seed = 7;
  const speckle = Buffer.from(Array.from({length: 120 * 180 * 3}, () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256));
  assert.equal((await checkImage(await sharp(speckle, {raw: {width: 120, height: 180, channels: 3}}).png().toBuffer())).why, 'small');
  assert.equal((await checkImage(await makeImage({w: 600, h: 300}))).why, 'aspect');
  assert.equal((await checkImage(await makeImage({w: 300, h: 450, fill: '#777777', noise: false}))).why, 'blank');
  assert.equal((await checkImage(Buffer.alloc(5000, 7))).why, 'decode');
  const sq = await checkImage(await makeImage({w: 1500, h: 1500, blocks: [{x: 100, y: 100, w: 600, h: 600, color: '#aa3322'}]}));
  assert.deepEqual([sq.ok, sq.square], [true, true]);
  const normal = await checkImage(await makeImage({w: 318, h: 440, blocks: [{x: 10, y: 10, w: 100, h: 100, color: '#223388'}]}));
  assert.deepEqual([normal.ok, normal.square], [true, false]);
});

test('processImage: sha256-named 200/400 WebP files, shared by identical sources, never enlarged', async () => withTempDir(async dir => {
  const img = await makeImage({w: 318, h: 440, blocks: [{x: 20, y: 20, w: 200, h: 200, color: '#1e2f5c'}]});
  const a = await processImage(img, {dir, originalsDir: join(dir, 'orig')});
  assert.match(a.hash, /^[0-9a-f]{16}$/);
  assert.equal(a.hash, coverHash(img));
  assert.deepEqual([a.w, a.h], [318, 440], 'the "400" file of a 318-wide original stays 318 wide');
  const b = await processImage(img, {dir});
  assert.equal(b.hash, a.hash);
  assert.deepEqual((await readdir(dir)).filter(f => f.endsWith('.webp')).sort(), [`${a.hash}-200.webp`, `${a.hash}-400.webp`]);
  assert.equal(PIPELINE, 1);
}));

test('ensureCovers: first ok wins, 403 moves on, transient errors count to 3, budget stops work', async () => withTempDir(async dir => {
  const good = await makeImage({w: 300, h: 450, blocks: [{x: 0, y: 0, w: 300, h: 200, color: '#8a3f24'}]});
  let flaky = 0;
  const f = fakeFetch([
    [u => u.includes('/1.jpg'), () => new Response('Forbidden', {status: 403})],
    [u => u.includes('/1._SX400_.jpg'), () => new Response('Forbidden', {status: 403})],
    [u => u.includes('/2.jpg'), () => { flaky++; return new Response('busy', {status: 503}); }],
    [u => u.includes('covers.openlibrary.org'), () => imageResponse(good)],
  ]);
  const http = createHttp({userAgent: 'x-agent/1', fetchImpl: f, ...fakeClock()});
  const b = {...book(), candidates: coverCandidates(book())};
  const r = await ensureCovers([b], {entries: {}}, {http, dir, maxNew: 10});
  const e = r.cache.entries;
  assert.deepEqual(e[`${GR}1.jpg`], {s: 'bad', why: 'http-403'});
  assert.deepEqual(e[`${GR}1._SX400_.jpg`], {s: 'bad', why: 'http-403'});
  assert.deepEqual(e[`${GR}2.jpg`], {s: 'err', n: 1});
  assert.equal(e['https://covers.openlibrary.org/b/id/11-L.jpg?default=false'].s, 'ok');
  assert.equal(chooseCover(b.candidates, e).source, 'openlibrary');
  // Better pending candidates are retried on later runs until they become bad/retries.
  let cache = r.cache;
  for (let run = 2; run <= 3; run++) cache = (await ensureCovers([b], cache, {http, dir, maxNew: 10})).cache;
  assert.deepEqual(cache.entries[`${GR}2.jpg`], {s: 'bad', why: 'retries'});
  assert.equal(flaky, 6, 'two attempts per run, three runs');
  // Budget 0: nothing fetched, the work is pending.
  const none = await ensureCovers([{...b}], {entries: {}}, {http, dir, maxNew: 0});
  assert.equal(none.stats.fetched, 0);
  assert.equal(none.stats.pending, 1);
  const late = await ensureCovers([{...b}], {entries: {}}, {http, dir, maxNew: 10, deadline: 0, now: () => 1});
  assert.equal(late.stats.fetched, 0, 'past the deadline');
  const dry = await ensureCovers([{...b}], {entries: {}}, {http, dir, dryRun: true});
  assert.deepEqual([dry.stats.fetched, dry.stats.wouldFetch], [0, 1]);
}));

test('gcCovers drops unchosen entries and orphaned files', async () => withTempDir(async dir => {
  await mkdir(dir, {recursive: true});
  for (const f of ['aaaaaaaaaaaaaaaa-200.webp', 'aaaaaaaaaaaaaaaa-400.webp', 'bbbbbbbbbbbbbbbb-200.webp', 'bbbbbbbbbbbbbbbb-400.webp', 'notes.txt']) await writeFile(join(dir, f), 'x');
  const ok = h => ({s: 'ok', hash: h, w: 400, h: 600, square: false, colors: placeholderColors(h)});
  const cache = {pipeline: 1, entries: {'https://a/chosen.jpg': ok('aaaaaaaaaaaaaaaa'), 'https://a/old.jpg': ok('bbbbbbbbbbbbbbbb'),
    'https://a/bad.jpg': {s: 'bad', why: 'small'}, 'https://a/gone.jpg': {s: 'bad', why: 'small'}}};
  const books = [{coverUrl: 'https://a/chosen.jpg', candidates: [{url: 'https://a/bad.jpg'}, {url: 'https://a/chosen.jpg'}]}];
  const r = await gcCovers(cache, books, dir);
  assert.deepEqual(Object.keys(r.cache.entries).sort(), ['https://a/bad.jpg', 'https://a/chosen.jpg']);
  assert.deepEqual(r.removed.sort(), ['bbbbbbbbbbbbbbbb-200.webp', 'bbbbbbbbbbbbbbbb-400.webp']);
  assert.deepEqual((await readdir(dir)).sort(), ['aaaaaaaaaaaaaaaa-200.webp', 'aaaaaaaaaaaaaaaa-400.webp', 'notes.txt']);
}));

test('colours: art beats a white background, clamps, spine strip, gilt fallback, ink by contrast, deterministic', async () => {
  const red = await extractColors(await makeImage({w: 300, h: 450, fill: '#ffffff', blocks: [{x: 60, y: 120, w: 180, h: 200, color: '#c81e28'}]}));
  const o = hexToOklch(red.bg);
  assert.ok(o.h < 40 || o.h > 340, `bg ${red.bg} should be red, not white`);
  const white = await extractColors(await makeImage({w: 300, h: 450, fill: '#ffffff', blocks: [{x: 40, y: 200, w: 220, h: 6, color: '#111111'}]}));
  assert.ok(hexToOklch(white.bg).l <= 0.861, `bg ${white.bg} clamped to L <= 0.86`);
  assert.equal(white.accent, GILT, 'monochrome cover falls back to gilt');
  const navy = await extractColors(await makeImage({w: 300, h: 450, fill: '#0b1634', blocks: [{x: 50, y: 50, w: 40, h: 40, color: '#d9b45a'}]}));
  assert.ok(hexToOklch(navy.bg).h > 230 && hexToOklch(navy.bg).h < 290, `navy bg ${navy.bg}`);
  assert.equal(navy.bgInk, '#f1e7d2', 'light ink on navy');
  const strip = await extractColors(await makeImage({w: 300, h: 450, fill: '#f4f0e6', blocks: [{x: 0, y: 0, w: 36, h: 450, color: '#23443a'}]}));
  assert.ok(Math.abs(hexToOklch(strip.spine).h - hexToOklch('#23443a').h) < 20, `spine ${strip.spine} from the left strip`);
  for (const c of [red, white, navy, strip]) {
    for (const [ink, on] of [[c.ink, c.spine], [c.bgInk, c.bg]]) {
      const other = ink === '#1d1a15' ? '#f1e7d2' : '#1d1a15';
      assert.ok(contrast(ink, on) >= contrast(other, on), 'the higher-contrast ink is chosen');
    }
    for (const v of Object.values(c)) assert.match(v, /^#[0-9a-f]{6}$/);
  }
  const img = await makeImage({w: 300, h: 450, blocks: [{x: 10, y: 10, w: 100, h: 300, color: '#4b2e4f'}]});
  assert.deepEqual(await extractColors(img), await extractColors(img));
  assert.deepEqual(placeholderColors('gr-1'), placeholderColors('gr-1'));
  assert.equal(pickColors([{hex: '#ffffff', l: 1, c: 0, p: 0.7}, {hex: '#c81e28', l: 0.54, c: 0.2, p: 0.3}], []).bg, '#c81e28');
});
