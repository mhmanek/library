// End to end over a fake network built from the real fixtures: first sync, a quiet re-run (304s, no writes),
// a failing shelf (last good kept, health recorded), dry run, CI outputs. Plus build() and the workflow text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, copyFile, readFile, readdir, writeFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {sync, parseArgs} from '../../scripts/sync.mjs';
import {build, normalizeBase} from '../../scripts/build.mjs';
import {validateBooks} from '../../lib/schema.mjs';
import {fixture, fakeFetch, fakeClock, xmlResponse, jsonResponse, imageResponse, makeImage, withTempDir} from './helpers.mjs';

const ROOT = new URL('../../', import.meta.url);
const shelfPages = async () => {
  const empty = await fixture('goodreads/currently-reading-empty.xml');
  const emptyOf = s => empty.replace(/bookshelf: currently-reading/g, `bookshelf: ${s}`).replace(/shelf=currently-reading/g, `shelf=${s}`);
  return {
    'read': [await fixture('goodreads/read-sample.xml'), emptyOf('read')],
    'currently-reading': [empty],
    'did-not-finish': [await fixture('goodreads/did-not-finish.xml'), emptyOf('did-not-finish')],
    'to-read': [await fixture('goodreads/to-read-p1.xml'), await fixture('goodreads/to-read-p2.xml'), await fixture('goodreads/to-read-p3-empty.xml')],
  };
};

async function network({failShelf = null} = {}) {
  const pages = await shelfPages();
  const post = await fixture('substack/books-full.json');
  const cover = await makeImage({w: 300, h: 450, blocks: [{x: 0, y: 0, w: 300, h: 220, color: '#6b2737'}]});
  return fakeFetch([
    [u => u.includes('/review/list_rss/'), (u, init) => {
      const q = new URL(u).searchParams, shelf = q.get('shelf'), page = Number(q.get('page'));
      if (shelf === failShelf) return new Response('down', {status: 500});
      const tag = `W/"${shelf}-${page}"`;
      if (init.headers?.['If-None-Match'] === tag) return xmlResponse(null, {status: 304, etag: tag});
      return xmlResponse(pages[shelf][page - 1] ?? pages[shelf].at(-1), {etag: tag});
    }],
    [u => u.includes('/api/v1/posts/books'), () => new Response(post, {status: 200, headers: {'content-type': 'application/json'}})],
    [u => u.startsWith('https://openlibrary.org/search.json'), () => jsonResponse({numFound: 0, docs: []})],
    [u => /\.(jpe?g|png)(\?|$)/i.test(u) || u.includes('covers.openlibrary.org'), () => imageResponse(cover)],
  ]);
}

async function makeRoot(dir) {
  await mkdir(join(dir, 'data', 'manual'), {recursive: true});
  await copyFile(new URL('config.json', ROOT), join(dir, 'config.json'));
  for (const f of ['favourites-map.json', 'overrides.json']) await copyFile(new URL(`data/manual/${f}`, ROOT), join(dir, 'data', 'manual', f));
}
const files = async dir => (await readdir(dir, {recursive: true})).map(f => f.replace(/\\/g, '/')).sort();

