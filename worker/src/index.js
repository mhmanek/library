// library-recs: files visitor recommendations as issues in the private inbox repo and serves the
// approved ones at /wall. Plain ES module, no build step; the pure parts live in lib.js.
import {
  LIMITS, DAY, WALL_TTL, WALL_PAGES, WALL_KEY, SITEVERIFY, USER_AGENT,
  settings, isBot, validate, turnstileOk, issueTitle, issueBody, mapWall, corsHeaders,
  ipKey, titleKey, throttle, recordAttempt,
} from './lib.js';

const UPSTREAM_TIMEOUT = 10_000;
const MEMO_MS = 60_000;   // per-isolate wall copy: a burst of visitors costs one KV read, not one each

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
const reply = (status, body, cors, extra = {}) =>
  new Response(JSON.stringify(body), {status, headers: {...JSON_HEADERS, 'Cache-Control': 'no-store', ...cors, ...extra}});
const invalid = (fields, cors) => reply(400, {ok: false, error: 'invalid', fields}, cors);
const upstream = cors => reply(502, {ok: false, error: 'upstream'}, cors);

// Logs carry a status or an error name, never a token, a request body or a stack.
const log = (what, err) => console.error(`library-recs: ${what}${err ? `: ${err.name ?? 'Error'} ${String(err.message ?? '').slice(0, 200)}` : ''}`);

const github = env => ({
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': USER_AGENT,   // GitHub rejects REST calls without one
});

