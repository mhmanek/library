// The built site: escaping, conditional sections, accessibility basics, CSP, the 404 forwarder, budgets
// and the check-site gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {buildFixture, sample, sampleWall, config, synthCatalog} from './helpers.mjs';
import {BOOTSTRAP, sha256, buildCsp} from '../../src/templates/head.mjs';
import {forwardScript, renderNotFound} from '../../src/templates/notfound.mjs';
import {checkSite} from '../../scripts/check-site.mjs';
import {validateBooks} from '../../lib/schema.mjs';

const live = {visitorShelf: {workerUrl: 'https://library-recs.example.workers.dev', turnstileSiteKey: '1x00000000000000000000AA'}};
const count = (html, re) => (html.match(re) ?? []).length;

test('the sample builds into a complete site that passes check-site', async () => {
  const {outDir, files, report} = await buildFixture();
  for (const f of ['index.html', '404.html', 'data/books.json', 'data/match.json', 'data/wall.json', 'data/stacks.json', 'og.png', 'favicon.svg']) assert.ok(files.includes(f), f);
  assert.deepEqual(report.missingCovers, []);
  const {errors} = await checkSite(outDir);
  assert.deepEqual(errors, []);
  const books = JSON.parse(await readFile(join(outDir, 'data/books.json'), 'utf8'));
  assert.deepEqual(validateBooks(books), []);
  const match = JSON.parse(await readFile(join(outDir, 'data/match.json'), 'utf8'));
  assert.deepEqual(match.find(e => e.i === 'godel-escher-bach-hofstadter'), {i: 'godel-escher-bach-hofstadter', s: 'read', r: 5, f: '1:1', ol: 'OL1952763W', t: 'godel escher bach', a: ['hofstadter']});
  assert.equal(match.find(e => e.i === 'anathem-stephenson').f, '2:');
  await rm(outDir, {recursive: true, force: true});
});

test('untrusted text is escaped everywhere; sanitised notes keep their links', async () => {
  const cat = await sample();
  cat.books[0].title = '<script>alert("t")</script>';
  cat.books[0].authors = ['"><img src=x onerror=alert(1)>'];
  const wall = {items: [{id: '1', title: '<img src=x onerror=alert(2)>', author: '</h3><script>', olWork: null, coverId: null, year: null, name: '<b>N</b>', note: '"}</script><script>alert(3)</script>', date: '2026-10-01'}]};
  const {html, outDir} = await buildFixture({catalog: cat, wall, cfg: await config(live)});
  assert.ok(!html.includes('<script>alert'), 'no injected script');
  assert.ok(!/<img src=x/i.test(html), 'no injected img');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b&gt;N&lt;/b&gt;'));
  assert.ok(html.includes('<a href="https://malharmanek.substack.com/p/thieleology" rel="noopener">this essay</a>'));
  const boot = /<script type="application\/json" id="boot">([^<]*)<\/script>/.exec(html);
  assert.ok(boot && JSON.parse(boot[1]).worker === live.visitorShelf.workerUrl);
  await rm(outDir, {recursive: true, force: true});
});

test('conditional sections: reading now, Margins, the form or the postcard', async () => {
  const base = await buildFixture();
  assert.ok(base.html.includes('id="now"'), 'reading now shows with one book');
  assert.ok(!base.html.includes('data-margins'), 'no Margins card without an id');
  assert.ok(base.html.includes('data-mode="mail"'), 'without a worker the postcard goes out by email');
  assert.ok(!base.html.includes('id="rec-email"') && !base.html.includes('id="rec-ts"'), 'no private email field or Turnstile in email mode');
  assert.ok(base.html.includes('mailto:malhar.manek@gmail.com'));
  assert.ok(base.html.includes('id="visitors"'), 'the snapshot alone shows the visitor shelf');

  const cat = await sample();
  cat.books = cat.books.filter(b => b.shelf !== 'currently-reading');
  cat.counts.reading = 0; cat.stats.reading.count = 0; cat.sources.goodreads.items['currently-reading'] = 0;
  const id = '0123456789abcdef0123456789abcdef';
  const on = await buildFixture({catalog: cat, wall: {items: []}, cfg: await config({...live, margins: {userId: id}})});
  assert.ok(!on.html.includes('id="now"'), 'reading now absent when empty');
  assert.ok(on.html.includes(`https://margins.app/api/og?userId=${id}&amp;v=20261011`));
  assert.ok(on.html.includes('data-mode="post"') && on.html.includes('id="rec-email"') && on.html.includes('id="rec-ts"'));
  assert.ok(on.html.includes('name="website"'), 'honeypot');
  assert.ok(on.html.includes('mailto:'), 'the email fallback is always there');
  const nums = [...on.html.matchAll(/<span class="n" aria-hidden="true">(\d+)<\/span>/g)].map(m => +m[1]);
  assert.deepEqual(nums, nums.map((_, i) => i + 1), 'section numbers are contiguous');
  for (const r of [base, on]) await rm(r.outDir, {recursive: true, force: true});
});

