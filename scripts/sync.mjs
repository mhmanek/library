#!/usr/bin/env node
// Network stage: the only code that touches the network. Fetches and validates each source (a failing source
// keeps its last good copy), enriches new books from Open Library, downloads new covers, updates health, and
// writes deterministic data files only when their bytes change. See .cache/summary.md after a run.
//   node scripts/sync.mjs [--dry-run] [--only goodreads,substack,wall,openlibrary,covers] [--skip …]
//                         [--allow-drop] [--refresh] [--max-covers N] [--ci] [--verbose]
// Env (workflow inputs): ALLOW_DROP=true, REFRESH=true, MAX_COVERS=N; GITHUB_EVENT_NAME decides "interactive".
// Exit codes: 0 ok; 1 a source failed (its last good copy was kept); 2 config error or crash. With --ci: 0
// unless config error or crash, because alerts travel through $GITHUB_OUTPUT instead.
import {join, resolve, relative} from 'node:path';
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig, SHELVES} from '../lib/config.mjs';
import {stableStringify, writeIfChanged} from '../lib/json.mjs';
import {createHttp} from '../lib/http.mjs';
import {syncGoodreads} from '../lib/goodreads.mjs';
import {syncSubstack} from '../lib/substack.mjs';
import {syncWall} from '../lib/wall.mjs';
import {enrichOpenLibrary, needsLookup} from '../lib/openlibrary.mjs';
import {ensureCovers, gcCovers} from '../lib/covers.mjs';
import {updateHealth} from '../lib/health.mjs';
import {loadData, assemble, catalogFrom} from '../lib/catalog.mjs';
import {diffCatalog, commitMessage, renderSummary, alertMessage} from '../lib/report.mjs';