// Reads at most `max` bytes, so a chunked upload without Content-Length can't make us buffer megabytes.
async function readLimited(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export function createHandler({fetch: fetchImpl = (...a) => fetch(...a), now = () => Date.now(), uuid = () => crypto.randomUUID()} = {}) {
  const memo = {data: null, at: 0, failedAt: -Infinity};

  async function siteverify(secret, token, ip) {
    const form = new URLSearchParams({secret, response: token, idempotency_key: uuid()});
    if (ip) form.set('remoteip', ip);
    const res = await fetchImpl(SITEVERIFY, {method: 'POST', body: form, headers: {'User-Agent': USER_AGENT},
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT)});
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    return res.json();
  }

  async function createIssue(env, cfg, rec) {
    const res = await fetchImpl(`${cfg.api}/repos/${cfg.repo}/issues`, {
      method: 'POST',
      headers: {...github(env), 'Content-Type': 'application/json'},
      body: JSON.stringify({title: issueTitle(rec), body: issueBody(rec, new Date(now()).toISOString()), labels: ['recommendation']}),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
    await res.body?.cancel().catch(() => {});
    if (res.status !== 201) log(`create issue HTTP ${res.status}`);
    return res.status === 201;
  }

  async function recommend(request, env, cfg, cors) {
    if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) return invalid(['body'], cors);
    const text = await readLimited(request, LIMITS.body);
    if (text === null) return invalid(['body'], cors);
    let input;
    try { input = JSON.parse(text); } catch { return invalid(['body'], cors); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid(['body'], cors);

    if (isBot(input)) return reply(200, {ok: true}, cors);
    const {ok, fields, rec} = validate(input);
    if (!ok) return invalid(fields, cors);

    if (!env.TURNSTILE_SECRET || !env.GITHUB_TOKEN || !cfg.repo || !env.RECS) {
      log('missing TURNSTILE_SECRET, GITHUB_TOKEN, INBOX_REPO or the RECS binding');
      return reply(500, {ok: false, error: 'server'}, cors);
    }
    const token = input.turnstileToken;
    if (typeof token !== 'string' || !token || token.length > LIMITS.token) return reply(403, {ok: false, error: 'turnstile'}, cors);
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    let verdict;
    try { verdict = await siteverify(env.TURNSTILE_SECRET, token, ip); } catch (err) { log('siteverify', err); return upstream(cors); }
    if (!turnstileOk(verdict, cfg.hostnames)) return reply(403, {ok: false, error: 'turnstile'}, cors);

    // Throttling happens after Turnstile, so only verified humans (or paying solvers) can spend KV writes.
    const key = await ipKey(ip || 'unknown', env.TURNSTILE_SECRET), tkey = await titleKey(rec.title);
    const nowS = Math.floor(now() / 1000);
    let stored = null;
    try { stored = await env.RECS.get(key, {type: 'json'}); } catch (err) { log('KV read', err); }
    const verdictT = throttle(stored, nowS, tkey);
    if (verdictT.retryAfter) {
      return reply(429, {ok: false, error: 'rate_limited', retryAfter: verdictT.retryAfter}, cors, {'Retry-After': String(verdictT.retryAfter)});
    }
    // A double-click or a resend within 10 minutes is answered as a success but files nothing new.
    let created = false;
    if (!verdictT.duplicate) {
      try { created = await createIssue(env, cfg, rec); } catch (err) { log('create issue', err); }
    }
    try {
      await env.RECS.put(key, JSON.stringify(recordAttempt(verdictT.record, nowS, tkey, created)), {expirationTtl: DAY});
    } catch (err) { log('KV write', err); }
    return verdictT.duplicate || created ? reply(200, {ok: true}, cors) : upstream(cors);
  }

  async function fetchApproved(env, cfg) {
    if (!env.GITHUB_TOKEN || !cfg.repo) throw new Error('missing GITHUB_TOKEN or INBOX_REPO');
    const issues = [];
    for (let page = 1; page <= WALL_PAGES; page++) {
      const res = await fetchImpl(`${cfg.api}/repos/${cfg.repo}/issues?labels=approved&state=all&per_page=100&page=${page}`,
        {headers: github(env), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT)});
      if (res.status !== 200) { await res.body?.cancel().catch(() => {}); throw new Error(`issues HTTP ${res.status}`); }
      const batch = await res.json();
      if (!Array.isArray(batch)) throw new Error('issues: not an array');
      issues.push(...batch);
      if (batch.length < 100) break;
    }
    return mapWall(issues, cfg.timeZone);
  }

  const wallReply = (data, cors) => reply(200, {updatedAt: data.updatedAt, items: data.items}, cors, {'Cache-Control': 'public, max-age=300'});
  const usable = d => d && typeof d.updatedAt === 'string' && Array.isArray(d.items) ? d : null;

  // KV holds the last good wall. It is rewritten only after a successful refresh, at most every 15 minutes,
  // and a failed refresh serves the stale copy and backs off for a minute in this isolate.
  async function wall(env, cfg, cors) {
    const t = now();
    if (memo.data && t - memo.at < MEMO_MS) return wallReply(memo.data, cors);
    let cached = null;
    try { cached = usable(await env.RECS?.get(WALL_KEY, {type: 'json', cacheTtl: 60})); } catch (err) { log('KV read', err); }
    const fresh = cached && t - Date.parse(cached.updatedAt) < WALL_TTL * 1000;
    if (cached && (fresh || t - memo.failedAt < MEMO_MS)) { Object.assign(memo, {data: cached, at: t}); return wallReply(cached, cors); }
    if (!cached && memo.data && t - memo.failedAt < MEMO_MS) return wallReply(memo.data, cors);
    try {
      const data = {updatedAt: new Date(t).toISOString(), items: await fetchApproved(env, cfg)};
      try { await env.RECS?.put(WALL_KEY, JSON.stringify(data)); } catch (err) { log('KV write', err); }
      Object.assign(memo, {data, at: t});
      return wallReply(data, cors);
    } catch (err) {
      log('wall refresh', err);
      memo.failedAt = t;
      const stale = cached ?? memo.data;
      return stale ? wallReply(stale, cors) : upstream(cors);
    }
  }

  return async function handle(request, env) {
    const cfg = settings(env);
    const cors = corsHeaders(request.headers.get('Origin'), cfg.origins);
    try {
      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
      const {pathname} = new URL(request.url);
      const routes = {'/health': 'GET', '/wall': 'GET', '/recommend': 'POST'};
      if (!routes[pathname]) return reply(404, {ok: false, error: 'not_found'}, cors);
      if (request.method !== routes[pathname]) return reply(405, {ok: false, error: 'method'}, cors, {'Allow': `${routes[pathname]}, OPTIONS`});
      if (pathname === '/health') return reply(200, {ok: true}, cors);
      if (pathname === '/wall') return await wall(env, cfg, cors);
      return await recommend(request, env, cfg, cors);
    } catch (err) {
      log('unhandled', err);
      return reply(500, {ok: false, error: 'server'}, cors);
    }
  };
}

const handle = createHandler();
export default {fetch: (request, env) => handle(request, env)};
