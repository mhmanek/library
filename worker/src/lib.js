// Pure logic for the library-recs Worker: validation, issue building, wall mapping, CORS and throttling.
// Only Web-standard APIs (crypto.subtle, TextEncoder, Intl), so node:test imports it unchanged.
import {fold} from '../../src/shared/normalize.js';

// Caps match docs/CONTRACT.md (Visitor shelf) and the form's maxlength attributes.
export const LIMITS = {title: 200, author: 120, name: 40, note: 280, email: 254, token: 2048, body: 8192, noteLinks: 2, issueTitle: 150};
export const MIN_FORM_MS = 3000;
export const HOUR = 3600, DAY = 86400;
export const THROTTLE = {hour: 5, day: 20};
export const DUP_WINDOW = 600;
export const WALL_TTL = 900;        // seconds between GitHub refreshes: at most 96 KV writes a day
export const WALL_MAX = 200;
export const WALL_PAGES = 3;        // 300 approved issues covers 200 items even if some are malformed or spam
export const WALL_KEY = 'wall:v1';
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const USER_AGENT = 'mhmanek-library-recs/1.0 (+https://github.com/mhmanek/library)';
const TEXT_FIELDS = [['title', LIMITS.title], ['author', LIMITS.author], ['note', LIMITS.note], ['name', LIMITS.name]];

export const list = s => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);

