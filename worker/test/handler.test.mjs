import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../src/index.js';
import {parseBlock, WALL_KEY} from '../src/lib.js';
import {validateWall} from '../../lib/schema.mjs';
import {memoryKV, fakeGitHub, fakeSiteverify, fakeFetch, PASS_SECRET, FAIL_SECRET} from '../scripts/fakes.mjs';

const API = 'https://api.github.test';
const SITE = 'https://mhmanek.github.io';
const BASE = 'https://library-recs.example.workers.dev';

function rig({secret = PASS_SECRET, hostnames = 'mhmanek.github.io,localhost,example.com', svStatus = 200, env: extra = {}} = {}) {
  let clock = Date.parse('2026-10-11T17:00:00Z');
  const github = fakeGitHub({clock: () => clock});
  const siteverify = fakeSiteverify({status: svStatus});
  const fetch = fakeFetch({github, siteverify, api: API});
  const env = {ALLOWED_ORIGINS: `${SITE},http://localhost:8080`, INBOX_REPO: 'mhmanek/library-inbox', TURNSTILE_HOSTNAMES: hostnames,
    GITHUB_API: API, TIMEZONE: 'America/Chicago', GITHUB_TOKEN: 'test-token', TURNSTILE_SECRET: secret, RECS: memoryKV(), ...extra};
  const handle = createHandler({fetch, now: () => clock, uuid: () => 'uuid-1'});
  return {github, siteverify, fetch, env, handle, tick: ms => { clock += ms; }};
}

const rec = (over = {}) => ({title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', olWork: 'OL2010879W', coverId: 8231856, year: 1979,
  note: 'The strange loop.', name: 'Priya', email: 'priya@example.org', website: '', t: 12000, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', ...over});

function post(r, body, {ip = '203.0.113.7', origin = SITE, type = 'application/json', raw} = {}) {
  const headers = {'Content-Type': type, 'CF-Connecting-IP': ip};
  if (origin) headers.Origin = origin;
  return r.handle(new Request(`${BASE}/recommend`, {method: 'POST', headers, body: raw ?? JSON.stringify(body)}), r.env);
}
const get = (r, path, origin = SITE) => r.handle(new Request(`${BASE}${path}`, {headers: origin ? {Origin: origin} : {}}), r.env);
const created = r => r.github.requests.filter(x => x.method === 'POST' && x.path.endsWith('/issues'));
const noSecrets = text => { for (const s of ['test-token', PASS_SECRET]) assert.ok(!text.includes(s), `response leaks ${s}`); };

test('POST /recommend files a private issue', async () => {
  const r = rig();
  const res = await post(r, rec());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {ok: true});
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');

  assert.deepEqual(r.siteverify.calls, [{secret: PASS_SECRET, response: 'XXXX.DUMMY.TOKEN.XXXX', idempotency_key: 'uuid-1', remoteip: '203.0.113.7'}]);
  const [req] = created(r);
  assert.equal(req.path, '/repos/mhmanek/library-inbox/issues');
  assert.equal(req.headers.authorization, 'Bearer test-token');
  assert.match(req.headers['user-agent'], /^mhmanek-library-recs\//);
  assert.equal(req.headers['x-github-api-version'], '2022-11-28');
  const sent = JSON.parse(req.body);
  assert.equal(sent.title, '📚 Gödel, Escher, Bach — Douglas Hofstadter');
  assert.deepEqual(sent.labels, ['recommendation']);
  const data = parseBlock(sent.body);
  assert.deepEqual(data, {v: 1, title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', olWork: 'OL2010879W', coverId: 8231856, year: 1979,
    note: 'The strange loop.', name: 'Priya', email: 'priya@example.org', submittedAt: '2026-10-11T17:00:00.000Z'});

  const [w] = r.env.RECS.writes;
  assert.match(w.key, /^ip:[0-9a-f]{40}$/);
  assert.equal(w.opts.expirationTtl, 86400);
  assert.ok(!w.value.includes('203.0.113.7'));
});

test('honeypot and fast forms get a fake 200 and touch nothing', async () => {
  for (const over of [{website: 'http://spam.example'}, {t: 900}, {t: undefined}]) {
    const r = rig();
    const res = await post(r, rec(over));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {ok: true});
    assert.equal(r.siteverify.calls.length, 0);
    assert.equal(r.github.requests.length, 0);
    assert.equal(r.env.RECS.writes.length, 0);
  }
});

test('validation errors name the fields before Turnstile is spent', async () => {
  const r = rig();
  const res = await post(r, rec({title: '', email: 'not-an-email', note: 'x'.repeat(281)}));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {ok: false, error: 'invalid', fields: ['title', 'note', 'email']});
  assert.equal(r.siteverify.calls.length, 0);
});