test('sync: first run, quiet re-run, failing shelf, dry run, CI outputs', async () => withTempDir(async root => {
  await makeRoot(root);
  const clock = fakeClock();
  const env = {};
  const quiet = () => {};
  const f1 = await network();
  const r1 = await sync({root, env, fetchImpl: f1, ...clock, log: quiet, args: {maxCovers: 2000}});
  assert.equal(r1.exitCode, 0);
  assert.deepEqual(validateBooks(r1.catalog), []);
  assert.deepEqual(r1.written.sort(), ['data/covers.json', 'data/goodreads/currently-reading.json', 'data/goodreads/did-not-finish.json', 'data/goodreads/read.json',
    'data/goodreads/to-read.json', 'data/openlibrary.json', 'data/substack/favourites.json', 'data/sync.json', 'data/wall.json']);
  const syncJson = JSON.parse(await readFile(join(root, 'data/sync.json'), 'utf8'));
  assert.equal(syncJson.syncedAt, '2026-10-11T14:17:03Z');
  assert.equal(syncJson.sources.goodreads.changedAt, syncJson.syncedAt);
  assert.ok(f1.calls.every(c => c.headers['User-Agent'] === 'mhmanek-library-sync/1.0 (+https://github.com/mhmanek/library)'));
  const read = await readFile(join(root, 'data/goodreads/read.json'), 'utf8');
  assert.match(read, /^\{\n  "shelf": "read",\n  "channelTitle": "Malhar's bookshelf: read",\n  "count": 26,\n  "etags": \["W\/\\"read-1\\"","W\/\\"read-2\\""\],\n  "items": \[\n    \{"bookId":"629",/);
  assert.ok(read.endsWith('}\n') && !read.includes('\r'), 'LF endings');
  const covers = (await files(join(root, 'covers')));
  assert.ok(covers.length >= 2 && covers.every(f => /^[0-9a-f]{16}-(200|400)\.webp$/.test(f)), covers.join());
  assert.match(await readFile(join(root, '.cache/commit-message.txt'), 'utf8'), /^Sync: /);
  assert.match(await readFile(join(root, '.cache/summary.md'), 'utf8'), /\| Goodreads \| ok \| read 26/);

  // Same data again: Goodreads answers 304, Substack is unchanged, Open Library is cached -> nothing written.
  clock.advance(6 * 36e5);
  const f2 = await network();
  const r2 = await sync({root, env, fetchImpl: f2, ...clock, log: quiet, args: {}});
  assert.deepEqual(r2.written, [], 'no-op runs touch nothing');
  assert.equal(f2.calls.filter(c => c.url.includes('openlibrary.org/search')).length, 0, 'Open Library misses are cached');
  assert.equal(r2.message.split('\n')[0], 'Sync: data refresh');

  // to-read fails: its last good copy stays, the run exits 1 locally, health records the start of the outage.
  clock.advance(36e5);
  const before = await readFile(join(root, 'data/goodreads/to-read.json'), 'utf8');
  const out = join(root, 'gh-output.txt');
  await writeFile(out, '');
  const t3 = new Date(clock.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r3 = await sync({root, env: {GITHUB_OUTPUT: out}, fetchImpl: await network({failShelf: 'to-read'}), ...clock, log: quiet, args: {}});
  assert.equal(r3.exitCode, 1);
  assert.equal(await readFile(join(root, 'data/goodreads/to-read.json'), 'utf8'), before);
  assert.deepEqual(r3.written, ['data/sync.json']);
  const health = JSON.parse(await readFile(join(root, 'data/sync.json'), 'utf8'));
  assert.equal(health.sources.goodreads.failingSince, t3);
  assert.equal(health.syncedAt, '2026-10-11T14:17:03Z', 'syncedAt moves only when published data changes');
  assert.equal(await readFile(out, 'utf8'), '', 'GITHUB_OUTPUT only with --ci');

  // CI, 13 h into the outage: exit 0, alert through GITHUB_OUTPUT.
  clock.advance(13 * 36e5);
  const r4 = await sync({root, env: {GITHUB_OUTPUT: out}, fetchImpl: await network({failShelf: 'to-read'}), ...clock, log: quiet, args: {ci: true}});
  assert.equal(r4.exitCode, 0);
  assert.equal(await readFile(out, 'utf8'), `alert=true\nalert_message=goodreads failing since ${t3} (http-500)\n`);

  // Dry run: writes only under .cache/dry-run, fetches no covers.
  const dataBefore = await files(join(root, 'data'));
  const f5 = await network();
  const r5 = await sync({root, env, fetchImpl: f5, ...clock, log: quiet, args: {dryRun: true}});
  assert.equal(r5.exitCode, 0);
  assert.deepEqual(await files(join(root, 'data')), dataBefore);
  assert.ok(f5.calls.every(c => !/\.(jpe?g|png)/.test(c.url) && !c.url.includes('openlibrary')), 'dry run makes no cover or Open Library requests');
  assert.ok((await stat(join(root, '.cache/dry-run/data/sync.json'))).isFile());
}));

test('sync flags and environment', () => {
  const o = parseArgs(['--dry-run', '--only', 'goodreads,substack', '--skip', 'covers', '--max-covers', '2000', '--ci'], {ALLOW_DROP: 'true', REFRESH: 'false', MAX_COVERS: ''});
  assert.deepEqual([o.dryRun, [...o.only], [...o.skip], o.maxCovers, o.ci, o.allowDrop, o.refresh], [true, ['goodreads', 'substack'], ['covers'], 2000, true, true, false]);
  assert.equal(parseArgs([], {MAX_COVERS: '120'}).maxCovers, 120);
  assert.throws(() => parseArgs(['--only', 'margins']), /unknown source/);
  assert.throws(() => parseArgs(['--nope']), /unknown flag/);
});

test('build: hands the validated catalog to src/build/site.mjs with a normalised base', async () => withTempDir(async root => {
  await makeRoot(root);
  await expectError(() => build({root}), /src\/build\/site\.mjs does not exist yet/);
  await mkdir(join(root, 'src', 'build'), {recursive: true});
  await writeFile(join(root, 'src', 'build', 'site.mjs'), 'export async function buildSite(args) { return {files: [], report: null, args}; }\n');
  const r = await build({root, base: 'library', siteUrl: 'https://mhmanek.github.io/library/', now: '2026-10-11T23:59:00Z'});
  assert.equal(r.args.base, '/library/');
  assert.equal(r.args.siteUrl, 'https://mhmanek.github.io/library');
  assert.equal(r.args.buildDate, '20261011');
  assert.deepEqual(r.args.wall, {items: []});
  assert.deepEqual(validateBooks(r.args.catalog), []);
  assert.equal(r.args.outDir, join(root, 'site'));
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('build must not touch the network'); };
  try { await build({root, base: '/'}); } finally { globalThis.fetch = fetchBefore; }
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase(''), '/');
  assert.equal(normalizeBase('//library//'), '/library/');
  const dev = await build({root, dev: true});
  assert.equal(dev.args.siteUrl, 'http://localhost:8080/library');
}));

async function expectError(fn, re) { await assert.rejects(fn, e => re.test(e.message)); }

test('workflow: schedule, concurrency, action majors, permissions, no keepalive, no script injection', async () => {
  const y = await readFile(new URL('.github/workflows/sync.yml', ROOT), 'utf8');
  assert.match(y, /cron: '17 \*\/6 \* \* \*'/);
  assert.match(y, /concurrency:\n  group: pages\n  cancel-in-progress: false/);
  for (const a of ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'actions/deploy-pages@v5']) assert.ok(y.includes(`uses: ${a}`), a);
  assert.match(y, /node-version: 24/);
  assert.match(y, /^permissions: \{\}$/m);
  assert.match(y, /permissions:\n      contents: write[^\n]*\n      pages: read/);
  assert.match(y, /permissions:\n      pages: write\n      id-token: write/);
  assert.match(y, /node scripts\/build\.mjs --base "\$BASE_PATH\/" --site-url "\$BASE_URL"/);
  assert.match(y, /if: github\.event_name != 'schedule' \|\| steps\.commit\.outputs\.changed == 'true'/);
  assert.ok(!/keepalive|keep-alive|heartbeat/i.test(y.replace(/No keepalive of any kind/, '')), 'no keepalive');
  // Expressions never appear inside run: scripts; values reach the shell through env only.
  const runBlocks = [...y.matchAll(/run: (\|\n(?: {10,}.*\n)+|.*\n)/g)].map(m => m[1]);
  assert.ok(runBlocks.length > 5);
  for (const r of runBlocks) assert.ok(!r.includes('${{'), r);
});
