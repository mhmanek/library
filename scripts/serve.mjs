#!/usr/bin/env node
// Dev server mimicking GitHub Pages: the site mounted at http://localhost:8080/library/, 404.html for
// misses (with a 404 status), rebuilds on change. Mock Worker endpoints answer at /wall, /recommend and
// /mock/* so the visitor shelf and the returns slot work locally with Turnstile's always-pass test key.
//   node scripts/serve.mjs [--fixture] [--no-watch] [--port 8080] [--no-worker]
//   --fixture   build from tests/fixtures/catalog-sample.json (covers from tests/fixtures/frontend/covers)
// Test recommendation outcomes by putting test:400, test:403, test:429 or test:502 in the title.
import {createServer} from 'node:http';
import {readFile, stat, access} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join, extname, normalize, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const port = Number(args[args.indexOf('--port') + 1]) || 8080;
const fixture = flag('--fixture');
const origin = `http://localhost:${port}`;
const TEST_SITEKEY = '1x00000000000000000000AA';
const base = '/library/';
const outDir = fixture ? join(root, '.cache', 'site-fixture') : join(root, 'site');
const workerUrl = flag('--no-worker') ? null : origin;

const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'};

async function buildFixture() {
  const {buildSite, formatReport} = await import(pathToFileURL(join(root, 'src/build/site.mjs')).href);
  const {loadConfig} = await import(pathToFileURL(join(root, 'lib/config.mjs')).href);
  const config = await loadConfig(root, {});
  // The validator only allows a bare http://localhost origin, so the mock answers at the server root.
  config.visitorShelf = {workerUrl, turnstileSiteKey: workerUrl ? TEST_SITEKEY : null};
  const catalog = JSON.parse(await readFile(join(root, 'tests/fixtures/catalog-sample.json'), 'utf8'));
  const wall = JSON.parse(await readFile(join(root, 'tests/fixtures/frontend/wall-sample.json'), 'utf8'));
  const r = await buildSite({catalog, wall, config, root, outDir, base, siteUrl: `${origin}/library`, dev: true, coversDir: join(root, 'tests/fixtures/frontend/covers')});
  return formatReport(r.report);
}

async function buildReal() {
  if (workerUrl) { process.env.LIBRARY_WORKER_URL ??= workerUrl; process.env.LIBRARY_TURNSTILE_SITEKEY ??= TEST_SITEKEY; }
  const {build} = await import(pathToFileURL(join(root, 'scripts/build.mjs')).href);
  const {formatReport} = await import(pathToFileURL(join(root, 'src/build/site.mjs')).href);
  const r = await build({root, out: 'site', base, siteUrl: `${origin}/library`, dev: true});
  return r?.report ? formatReport(r.report) : 'built';
}

const hasPipeline = await access(join(root, 'scripts/build.mjs')).then(() => true, () => false);
// Each rebuild runs in a fresh child process: Node caches ES modules, so an in-process rebuild would keep
// serving the old templates.
if (flag('--build-only')) {
  try { console.log(await (fixture || !hasPipeline ? buildFixture() : buildReal())); process.exit(0); }
  catch (err) { console.error(`build failed: ${err.stack ?? err.message}`); process.exit(1); }
}
let building = null, queued = false;
function rebuild() {
  if (building) { queued = true; return building; }
  const t0 = Date.now();
  building = new Promise(done => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--build-only', ...args], {stdio: 'inherit'});
    child.on('exit', code => { console.log(`[${new Date().toLocaleTimeString()}] ${code ? 'build FAILED' : 'built'} in ${Date.now() - t0} ms`); done(); });
  }).finally(() => { building = null; if (queued) { queued = false; rebuild(); } });
  return building;
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(), ...extra});
  res.end(JSON.stringify(body));
};
const cors = () => ({'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '86400', vary: 'Origin'});

async function mockWall(res) {
  const file = fixture ? join(root, 'tests/fixtures/frontend/wall-sample.json') : join(root, 'data/wall.json');
  const wall = JSON.parse(await readFile(file, 'utf8').catch(() => '{"items":[]}'));
  // One extra approval the build hasn't seen, so the NEW chip and the runtime merge are visible.
  const items = [{id: '99', title: 'Gödel’s Proof', author: 'Ernest Nagel', olWork: 'OL5567662W', coverId: 4622253, year: 1958, name: 'Sam <script>', note: 'Short and sweet; the perfect chaser to GEB.', date: new Date().toISOString().slice(0, 10)}, ...wall.items];
  json(res, 200, {updatedAt: new Date().toISOString(), items}, {'cache-control': 'public, max-age=300'});
}

async function mockRecommend(req, res) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20000) return json(res, 413, {ok: false, error: 'invalid'}); }
  let data;
  try { data = JSON.parse(body); } catch { return json(res, 400, {ok: false, error: 'invalid', fields: ['title']}); }
  console.log('mock /recommend', {...data, turnstileToken: data.turnstileToken ? '(token)' : null, email: data.email ? '(private)' : ''});
  if (data.website || data.t < 3000) return json(res, 200, {ok: true});
  const t = String(data.title ?? '');
  if (!t.trim() || t.includes('test:400')) return json(res, 400, {ok: false, error: 'invalid', fields: ['title']});
  if (t.includes('test:403')) return json(res, 403, {ok: false, error: 'turnstile'});
  if (t.includes('test:429')) return json(res, 429, {ok: false, error: 'rate_limited', retryAfter: 3600});
  if (t.includes('test:502')) return json(res, 502, {ok: false, error: 'upstream'});
  return json(res, 200, {ok: true});
}

async function serveFile(res, file, status = 200) {
  const data = await readFile(file);
  res.writeHead(status, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
    if (path === '/wall' || path === '/mock/wall') return mockWall(res);
    if ((path === '/recommend' || path === '/mock/recommend') && req.method === 'POST') return mockRecommend(req, res);
    if (path === '/health' || path === '/mock/health') return json(res, 200, {ok: true});
    if (path === '/' || path === '/library') { res.writeHead(302, {location: base}); return res.end(); }
    if (building) await building;
    if (path.startsWith(base)) {
      const rel = normalize(decodeURIComponent(path.slice(base.length))).replace(/^(\.\.[\\/])+/, '');
      let file = join(outDir, rel);
      if (!file.startsWith(outDir)) throw new Error('outside site');
      const s = await stat(file).catch(() => null);
      if (s?.isDirectory()) file = join(file, 'index.html');
      if (await stat(file).then(x => x.isFile(), () => false)) return serveFile(res, file);
    }
    return serveFile(res, join(outDir, '404.html'), 404);
  } catch (err) {
    res.writeHead(500, {'content-type': 'text/plain'});
    res.end(String(err.message));
  }
});

await rebuild();
server.listen(port, () => console.log(`Malhar's Library: ${origin}${base}${fixture ? ' (fixture)' : ''}${workerUrl ? ' · mock Worker at ' + origin : ''}`));
if (!flag('--no-watch')) {
  let timer = 0;
  const kick = () => { clearTimeout(timer); timer = setTimeout(rebuild, 200); };
  for (const p of ['src', 'lib', 'data', 'config.json', ...(fixture ? ['tests/fixtures'] : [])]) {
    try { watch(join(root, p), {recursive: true}, (ev, name) => { if (!String(name).includes('.cache')) kick(); }); } catch { /* path may not exist yet */ }
  }
}