test('malformed, oversized or non-JSON bodies are 400 body', async () => {
  const r = rig();
  for (const opts of [{raw: '{nope'}, {raw: '[1]'}, {raw: 'null'}, {type: 'text/plain'}, {raw: JSON.stringify(rec({note: 'x'.repeat(9000)}))}]) {
    const res = await post(r, rec(), opts);
    assert.equal(res.status, 400, JSON.stringify(opts).slice(0, 60));
    assert.deepEqual((await res.json()).fields, ['body']);
  }
  // A chunked stream with no Content-Length is cut off at the cap too.
  const big = new ReadableStream({start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1000))); c.close(); }});
  const res = await r.handle(new Request(`${BASE}/recommend`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: big, duplex: 'half'}), r.env);
  assert.equal(res.status, 400);
  assert.equal(r.siteverify.calls.length, 0);
});

test('Turnstile: always-fail secret, missing token, wrong hostname, siteverify down', async () => {
  const fail = rig({secret: FAIL_SECRET});
  let res = await post(fail, rec());
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {ok: false, error: 'turnstile'});
  assert.equal(created(fail).length, 0);

  const r = rig();
  res = await post(r, rec({turnstileToken: ''}));
  assert.equal(res.status, 403);
  res = await post(r, rec({turnstileToken: 'x'.repeat(2049)}));
  assert.equal(res.status, 403);
  assert.equal(r.siteverify.calls.length, 0);

  const prod = rig({hostnames: 'mhmanek.github.io'});
  res = await post(prod, rec());
  assert.equal(res.status, 403, 'the test key reports example.com, which production must refuse');
  assert.equal(created(prod).length, 0);

  const down = rig({svStatus: 503});
  res = await post(down, rec());
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), {ok: false, error: 'upstream'});
});

test('throttle: the 6th in an hour is 429, other IPs are unaffected, the window slides', async () => {
  const r = rig();
  for (let i = 1; i <= 5; i++) {
    const res = await post(r, rec({title: `Book ${i}`}));
    assert.equal(res.status, 200, `request ${i}`);
    r.tick(60_000);
  }
  const res = await post(r, rec({title: 'Book 6'}));
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.retryAfter, 3600 - 5 * 60);
  assert.equal(res.headers.get('Retry-After'), String(body.retryAfter));
  assert.equal(created(r).length, 5);
  assert.equal(r.env.RECS.writes.length, 5, 'a 429 costs no KV write');

  assert.equal((await post(r, rec({title: 'Book 7'}), {ip: '198.51.100.1'})).status, 200);
  r.tick(3600_000);
  assert.equal((await post(r, rec({title: 'Book 8'}))).status, 200);
});

test('throttle: 20 a day', async () => {
  const r = rig();
  for (let i = 1; i <= 20; i++) {
    assert.equal((await post(r, rec({title: `Day ${i}`}))).status, 200, `request ${i}`);
    r.tick(15 * 60_000);
  }
  const res = await post(r, rec({title: 'Day 21'}));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).retryAfter, 86400 - 20 * 15 * 60);
});

