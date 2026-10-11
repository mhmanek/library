// The only HTTP client sync uses. Every request carries the identifying User-Agent (Goodreads/CloudFront 403 a
// missing one since May 2026), goes through a per-host politeness limiter, has a timeout and a size cap, and is
// retried with backoff on transient failures. fetch and sleep are injectable so tests never touch the network.

export class HttpError extends Error {
  constructor(code, message, {status = null, retriable = false} = {}) {
    super(message ?? code);
    Object.assign(this, {code, status, retriable});
  }
}

// [concurrency, minimum gap between request starts in ms]
export const HOST_LIMITS = {
  'www.goodreads.com': [1, 1500],
  'openlibrary.org': [1, 1100],          // OL allows 3 req/s with a contact UA; we stay at 1/s
  'covers.openlibrary.org': [2, 400],
  'archive.org': [2, 400],               // covers.openlibrary.org redirects to ia*.us.archive.org
  'i.gr-assets.com': [3, 100],
  'images.gr-assets.com': [3, 100],
  'm.media-amazon.com': [3, 100],
  'images-na.ssl-images-amazon.com': [3, 100],
  'www.malharmanek.com': [1, 1000],
  'malharmanek.substack.com': [1, 1000],
  'substack-post-media.s3.amazonaws.com': [2, 200],
  'substackcdn.com': [2, 200],
};
const DEFAULT_LIMIT = [1, 1000];

const KIND = {
  rss: {accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1', timeout: 30_000, maxBytes: 20e6},
  json: {accept: 'application/json', timeout: 20_000, maxBytes: 5e6},
  image: {accept: 'image/*', timeout: 20_000, maxBytes: 8e6},
};

export const BACKOFF = [5_000, 20_000, 60_000];
const RETRY_STATUS = new Set([408, 425, 429]);

function limitFor(host, limits) {
  if (limits[host]) return limits[host];
  const parent = Object.keys(limits).find(h => host.endsWith('.' + h));
  return parent ? limits[parent] : DEFAULT_LIMIT;
}

function retryAfterMs(value, nowMs) {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, t - nowMs);
}

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) throw new HttpError('too-large', `body over ${maxBytes} bytes`);
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError('too-large', `body over ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

export function createHttp({userAgent, fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(), random = Math.random, limits = HOST_LIMITS, onRequest = () => {}} = {}) {
  if (!userAgent) throw new Error('createHttp: userAgent is required');
  const hosts = new Map();
  const stats = {requests: 0, retries: 0};

  async function acquire(host) {
    if (!hosts.has(host)) { const [conc, gap] = limitFor(host, limits); hosts.set(host, {conc, gap, active: 0, next: 0, waiters: []}); }
    const h = hosts.get(host);
    while (h.active >= h.conc) await new Promise(r => h.waiters.push(r));
    h.active++;
    const t = now(), start = Math.max(t, h.next);
    h.next = start + h.gap;
    if (start > t) await sleep(start - t);
    return () => { h.active--; h.waiters.shift()?.(); };
  }

  async function once(url, opts) {
    const k = KIND[opts.kind ?? 'json'];
    const host = new URL(url).host;
    const release = await acquire(host);
    const timeout = opts.timeout ?? k.timeout;
    try {
      stats.requests++;
      onRequest({url, kind: opts.kind});
      let res;
      try {
        res = await fetchImpl(url, {
          headers: {'User-Agent': userAgent, Accept: k.accept, ...opts.headers},
          redirect: 'follow',
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        throw new HttpError(timedOut ? 'timeout' : 'network', `${timedOut ? 'timed out' : 'network error'}: ${err?.cause?.code ?? err?.message ?? err}`, {retriable: true});
      }
      if (res.status === 304) return {status: 304, headers: res.headers, url: res.url || url, bytes: Buffer.alloc(0), text: () => '', json: () => null};
      if (res.status >= 500 || RETRY_STATUS.has(res.status)) {
        res.body?.cancel?.().catch(() => {});
        const err = new HttpError(`http-${res.status}`, `HTTP ${res.status}`, {status: res.status, retriable: true});
        err.retryAfter = retryAfterMs(res.headers.get('retry-after'), now());
        throw err;
      }
      if (res.status !== 200 && !(res.status > 200 && res.status < 300)) {
        res.body?.cancel?.().catch(() => {});
        throw new HttpError(`http-${res.status}`, `HTTP ${res.status}`, {status: res.status});
      }
      let bytes;
      try { bytes = await readCapped(res, opts.maxBytes ?? k.maxBytes); }
      catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError('network', `body read failed: ${err?.message ?? err}`, {retriable: true});
      }
      const out = {status: res.status, headers: res.headers, url: res.url || url, bytes,
        text: () => bytes.toString('utf8'), json: () => JSON.parse(bytes.toString('utf8'))};
      opts.validate?.(out); // may throw HttpError with retriable: true (e.g. a 200 that is not RSS)
      return out;
    } finally { release(); }
  }

  async function get(url, opts = {}) {
    const attempts = opts.attempts ?? BACKOFF.length + 1;
    const backoff = opts.backoff ?? BACKOFF;
    for (let attempt = 1; ; attempt++) {
      try { return await once(url, opts); }
      catch (err) {
        if (!(err instanceof HttpError) || !err.retriable || attempt >= attempts) throw err;
        const base = backoff[Math.min(attempt - 1, backoff.length - 1)] * (0.8 + 0.4 * random());
        const wait = err.retryAfter != null ? Math.min(Math.max(err.retryAfter, 1000), 120_000) : base;
        stats.retries++;
        await sleep(Math.round(wait));
      }
    }
  }

  return {get, stats};
}
