// End-to-end check against a running `wrangler dev` wired to scripts/mock-github.mjs (see README.md).
//   node scripts/e2e.mjs [--worker http://127.0.0.1:8787] [--mock http://127.0.0.1:8788] [--expect-fail]
// --expect-fail is for a dev server started with the always-fail Turnstile secret: it only checks the 403.
import assert from 'node:assert/strict';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const WORKER = arg('worker', 'http://127.0.0.1:8787'), MOCK = arg('mock', 'http://127.0.0.1:8788');
const ORIGIN = 'http://localhost:8080';

const rec = (over = {}) => ({title: 'The Dispossessed', author: 'Ursula K. Le Guin', olWork: 'OL59863W', coverId: 6979861, year: 1974,
  note: 'An ambiguous utopia, @everyone #1', name: 'E2E', email: 'e2e-private@example.org', website: '', t: 8000,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', ...over});
const post = body => fetch(`${WORKER}/recommend`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: ORIGIN}, body: JSON.stringify(body)});
const issues = async () => (await (await fetch(`${MOCK}/_mock/issues`)).json()).issues;
const step = (name, fn) => fn().then(() => console.log(`ok   ${name}`), err => { console.error(`FAIL ${name}\n${err.stack}`); process.exitCode = 1; throw err; });

if (process.argv.includes('--expect-fail')) {
  await step('always-fail Turnstile secret -> 403', async () => {
    const res = await post(rec());
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), {ok: false, error: 'turnstile'});
    assert.equal((await issues()).length, 0);
  });
} else {
  // Earlier manual requests from this IP (e.g. a curl smoke test) count towards the hourly limit.
  const prior = (await issues()).length, mine = prior + 1;
  assert.ok(prior < 4, 'restart wrangler dev with a fresh --persist-to and the mock for a clean run');
  await step('GET /health', async () => {
    const res = await fetch(`${WORKER}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {ok: true});
  });
  await step('OPTIONS preflight echoes the dev origin', async () => {
    const res = await fetch(`${WORKER}/recommend`, {method: 'OPTIONS', headers: {Origin: ORIGIN, 'Access-Control-Request-Method': 'POST'}});
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  });
  await step('POST /recommend files a correct issue', async () => {
    const res = await post(rec());
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(await res.json(), {ok: true});
    const issue = (await issues()).find(i => i.number === mine);
    assert.equal(issue.title, '📚 The Dispossessed — Ursula K. Le Guin');
    assert.deepEqual(issue.labels.map(l => l.name), ['recommendation']);
    const data = JSON.parse(issue.body.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.equal(data.email, 'e2e-private@example.org');
    assert.equal(data.note, 'An ambiguous utopia, @everyone #1');
  });
  await step('honeypot and a 1 s form get a fake 200 and file nothing', async () => {
    for (const over of [{website: 'http://spam.example'}, {t: 1000}]) {
      const res = await post(rec({title: 'Bot book', ...over}));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {ok: true});
    }
    assert.equal((await issues()).length, mine);
  });
  await step('invalid fields -> 400', async () => {
    const res = await post(rec({title: '', email: 'nope'}));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {ok: false, error: 'invalid', fields: ['title', 'email']});
  });
  await step('the 6th verified request in an hour -> 429', async () => {
    for (let i = mine + 1; i <= 5; i++) assert.equal((await post(rec({title: `E2E book ${i}`}))).status, 200, `request ${i}`);
    const res = await post(rec({title: 'E2E book 6'}));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, 'rate_limited');
    assert.ok(body.retryAfter > 3000 && body.retryAfter <= 3600, String(body.retryAfter));
    assert.equal((await issues()).length, 5);
    assert.equal(new Set((await issues()).map(i => i.title)).size, 5);
  });
  await step('approve it -> GET /wall shows it, with no email anywhere', async () => {
    await fetch(`${MOCK}/repos/mhmanek/library-inbox/issues/${mine}/labels`, {method: 'POST',
      headers: {Authorization: 'Bearer dev-token-not-real', 'User-Agent': 'e2e', 'Content-Type': 'application/json'}, body: JSON.stringify({labels: ['approved']})});
    const res = await fetch(`${WORKER}/wall`, {headers: {Origin: ORIGIN}});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    const text = await res.text();
    assert.ok(!text.includes('e2e-private@example.org') && !text.includes('email'), text);
    const wall = JSON.parse(text);
    assert.equal(wall.items.length, 1);
    assert.deepEqual({...wall.items[0], date: 'x'}, {id: String(mine), title: 'The Dispossessed', author: 'Ursula K. Le Guin', olWork: 'OL59863W',
      coverId: 6979861, year: 1974, name: 'E2E', note: 'An ambiguous utopia, @everyone #1', date: 'x'});
  });
}