test('duplicates within 10 minutes are acknowledged but not filed twice', async () => {
  const r = rig();
  assert.equal((await post(r, rec())).status, 200);
  r.tick(5 * 60_000);
  assert.equal((await post(r, rec({title: 'gödel,  escher, bach!'}))).status, 200);
  assert.equal(created(r).length, 1);
  r.tick(6 * 60_000);
  assert.equal((await post(r, rec())).status, 200);
  assert.equal(created(r).length, 2);
});

test('GitHub errors map to 502 and never leak the token', async () => {
  const r = rig();
  r.github.failWith = 500;
  let res = await post(r, rec());
  assert.equal(res.status, 502);
  noSecrets(await res.text());

  const bad = rig({env: {GITHUB_TOKEN: 'wrong'}});
  res = await post(bad, rec());
  assert.equal(res.status, 502);
  noSecrets(await res.text());
});

test('KV failures do not block a recommendation', async () => {
  const r = rig();
  r.env.RECS.failWrites = true;
  assert.equal((await post(r, rec())).status, 200);
  assert.equal(created(r).length, 1);
});

test('missing secrets or binding are a 500, not a crash', async () => {
  for (const env of [{TURNSTILE_SECRET: ''}, {GITHUB_TOKEN: undefined}, {INBOX_REPO: ''}, {RECS: undefined}]) {
    const r = rig({env});
    const res = await post(r, rec());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), {ok: false, error: 'server'});
  }
});

test('an unexpected throw is a 500 with no stack', async () => {
  const r = rig();
  const broken = new ReadableStream({pull(c) { c.error(new Error('socket hang up at secret place')); }});
  const res = await r.handle(new Request(`${BASE}/recommend`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: SITE}, body: broken, duplex: 'half'}), r.env);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(text, '{"ok":false,"error":"server"}');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
});

function seedWall(r) {
  const body = data => '```json\n' + JSON.stringify({v: 1, olWork: null, coverId: null, year: null, ...data}) + '\n```';
  r.github.add({title: 'a', body: body({title: 'Dune', author: 'Frank Herbert', name: 'Ana', note: 'Sand.', email: 'ana@example.org'}),
    labels: ['recommendation', 'approved'], created_at: '2026-10-02T15:00:00Z'});
  r.github.add({title: 'b', body: body({title: 'Spam', email: 'x@example.org'}), labels: ['recommendation', 'approved', 'spam'], created_at: '2026-10-03T15:00:00Z'});
  r.github.add({title: 'c', body: body({title: 'Pending', email: 'p@example.org'}), labels: ['recommendation'], created_at: '2026-10-04T15:00:00Z'});
  r.github.add({title: 'd', body: 'edited away the block', labels: ['approved'], created_at: '2026-10-05T15:00:00Z'});
  r.github.add({title: 'e', body: body({title: 'The Cyberiad', author: 'Stanisław Lem', name: '', note: '', coverId: 8231856, olWork: 'OL1W', year: 1965}),
    labels: ['approved'], state: 'closed', created_at: '2026-10-06T04:00:00Z'});
}

test('GET /wall: approved, mapped, email-free, cached', async () => {
  const r = rig();
  seedWall(r);
  const res = await get(r, '/wall');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  const text = await res.text();
  assert.ok(!/@example\.org|email/.test(text), 'never an email');
  const wall = JSON.parse(text);
  assert.deepEqual(Object.keys(wall), ['updatedAt', 'items']);
  assert.equal(wall.updatedAt, '2026-10-11T17:00:00.000Z');
  assert.deepEqual(wall.items, [
    {id: '5', title: 'The Cyberiad', author: 'Stanisław Lem', olWork: 'OL1W', coverId: 8231856, year: 1965, name: '', note: '', date: '2026-10-05'},
    {id: '1', title: 'Dune', author: 'Frank Herbert', olWork: null, coverId: null, year: null, name: 'Ana', note: 'Sand.', date: '2026-10-02'},
  ]);
  assert.deepEqual(validateWall(wall), []);
  const [list] = r.github.requests;
  assert.equal(list.search, '?labels=approved&state=all&per_page=100&page=1');
  assert.equal(r.env.RECS.writes.length, 1);
  assert.equal(r.env.RECS.writes[0].key, WALL_KEY);
});