test('accessibility basics: one h1, landmarks, unique ids, alt on every img, named buttons', async () => {
  const {html, outDir} = await buildFixture({cfg: await config(live)});
  assert.equal(count(html, /<h1[\s>]/g), 1);
  for (const re of [/<header[\s>]/, /<nav[^>]*aria-label="Sections"/, /<main id="main"/, /role="search"/, /<footer[\s>]/, /<dialog id="card"/]) assert.match(html, re);
  assert.match(html, /<html lang="en-GB"/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  for (const img of html.match(/<img\b[^>]*>/g)) assert.match(img, /\salt="/, img);
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const name = m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.ok(name || /aria-label="[^"]+"/.test(m[1]), `unnamed button: ${m[0].slice(0, 120)}`);
  }
  assert.ok(!/<base[\s>]/.test(html));
  assert.ok(!/\s(?:src|href)="\/(?!\/)/.test(html), 'index.html uses relative URLs only');
  await rm(outDir, {recursive: true, force: true});
});

test('CSP: first meta, hashes the bootstrap, worker origin only when set, archive.org image hosts', async () => {
  const {html, outDir} = await buildFixture({cfg: await config(live)});
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1].replace(/&#39;/g, "'");
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP precedes every script');
  assert.ok(csp.includes(sha256(BOOTSTRAP)));
  assert.ok(html.includes(`<script>${BOOTSTRAP}</script>`), 'the hashed text is the inline text');
  assert.ok(csp.includes('connect-src \'self\' https://openlibrary.org https://challenges.cloudflare.com https://library-recs.example.workers.dev'));
  for (const host of ['https://covers.openlibrary.org', 'https://archive.org', 'https://*.us.archive.org', 'https://margins.app']) assert.ok(csp.includes(host), host);
  assert.ok(csp.includes('frame-src https://challenges.cloudflare.com'));
  assert.ok(csp.includes("base-uri 'none'") && csp.includes('upgrade-insecure-requests'));
  assert.ok(!buildCsp({workerUrl: null}).includes('workers.dev'));
  assert.ok(!buildCsp({dev: true}).includes('upgrade-insecure-requests'), 'dev keeps http://localhost working');
  await rm(outDir, {recursive: true, force: true});
});

test('404: base-absolute assets, its own script hash, and the forwarder', async () => {
  for (const base of ['/library/', '/']) {
    const page = renderNotFound({base, css: 'assets/app.css?v=x', siteUrl: 'https://example.org'});
    assert.ok(page.includes(`href="${base}assets/app.css?v=x"`));
    assert.ok(page.includes(sha256(forwardScript(base)).replace(/'/g, '&#39;')));
  }
  const run = path => {
    let to = null;
    const a = {href: '', hidden: true, firstChild: {textContent: ''}};
    vm.runInNewContext(forwardScript('/library/'), {location: {pathname: path, replace: u => { to = u; }}, document: {getElementById: () => a}, encodeURIComponent, decodeURIComponent});
    return to ?? a.href;
  };
  assert.equal(run('/library/book/anathem-stephenson'), '/library/#book/anathem-stephenson');
  assert.equal(run('/library/book/anathem-stephenson/'), '/library/#book/anathem-stephenson');
  assert.equal(run('/library/antilibrary'), '/library/#antilibrary');
  assert.equal(run('/library/no-such-thing'), '/library/?q=no%20such%20thing');
});

test('budget: a 1,100-book library stays within the gzip budgets', async () => {
  const cat = synthCatalog({read: 170, toRead: 928, dnf: 3});
  assert.deepEqual(validateBooks(cat), []);
  const {outDir, report} = await buildFixture({catalog: cat, wall: {items: []}, cfg: await config(live)});
  assert.ok(report.gzip.html <= 130 * 1024, `index.html ${report.gzip.html}`);
  assert.ok(report.gzip.css <= 16 * 1024, `css ${report.gzip.css}`);
  assert.ok(report.gzip.js <= 20 * 1024, `js ${report.gzip.js}`);
  const rec = await readFile(join(outDir, 'assets/js/recommend.js'));
  assert.ok(gzipSync(rec).length <= 9 * 1024, 'recommend.js');
  const {errors} = await checkSite(outDir);
  assert.deepEqual(errors, []);
  await rm(outDir, {recursive: true, force: true});
});

test('check-site catches secrets, a <base>, broken links and missing covers', async () => {
  const {outDir} = await buildFixture();
  const index = join(outDir, 'index.html');
  const html = await readFile(index, 'utf8');
  await writeFile(index, html.replace('<head>', '<head><base href="/">').replace('</body>', `<a href="nope.html">x</a><!-- ${'gh' + 'p_'}${'a'.repeat(36)} --></body>`));
  await rm(join(outDir, 'covers/a1b2c3d4e5f60718-200.webp'));
  const {errors} = await checkSite(outDir);
  const all = errors.join('\n');
  assert.match(all, /<base>/);
  assert.match(all, /broken link nope\.html/);
  assert.match(all, /looks like a secret/);
  assert.match(all, /missing cover covers\/a1b2c3d4e5f60718-200\.webp/);
  await rm(outDir, {recursive: true, force: true});
});

test('visitor shelf: approved recommendations are postcards that turn over', async () => {
  const {html, outDir} = await buildFixture();
  const cards = html.split('<li class="vcard"').slice(1);
  assert.equal(cards.length, 2);
  const [lem, leguin] = cards;
  assert.match(lem, /^ data-id="14" style="--tilt:-?\d\.\d\ddeg"/);
  assert.ok(lem.includes('<input type="checkbox" class="pc-tog" aria-label="Turn over the postcard for The Cyberiad">'), 'a no-JS turn-over control');
  assert.ok(lem.includes('class="pc-cover" src="https://covers.openlibrary.org/b/id/116079-M.jpg"'), 'the cover is the picture side');
  assert.ok(lem.includes('<p class="pc-note" data-size="s">Robots writing poetry'), 'the note, in handwriting');
  assert.ok(lem.includes('<time datetime="2026-10-03">3 Oct 2026</time>'), 'postmarked with the date');
  assert.ok(leguin.includes('<span class="pc-ph"><b>The Dispossessed</b>'), 'no cover: a cloth placeholder');
  assert.ok(leguin.includes('</span>a visitor</p>'), 'unsigned cards are from a visitor');
  assert.ok(leguin.includes('&lt;b&gt;Not&lt;/b&gt; HTML'), 'notes stay plain text');
  await rm(outDir, {recursive: true, force: true});
});
