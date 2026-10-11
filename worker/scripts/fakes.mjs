// Test doubles shared by test/*.test.mjs and the local mock server: an in-memory KV namespace, a fake
// GitHub issues API speaking Request/Response, and a fake Turnstile siteverify. Kept out of test/ so
// node --test doesn't run it as a suite.
import {SITEVERIFY} from '../src/lib.js';

export const PASS_SECRET = '1x0000000000000000000000000000000AA';
export const FAIL_SECRET = '2x0000000000000000000000000000000AA';

export function memoryKV() {
  const store = new Map();
  return {
    store, writes: [], reads: 0, failWrites: false,
    async get(key, opts = {}) {
      this.reads++;
      const v = store.get(key);
      if (v === undefined) return null;
      return (typeof opts === 'string' ? opts : opts.type) === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts = {}) {
      if (this.failWrites) throw new Error('KV put() limit exceeded for the day.');
      if (typeof value !== 'string') throw new TypeError('value must be a string');
      if (opts.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error('expirationTtl must be at least 60');
      this.writes.push({key, value, opts});
      store.set(key, value);
    },
  };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...headers}});

// Enough of the REST API for the Worker: create an issue, list issues by label, add labels.
// Like GitHub, it insists on a User-Agent and a token.
export function fakeGitHub({repo = 'mhmanek/library-inbox', token = 'test-token', clock = () => Date.now()} = {}) {
  const gh = {
    repo, issues: [], requests: [], failWith: null,
    add(issue) {
      const number = gh.issues.length + 1;
      const full = {number, state: 'open', labels: [], body: '', created_at: new Date(clock()).toISOString(), ...issue};
      full.labels = full.labels.map(l => typeof l === 'string' ? {name: l} : l);
      gh.issues.push(full);
      return full;
    },
    label(number, ...names) {
      const issue = gh.issues.find(i => i.number === number);
      for (const name of names) if (!issue.labels.some(l => l.name === name)) issue.labels.push({name});
      return issue;
    },
    async handle(request) {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? null : await request.text();
      gh.requests.push({method: request.method, path: url.pathname, search: url.search, headers: Object.fromEntries(request.headers), body});
      if (!request.headers.get('User-Agent')) return json(403, {message: 'Request forbidden by administrative rules. Please make sure your request has a User-Agent header'});
      if (request.headers.get('Authorization') !== `Bearer ${token}`) return json(401, {message: 'Bad credentials'});
      if (gh.failWith) return json(gh.failWith, {message: 'Server Error'});
      const base = `/repos/${repo}/issues`;
      if (url.pathname === base && request.method === 'POST') {
        const data = JSON.parse(body);
        if (typeof data.title !== 'string' || !data.title) return json(422, {message: 'Validation Failed'});
        return json(201, gh.add({title: data.title, body: data.body ?? '', labels: data.labels ?? []}));
      }
      if (url.pathname === base && request.method === 'GET') {
        const want = (url.searchParams.get('labels') ?? '').split(',').filter(Boolean);
        const state = url.searchParams.get('state') ?? 'open';
        const per = Math.min(100, Number(url.searchParams.get('per_page') ?? 30)), page = Number(url.searchParams.get('page') ?? 1);
        const hits = gh.issues.filter(i => (state === 'all' || i.state === state) && want.every(w => i.labels.some(l => l.name === w)))
          .sort((a, b) => b.number - a.number);
        return json(200, hits.slice((page - 1) * per, page * per));
      }
      const m = url.pathname.match(new RegExp(`^${base}/(\\d+)/labels$`));
      if (m && request.method === 'POST') {
        const issue = gh.issues.find(i => i.number === Number(m[1]));
        if (!issue) return json(404, {message: 'Not Found'});
        gh.label(issue.number, ...JSON.parse(body).labels);
        return json(200, issue.labels);
      }
      return json(404, {message: 'Not Found'});
    },
  };
  return gh;
}

// Mirrors the documented test secrets: 1x...AA passes any token (reporting hostname example.com),
// 2x...AA always fails. `hostname`/`action` let tests play a production widget.
export function fakeSiteverify({hostname = 'example.com', action = '', status = 200} = {}) {
  const sv = {
    calls: [],
    async handle(request) {
      const form = new URLSearchParams(await request.text());
      sv.calls.push(Object.fromEntries(form));
      if (status !== 200) return new Response('oops', {status});
      if (form.get('secret') === FAIL_SECRET || form.get('secret') !== sv.secret) return json(200, {success: false, 'error-codes': ['invalid-input-response']});
      return json(200, {success: true, 'error-codes': [], challenge_ts: new Date().toISOString(), hostname, action});
    },
    secret: PASS_SECRET,
  };
  return sv;
}

// A fetch() that routes to the fakes; anything else is a test bug, so it throws loudly.
export function fakeFetch({github, siteverify, api = 'https://api.github.test'}) {
  const calls = [];
  const f = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request.url);
    if (request.url === SITEVERIFY) return siteverify.handle(request);
    if (request.url.startsWith(api + '/')) return github.handle(request);
    throw new Error(`unexpected fetch ${request.url}`);
  };
  f.calls = calls;
  return f;
}
