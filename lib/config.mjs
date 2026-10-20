// Loads and validates config.json. Both sync and build fail fast with a message naming the bad field.
// config.json is public: it must never hold a secret.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const SHELVES = ['read', 'currently-reading', 'did-not-finish', 'to-read'];

export async function loadConfig(root = process.cwd(), env = process.env) {
  const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  return validateConfig(applyEnv(config, env));
}

// Dev-only overrides so a local wrangler dev Worker or the Turnstile test key never has to be committed.
function applyEnv(config, env) {
  const c = structuredClone(config);
  if (env.LIBRARY_WORKER_URL) c.visitorShelf.workerUrl = env.LIBRARY_WORKER_URL;
  if (env.LIBRARY_TURNSTILE_SITEKEY) c.visitorShelf.turnstileSiteKey = env.LIBRARY_TURNSTILE_SITEKEY;
  return c;
}

export function validateConfig(c) {
  const fail = (field, why) => { throw new Error(`config.json: ${field} ${why}`); };
  const s = c.site ?? fail('site', 'is missing');
  if (typeof s.title !== 'string' || !s.title) fail('site.title', 'must be a non-empty string');
  if (!/^https:\/\/[^/]+(\/.*)?[^/]$/.test(s.url ?? '')) fail('site.url', 'must be an https URL without a trailing slash');
  if (!/^\/(.*\/)?$/.test(s.base ?? '')) fail('site.base', "must start and end with '/'");
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo ?? '')) fail('site.repo', "must look like 'owner/name'");
  if (!/^[^@\s]+@[^@\s]+$/.test(s.email ?? '')) fail('site.email', 'must be an email address');
  if (typeof s.timezone !== 'string') fail('site.timezone', 'must be an IANA zone such as America/Chicago');

  const g = c.goodreads ?? fail('goodreads', 'is missing');
  if (!/^\d+$/.test(g.userId ?? '')) fail('goodreads.userId', 'must be digits');
  if (typeof g.ownerName !== 'string' || !g.ownerName) fail('goodreads.ownerName', 'must be the name in "<name>\'s bookshelf"');
  if (!Array.isArray(g.shelves) || !g.shelves.length || g.shelves.some(x => !SHELVES.includes(x))) {
    fail('goodreads.shelves', `must be a non-empty subset of ${SHELVES.join(', ')}`);
  }
  const ordered = SHELVES.filter(x => g.shelves.includes(x));
  if (ordered.join() !== g.shelves.join()) fail('goodreads.shelves', `must be in precedence order (${SHELVES.join(' > ')})`);
  if (!(g.perPage >= 1 && g.perPage <= 200)) fail('goodreads.perPage', 'must be 1..200');

  const sub = c.substack ?? fail('substack', 'is missing');
  if (!Array.isArray(sub.api) || !sub.api.length || sub.api.some(u => !/^https:\/\//.test(u))) fail('substack.api', 'must be a list of https URLs');

  const m = c.margins ?? fail('margins', 'is missing');
  if (m.profileUrl !== null && !/^https:\/\/(www\.)?margins\.app\/\S+$/.test(m.profileUrl ?? '')) fail('margins.profileUrl', 'must be null or your profile link, https://margins.app/...');

  const v = c.visitorShelf ?? fail('visitorShelf', 'is missing');
  if (v.workerUrl !== null && !/^https?:\/\/[^/]+(\/.*)?[^/]$/.test(v.workerUrl ?? '')) fail('visitorShelf.workerUrl', 'must be null or a URL without a trailing slash');
  if (v.workerUrl && !v.workerUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v.workerUrl)) fail('visitorShelf.workerUrl', 'must use https (http only for localhost)');
  if (v.turnstileSiteKey !== null && !/^[0-9A-Za-z_-]{10,}$/.test(v.turnstileSiteKey ?? '')) fail('visitorShelf.turnstileSiteKey', 'must be null or a Turnstile site key');

  const y = c.sync ?? fail('sync', 'is missing');
  if (typeof y.userAgent !== 'string' || /python-requests/i.test(y.userAgent) || y.userAgent.length < 8) fail('sync.userAgent', 'must be an identifying User-Agent (Goodreads 403s an empty or python-requests one)');
  return c;
}