// Everything configurable comes from wrangler.toml [vars]; GITHUB_API is overridable so tests can use a mock.
export function settings(env) {
  return {
    origins: list(env.ALLOWED_ORIGINS),
    hostnames: list(env.TURNSTILE_HOSTNAMES).map(h => h.toLowerCase()),
    // GitHub owners are alphanumeric plus hyphens; "." and ".." as a name would walk the API path.
    repo: /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/.test(env.INBOX_REPO ?? '') ? env.INBOX_REPO : null,
    api: String(env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
    timeZone: env.TIMEZONE || 'UTC',
  };
}

// Bidi overrides, zero-width spaces and soft hyphens can disguise text in the inbox and on the wall.
// ZWJ/ZWNJ (U+200C/D) stay: Indic and Persian scripts need them.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜᠎​‎‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/g;

// Plain text on one line. Returns null for a wrong type so validation can name the field.
export function clean(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  return String(v).toWellFormed().normalize('NFC').replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
}

// Truncates by code point (never splitting a surrogate pair) so the result's .length stays within max.
export function cap(s, max) {
  if (s.length <= max) return s;
  let out = '';
  for (const ch of s) { if (out.length + ch.length > max - 1) break; out += ch; }
  return out.trimEnd() + '…';
}

const blank = v => v === null || v === undefined || v === '';
const LINKS = /\b(?:https?:\/\/|www\.)\S+/gi;
const HAS_LINK = /\b(?:https?:\/\/|www\.)\S/i;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

// Hidden form fields arrive as strings, so digit strings are accepted for the numeric fields.
export function olWorkOf(v) {
  if (blank(v)) return null;
  const m = typeof v === 'string' && /^(?:\/works\/)?(OL\d{1,12}W)$/.exec(v.trim());
  return m ? m[1] : undefined;
}
export function intOf(v, min, max) {
  if (blank(v)) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,10}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

// A filled honeypot, a missing timer or a form sent in under 3 s: answer with a fake success.
export function isBot(input) {
  const hp = input.website;
  if (!blank(hp) && (typeof hp !== 'string' || hp.trim() !== '')) return true;
  return !(Number(input.t) >= MIN_FORM_MS);
}

// Returns {ok, fields, rec}. Unknown keys are ignored; nothing is truncated (the form enforces the caps),
// so an over-long field is the visitor's to fix, not ours to cut silently.
export function validate(input) {
  const fields = [], rec = {};
  for (const [k, max] of TEXT_FIELDS) {
    const v = clean(input[k]);
    if (v === null || v.length > max || (k === 'title' && !v)) fields.push(k); else rec[k] = v;
  }
  // Link spam: short fields never need a URL, and a genuine note rarely needs more than two.
  for (const k of ['title', 'author', 'name']) if (rec[k] && HAS_LINK.test(rec[k])) fields.push(k);
  if (rec.note && (rec.note.match(LINKS)?.length ?? 0) > LIMITS.noteLinks) fields.push('note');
  rec.olWork = olWorkOf(input.olWork);
  rec.coverId = intOf(input.coverId, 1, 2 ** 31 - 1);
  rec.year = intOf(input.year, -4000, 2100);
  if (rec.year === 0) rec.year = null;
  for (const k of ['olWork', 'coverId', 'year']) if (rec[k] === undefined) fields.push(k);
  const email = clean(input.email);
  if (email === null || email.length > LIMITS.email || (email && !EMAIL.test(email))) fields.push('email');
  else rec.email = email || null;
  return {ok: !fields.length, fields: [...new Set(fields)], rec};
}

// Test secrets report hostname "example.com", so a production deploy can never accept a test-key pass.
// An empty action means the widget didn't set one; any other action belongs to a different form.
export function turnstileOk(data, hostnames) {
  if (!data || data.success !== true) return false;
  if (!hostnames.includes(String(data.hostname ?? '').toLowerCase())) return false;
  return !data.action || data.action === 'recommend';
}

// --- GitHub issue -----------------------------------------------------------------------------

// Issue titles render #123 as a link and @name as a mention; full-width lookalikes do neither.
export const neutralise = s => s.replace(/@/g, '＠').replace(/#/g, '＃');

export function issueTitle(rec) {
  const t = neutralise(clean(rec.title) ?? ''), a = neutralise(clean(rec.author) ?? '');
  return cap(`📚 ${t}${a ? ` — ${a}` : ''}`, LIMITS.issueTitle);
}

// The fields go in a fenced block so markdown can't render, link or mention anything. Backticks are
// escaped inside the JSON strings, so no value can close the fence.
export function issueBody(rec, submittedAt) {
  const data = {v: 1, title: rec.title, author: rec.author ?? '', olWork: rec.olWork ?? null, coverId: rec.coverId ?? null,
    year: rec.year ?? null, note: rec.note ?? '', name: rec.name ?? '', email: rec.email ?? null, submittedAt};
  const block = JSON.stringify(data, null, 2).replace(/`/g, '\\u0060');
  return [
    'A visitor left this recommendation in the returns slot on the library site.',
    '',
    '- **Shelve it:** add the `approved` label. It appears on the Visitor shelf within about 15 minutes (book, name and note only).',
    '- **Bin it:** add the `spam` label.',
    '- **Done:** close the issue. Closing does not unpublish; remove `approved` to take it off the shelf.',
    '- **Tidy it:** you can edit the JSON below first (fix a typo, blank the name, trim the note). The shelf reads it live.',
    '',
    'The email, if any, lives only in this private issue and is never published.',
    '',
    '```json',
    block,
    '```',
    '',
  ].join('\n');
}

export function parseBlock(body) {
  const m = /```json[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/.exec(String(body ?? ''));
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

// --- Visitor shelf ---------------------------------------------------------------------------

export function dayIn(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'})
      .formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return d.toISOString().slice(0, 10); }
}

const labelNames = issue => (Array.isArray(issue.labels) ? issue.labels : []).map(l => typeof l === 'string' ? l : l?.name);
const plain = (v, max) => typeof v === 'string' ? cap(clean(v), max) : '';

// Builds a WallItem from an explicit field list, so an email (or anything else) in the block can never leak.
export function wallItem(issue, timeZone = 'UTC') {
  if (!issue || typeof issue !== 'object' || issue.pull_request || !Number.isInteger(issue.number)) return null;
  const labels = labelNames(issue);
  if (!labels.includes('approved') || labels.includes('spam')) return null;
  const data = parseBlock(issue.body);
  const date = dayIn(issue.created_at, timeZone);
  if (!data || !date) return null;
  const title = plain(data.title, LIMITS.title);
  if (!title) return null;
  return {
    id: String(issue.number), title, author: plain(data.author, LIMITS.author),
    olWork: olWorkOf(data.olWork) ?? null, coverId: intOf(data.coverId, 1, 2 ** 31 - 1) ?? null,
    year: intOf(data.year, -4000, 2100) || null,
    name: plain(data.name, LIMITS.name), note: plain(data.note, LIMITS.note), date,
  };
}

export function mapWall(issues, timeZone) {
  const seen = new Set();
  return issues.map(i => wallItem(i, timeZone)).filter(x => x && !seen.has(x.id) && seen.add(x.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id)))
    .slice(0, WALL_MAX);
}

// --- CORS ------------------------------------------------------------------------------------

export function corsHeaders(origin, allowed) {
  const h = {'Vary': 'Origin'};
  if (origin && allowed.includes(origin)) Object.assign(h, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  return h;
}

// --- Throttle --------------------------------------------------------------------------------

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

// The salt comes from the Turnstile secret, so the stored keys can't be reversed to IPs by anyone
// who only sees KV, and rotating the secret forgets every counter.
export async function ipKey(ip, secret) {
  const salt = await sha256(`library-recs ip salt\n${secret}`);
  return `ip:${(await sha256(`${salt}\n${ip}`)).slice(0, 40)}`;
}
export const titleKey = async title => (await sha256(fold(title))).slice(0, 16);

// One KV record per IP: {t: [epoch s of verified attempts], d: [[titleKey, epoch s]]}. Pure: returns
// the verdict and the record to store, so a request costs at most one KV write.
export function throttle(record, now, key) {
  const t = (Array.isArray(record?.t) ? record.t : []).filter(x => Number.isFinite(x) && x > now - DAY && x <= now);
  const d = (Array.isArray(record?.d) ? record.d : []).filter(x => Array.isArray(x) && x[1] > now - DUP_WINDOW && x[1] <= now);
  const lastHour = t.filter(x => x > now - HOUR);
  let retryAfter = 0;
  if (lastHour.length >= THROTTLE.hour) retryAfter = Math.max(retryAfter, Math.min(...lastHour) + HOUR - now);
  if (t.length >= THROTTLE.day) retryAfter = Math.max(retryAfter, Math.min(...t) + DAY - now);
  if (retryAfter) return {retryAfter: Math.max(1, Math.ceil(retryAfter)), record: {t, d}};
  return {duplicate: d.some(x => x[0] === key), record: {t, d}};
}

export const recordAttempt = (record, now, key, created) =>
  ({t: [...record.t, now], d: created ? [...record.d, [key, now]] : record.d});
