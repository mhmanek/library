// Shared test helpers: a routing fake fetch (no test ever touches the network), temp dirs, generated images.
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';

export const FIX = new URL('../fixtures/pipeline/', import.meta.url);
export const fixture = (name, enc = 'utf8') => readFile(new URL(name, FIX), enc);
export const fixtureJson = async name => JSON.parse(await fixture(name));

export const xmlResponse = (body, {status = 200, etag = null, type = 'application/xml; charset=utf-8'} = {}) =>
  new Response(status === 304 ? null : body, {status, headers: {'content-type': type, ...(etag ? {etag} : {})}});
export const jsonResponse = (value, {status = 200, headers = {}} = {}) =>
  new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', ...headers}});
export const imageResponse = buf => new Response(buf, {status: 200, headers: {'content-type': 'image/jpeg'}});

// routes: [[test(url) | RegExp | string-prefix, handler(url, init, n) -> Response | Error]]. Records every call.
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({url: u, headers: init.headers ?? {}});
    for (const [match, handler] of routes) {
      const hit = typeof match === 'function' ? match(u) : match instanceof RegExp ? match.test(u) : u.startsWith(match);
      if (!hit) continue;
      const n = calls.filter(c => c.url === u).length;
      const r = await handler(u, init, n);
      if (r instanceof Error) throw r;
      return r;
    }
    throw new TypeError(`fetch failed: no route for ${u}`);
  };
  fn.calls = calls;
  return fn;
}

// Instant clock + sleep: sleeping advances the clock, and every requested delay is recorded.
export function fakeClock(start = Date.parse('2026-10-11T14:17:03Z')) {
  let t = start;
  const sleeps = [];
  return {now: () => t, sleep: async ms => { sleeps.push(ms); t += ms; }, sleeps, advance: ms => { t += ms; }};
}

export async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'library-test-'));
  try { return await fn(dir); } finally { await rm(dir, {recursive: true, force: true}); }
}

// A JPEG cover: `fill` background plus rectangular `blocks` [{x, y, w, h, color}] in pixels.
export async function makeImage({w = 300, h = 450, fill = '#ffffff', blocks = [], format = 'jpeg', noise = true} = {}) {
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const buf = Buffer.alloc(w * h * 3);
  const [fr, fg, fb] = hex(fill);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = fr; buf[i * 3 + 1] = fg; buf[i * 3 + 2] = fb; }
  for (const b of blocks) {
    const [r, g, bl] = hex(b.color);
    for (let y = b.y; y < Math.min(h, b.y + b.h); y++) for (let x = b.x; x < Math.min(w, b.x + b.w); x++) {
      const i = (y * w + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = bl;
    }
  }
  // A faint deterministic texture so a plain cover is not rejected as blank unless that is the point.
  if (noise) for (let i = 0; i < buf.length; i += 97) buf[i] = Math.max(0, Math.min(255, buf[i] + ((i / 97) % 2 ? 9 : -9)));
  const img = sharp(buf, {raw: {width: w, height: h, channels: 3}});
  return format === 'png' ? img.png().toBuffer() : format === 'gif' ? img.gif().toBuffer() : img.jpeg({quality: 90}).toBuffer();
}

export const testConfig = (over = {}) => ({
  site: {title: "Malhar's Library", url: 'https://mhmanek.github.io/library', base: '/library/', repo: 'mhmanek/library', email: 'malhar.manek@gmail.com', substack: 'https://www.malharmanek.com', timezone: 'America/Chicago'},
  goodreads: {userId: '113503174', ownerName: 'Malhar', shelves: ['read', 'currently-reading', 'did-not-finish', 'to-read'], perPage: 200, maxPages: 20, sort: 'date_added'},
  substack: {api: ['https://www.malharmanek.com/api/v1/posts/books', 'https://malharmanek.substack.com/api/v1/posts/books'], postUrl: 'https://www.malharmanek.com/p/books'},
  margins: {userId: null}, visitorShelf: {workerUrl: null, turnstileSiteKey: null},
  sync: {userAgent: 'mhmanek-library-sync/1.0 (+https://github.com/mhmanek/library)', maxDropFraction: 0.2, maxDropFloor: 5, maxNewCoversPerRun: 120, maxOlQueriesPerRun: 200, olMissRetryDays: 90},
  ...over,
});