test('GET /wall: at most one GitHub call and one KV write per 15 minutes', async () => {
  const r = rig();
  seedWall(r);
  for (let i = 0; i < 90; i++) { assert.equal((await get(r, '/wall')).status, 200); r.tick(10_000); }   // 15 minutes of traffic
  assert.equal(r.github.requests.length, 1);
  assert.equal(r.env.RECS.writes.length, 1);
  r.tick(1000);
  r.github.label(3, 'approved');
  const wall = await (await get(r, '/wall')).json();
  assert.equal(r.github.requests.length, 2);
  assert.equal(r.env.RECS.writes.length, 2);
  assert.deepEqual(wall.items.map(i => i.id), ['5', '3', '1']);
  assert.ok(!JSON.stringify(wall).includes('p@example.org'));
});

test('GET /wall: a fresh isolate reads KV instead of GitHub', async () => {
  const r = rig();
  seedWall(r);
  await get(r, '/wall');
  const again = createHandler({fetch: r.fetch, now: () => Date.parse('2026-10-11T17:05:00Z')});
  const res = await again(new Request(`${BASE}/wall`), r.env);
  assert.equal((await res.json()).items.length, 2);
  assert.equal(r.github.requests.length, 1);
});

test('GET /wall: serves stale on GitHub errors, 502 with nothing cached', async () => {
  const r = rig();
  seedWall(r);
  const first = await (await get(r, '/wall')).json();
  r.tick(16 * 60_000);
  r.github.failWith = 502;
  const res = await get(r, '/wall');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), first);
  assert.equal(r.env.RECS.writes.length, 1, 'a failed refresh writes nothing');
  // Backs off for a minute rather than hammering GitHub on every request.
  const calls = r.github.requests.length;
  await get(r, '/wall');
  assert.equal(r.github.requests.length, calls);

  const empty = rig();
  empty.github.failWith = 500;
  const none = await get(empty, '/wall');
  assert.equal(none.status, 502);
  assert.equal(none.headers.get('Cache-Control'), 'no-store');
  noSecrets(await none.text());
});

test('GET /wall pages through approved issues and caps at 200', async () => {
  const r = rig();
  for (let i = 0; i < 230; i++) r.github.add({title: 't', body: '```json\n{"title":"B' + i + '"}\n```', labels: ['approved']});
  const wall = await (await get(r, '/wall')).json();
  assert.equal(wall.items.length, 200);
  assert.equal(wall.items[0].id, '230');
  assert.deepEqual(r.github.requests.map(x => new URLSearchParams(x.search).get('page')), ['1', '2', '3']);
});

test('CORS, health and routing', async () => {
  const r = rig();
  let res = await r.handle(new Request(`${BASE}/recommend`, {method: 'OPTIONS', headers: {Origin: 'http://localhost:8080',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}}), r.env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');
  assert.equal(res.headers.get('Vary'), 'Origin');

  res = await r.handle(new Request(`${BASE}/recommend`, {method: 'OPTIONS', headers: {Origin: 'https://evil.example'}}), r.env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(res.headers.get('Vary'), 'Origin');

  res = await get(r, '/health', null);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {ok: true});
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);

  assert.equal((await get(r, '/nope')).status, 404);
  res = await get(r, '/recommend');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
  res = await r.handle(new Request(`${BASE}/wall`, {method: 'POST', body: '{}'}), r.env);
  assert.equal(res.status, 405);
  assert.equal(r.github.requests.length, 0);
});