export const SOURCES = ['goodreads', 'substack', 'wall', 'openlibrary', 'covers'];
const isoNow = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function parseArgs(argv, env = {}) {
  const o = {dryRun: false, only: null, skip: new Set(), allowDrop: env.ALLOW_DROP === 'true', refresh: env.REFRESH === 'true',
    maxCovers: /^\d+$/.test(env.MAX_COVERS ?? '') ? Number(env.MAX_COVERS) : null, ci: false, verbose: false};
  const list = v => {
    const s = new Set(String(v ?? '').split(',').map(x => x.trim()).filter(Boolean));
    for (const x of s) if (!SOURCES.includes(x)) throw new Error(`unknown source "${x}" (expected ${SOURCES.join(', ')})`);
    return s;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--only') o.only = list(next());
    else if (a === '--skip') o.skip = list(next());
    else if (a === '--allow-drop') o.allowDrop = true;
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--max-covers') { const v = next(); if (!/^\d+$/.test(v)) throw new Error('--max-covers needs a number'); o.maxCovers = Number(v); }
    else if (a === '--ci') o.ci = true;
    else if (a === '--verbose') o.verbose = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return o;
}

export function dataFiles(next) {
  const files = {};
  for (const shelf of SHELVES) if (next.goodreads[shelf]) files[`data/goodreads/${shelf}.json`] = stableStringify(next.goodreads[shelf], {records: ['items']});
  if (next.substack) files['data/substack/favourites.json'] = stableStringify(next.substack, {records: ['entries']});
  files['data/wall.json'] = stableStringify(next.wall ?? {items: []}, {records: ['items']});
  files['data/openlibrary.json'] = stableStringify(next.openlibrary, {records: ['entries']});
  files['data/covers.json'] = stableStringify(next.covers, {records: ['entries']});
  return files;
}
const readOr = p => readFile(p, 'utf8').catch(() => null);
const published = c => JSON.stringify({counts: c.counts, stats: c.stats, books: c.books});

export async function sync(opts = {}) {
  const {root = process.cwd(), env = process.env, fetchImpl, sleep, now = Date.now, log = console.log} = opts;
  const o = {dryRun: false, only: null, skip: new Set(), allowDrop: false, refresh: false, maxCovers: null, ci: false, verbose: false, ...opts.args};
  const started = now();
  const config = await loadConfig(root, env);
  const prev = await loadData(root);
  const http = createHttp({userAgent: config.sync.userAgent, fetchImpl, sleep, onRequest: o.verbose ? r => log(`GET ${r.url}`) : undefined});
  const on = s => (!o.only || o.only.has(s)) && !o.skip.has(s);
  const interactive = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const outcomes = {};
  const next = structuredClone(prev);

  // 1. Sources, one after another to stay polite.
  let shelves = {};
  if (on('goodreads')) {
    const gr = await syncGoodreads(prev.goodreads, {http, config, allowDrop: o.allowDrop, log});
    next.goodreads = {...prev.goodreads, ...gr.snapshots};
    shelves = gr.shelves;
    outcomes.goodreads = {ok: gr.ok, error: gr.error};
  } else outcomes.goodreads = {skipped: true};
  if (on('substack')) {
    const s = await syncSubstack(prev.substack, {http, config, log});
    next.substack = s.snapshot;
    outcomes.substack = {ok: s.ok, error: s.error, detail: s.snapshot ? `${s.snapshot.entries.length} entries, post updated ${s.snapshot.updatedAt ?? '?'}` : ''};
  } else outcomes.substack = {skipped: true};
  if (on('wall')) {
    const w = await syncWall(prev.wall, {http, config, log});
    next.wall = w.snapshot;
    outcomes.wall = w.skipped ? {skipped: true, detail: 'no visitorShelf.workerUrl yet'} : {ok: w.ok, error: w.error, detail: `${w.snapshot.items.length} items`};
  } else outcomes.wall = {skipped: true};

  // 2. Open Library for books not yet in the committed cache.
  let olStats = {skipped: true};
  if (on('openlibrary')) {
    const pre = assemble(next, config);
    const seen = new Set();
    const targets = [];
    for (const r of pre.records) if (!seen.has(r.goodreadsId)) { seen.add(r.goodreadsId); targets.push({key: r.goodreadsId, goodreadsId: r.goodreadsId, isbn10: r.isbn10, isbn13: r.isbn13, title: r.title, authors: r.authors}); }
    for (const b of pre.books.filter(b => !b.goodreadsId)) targets.push({key: b.olKey, goodreadsId: null, isbn10: b.isbn10, isbn13: b.isbn13, title: [b.title, b.subtitle].filter(Boolean).join(': '), authors: b.authors});
    const retryDays = config.sync.olMissRetryDays ?? 90;
    if (o.dryRun) {
      const wanted = targets.filter(t => needsLookup(prev.openlibrary.entries[t.key], {now, refresh: o.refresh, retryDays})).length;
      olStats = {wanted, requests: 0, hits: 0, misses: 0, deferred: wanted, circuitOpen: false};
      log(`openlibrary: ${wanted} lookups needed (dry run: none made)`);
    } else {
      const r = await enrichOpenLibrary(targets, prev.openlibrary, {http, now, refresh: o.refresh, budget: config.sync.maxOlQueriesPerRun ?? 200, retryDays, log});
      next.openlibrary = r.cache;
      olStats = {...r.stats, circuitOpen: r.circuitOpen};
      log(`openlibrary: ${r.stats.requests} requests, ${r.stats.hits} hits, ${r.stats.misses} misses, ${r.stats.deferred} deferred`);
    }
  }

  // 3. Covers, best books first, within the per-run budget and (in CI) a 10-minute deadline.
  let coverStats = {skipped: true};
  const coversDir = join(root, 'covers');
  if (on('covers')) {
    const a = assemble(next, config);
    const maxNew = o.maxCovers ?? config.sync.maxNewCoversPerRun ?? 120;
    const r = await ensureCovers(a.books, next.covers, {http, dir: coversDir, originalsDir: join(root, '.cache', 'originals'), maxNew,
      deadline: o.ci ? started + 10 * 60_000 : Infinity, refresh: o.refresh, dryRun: o.dryRun, now, log});
    next.covers = r.cache;
    coverStats = r.stats;
  }
  const finalAssembly = assemble(next, config);
  if (on('covers')) {
    const gc = await gcCovers(next.covers, finalAssembly.books, coversDir, {dryRun: o.dryRun});
    next.covers = gc.cache;
    coverStats.removed = gc.removed.length;
  }

  // 4. Health, syncedAt and the deterministic writes.
  // One timestamp per run (its start) for syncedAt, changedAt and health, so they agree with each other.
  const health = updateHealth(prev.sync?.sources ?? {}, outcomes, started, {interactive});
  const files = dataFiles(next);
  const outDir = o.dryRun ? join(root, '.cache', 'dry-run') : root;
  const before = Object.fromEntries(await Promise.all(Object.keys(files).map(async f => [f, await readOr(join(root, f))])));
  const differs = f => files[f] !== before[f];
  const prevCatalog = catalogFrom(assemble(prev, config), prev, config);
  const nextCatalog = catalogFrom(finalAssembly, {...next, sync: prev.sync}, config);
  const publishedChanged = published(prevCatalog) !== published(nextCatalog) || differs('data/wall.json');
  const stamp = isoNow(started);
  const changedAt = {
    goodreads: SHELVES.some(s => files[`data/goodreads/${s}.json`] && differs(`data/goodreads/${s}.json`)),
    substack: !!files['data/substack/favourites.json'] && differs('data/substack/favourites.json'),
    wall: differs('data/wall.json') && !outcomes.wall.skipped,
  };
  const sources = {};
  for (const [k, v] of Object.entries(health.sources)) sources[k] = {...v, changedAt: changedAt[k] ? stamp : v.changedAt};
  next.sync = {syncedAt: publishedChanged ? stamp : prev.sync?.syncedAt ?? null, sources};
  files['data/sync.json'] = stableStringify(next.sync);

  // A dry run reports what would change in data/ (not in its own scratch copy) and writes only under .cache/dry-run.
  before['data/sync.json'] = await readOr(join(root, 'data/sync.json'));
  const written = [];
  for (const [f, text] of Object.entries(files)) {
    const wrote = await writeIfChanged(join(outDir, f), text);
    if (o.dryRun ? text !== before[f] : wrote) written.push(f);
  }

  // 5. Reports.
  const finalCatalog = catalogFrom(finalAssembly, next, config);
  const diff = diffCatalog(prevCatalog, finalCatalog);
  const summary = renderSummary({nowIso: stamp, outcomes, shelves, ol: olStats, covers: coverStats, diff,
    warnings: finalAssembly.warnings, alerts: health.alerts, dryRun: o.dryRun, written});
  const counts = Object.entries(shelves).map(([s, x]) => `${s}=${x.count}`).join(' ');
  const message = commitMessage({diff, outcomes, wallDiff: differs('data/wall.json'), sources: {goodreads: {counts}}});
  await mkdir(join(root, '.cache'), {recursive: true});
  await writeFile(join(root, '.cache', 'summary.md'), summary);
  await writeFile(join(root, '.cache', 'commit-message.txt'), message);
  if (o.ci && env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `alert=${health.alerts.length ? 'true' : 'false'}\nalert_message=${alertMessage(health.alerts)}\n`);
  }
  const failed = Object.values(outcomes).some(x => x && !x.ok && !x.skipped);
  return {outcomes, shelves, olStats, coverStats, written, alerts: health.alerts, catalog: finalCatalog, warnings: finalAssembly.warnings,
    summary, message, exitCode: o.ci ? 0 : failed ? 1 : 0};
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  let args;
  try { args = parseArgs(process.argv.slice(2), process.env); }
  catch (err) { console.error(`sync: ${err.message}`); process.exit(2); }
  try {
    const r = await sync({args});
    const c = r.catalog.counts;
    console.log(`\nbooks: read ${c.read}, reading ${c.reading}, dnf ${c.dnf}, to-read ${c.toRead}, favourites ${c.favourites} (${c.favouritesOnly} favourites-only)`);
    console.log(r.written.length ? `${args.dryRun ? 'would change' : 'wrote'} ${r.written.join(', ')}` : 'no data files changed');
    if (r.warnings.length) console.log(`warnings:\n  ${r.warnings.join('\n  ')}`);
    if (r.alerts.length) console.log(`ALERT: ${alertMessage(r.alerts)}`);
    console.log(`summary: ${relative(process.cwd(), join(process.cwd(), '.cache', 'summary.md'))}`);
    process.exit(r.exitCode);
  } catch (err) {
    console.error(`sync crashed: ${err.stack ?? err}`);
    process.exit(2);
  }
}
