// The "My Favourite Books" post, in his own words. Substack serves it as public JSON; body_html is parsed into
// tier 1 (above the <hr>: rank, the 11/10 or 10/10 score, the cover image he chose) and tier 2 (below it).
// Facts about the markup (11 Oct 2026): <ul> not <ol>; titles are "<em>Title </em>by" with the space inside the
// em; some authors are links; one <li> spans two <p>s (The MANIAC); one <li> holds two titles (both Elon Musk
// biographies); figures sit inside the <li> or right after its </ul>; the S3 original is in the img's data-attrs.
import {parseFragment, textContent, sanitize} from './html.mjs';
import {slug} from '../src/shared/normalize.js';
import {FeedError} from './goodreads.mjs';

const isEl = (n, ...tags) => n?.type === 'element' && (!tags.length || tags.includes(n.tag));
const isBlank = n => n.type === 'text' && !n.text.trim();
const collapse = s => s.replace(/\s+/g, ' ').trim();

// Document-order events: hr, li (with the figures inside it right after), figure.
function events(node, out = []) {
  for (const c of node.children) {
    if (!isEl(c)) continue;
    if (c.tag === 'hr') out.push({type: 'hr'});
    else if (c.tag === 'li') { out.push({type: 'li', node: c}); figuresIn(c, out); }
    else if (c.tag === 'figure') out.push({type: 'figure', node: c});
    else events(c, out);
  }
  return out;
}
function figuresIn(node, out) {
  for (const c of node.children) if (isEl(c)) { if (c.tag === 'figure') out.push({type: 'figure', node: c}); else if (c.tag !== 'li') figuresIn(c, out); }
}
const find = (node, tag) => {
  for (const c of node.children ?? []) { if (isEl(c, tag)) return c; const d = isEl(c) && find(c, tag); if (d) return d; }
  return null;
};

export function figureImage(fig) {
  const img = find(fig, 'img');
  if (!img) return null;
  let attrs = null;
  try { attrs = JSON.parse(img.attrs['data-attrs'] ?? 'null'); } catch { /* fall back below */ }
  let url = typeof attrs?.src === 'string' && /^https:\/\//.test(attrs.src) ? attrs.src : null;
  if (!url && img.attrs.src) {
    const seg = img.attrs.src.split('/').find(s => /^https?%3A/i.test(s));
    url = seg ? decodeURIComponent(seg) : img.attrs.src;
  }
  if (!url || !/^https:\/\//.test(url)) return null;
  const n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  return {url, w: n(attrs?.width), h: n(attrs?.height)};
}

// Where the byline ends: a "." followed by whitespace or the end, unless the word before it is an initial (R.),
// an initials cluster (S.E., B.K.S.) or Mr/Mrs/Ms/Dr/St.
function bylineEnd(text, before) {
  const re = /\.(?=\s|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const word = /(\S+)$/.exec(before + text.slice(0, m.index))?.[1] ?? '';
    if (/^[A-Za-z]$/.test(word) || /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word) || /^(?:Mr|Mrs|Ms|Dr|St)$/.test(word)) continue;
    return m.index;
  }
  return -1;
}

function bylineParts(nodes) {
  const html = sanitize(nodes).replace(/^\s*,\s*/, '').replace(/^by\s+/i, '').trim();
  const text = collapse(textContent(nodes)).replace(/^,\s*/, '').replace(/^by\s+/i, '');
  const names = text.replace(/^edited by\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\.$/, '');
  const authors = names.split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(s => s.trim()).filter(Boolean);
  return {bylineHtml: html, authors};
}

// One <li> -> {titles: [{title, bylineHtml, authors}], noteHtml, score}
export function parseEntry(li) {
  const paras = li.children.filter(c => isEl(c, 'p'));
  const blocks = paras.length ? paras : [li];
  const first = blocks[0].children.filter(c => !isEl(c, 'figure', 'div'));
  let i = 0;
  while (i < first.length && isBlank(first[i])) i++;
  if (!isEl(first[i], 'em', 'i')) return null;
  const titles = [];
  let current = {title: collapse(textContent(first[i])), nodes: []};
  const rest = [];
  let done = false;
  for (let k = i + 1; k < first.length; k++) {
    const n = first[k];
    if (done) { rest.push(n); continue; }
    if (n.type === 'text') {
      const before = textContent(current.nodes);
      const end = bylineEnd(n.text, before);
      if (end >= 0) {
        current.nodes.push({type: 'text', text: n.text.slice(0, end)});
        rest.push({type: 'text', text: n.text.slice(end + 1)});
        done = true;
      } else current.nodes.push(n);
    } else if (isEl(n, 'em', 'i') && /\s+and\s*$/.test(textContent(current.nodes))) {
      // "<em>Elon Musk</em> by Walter Isaacson and <em>Elon Musk</em> by Ashlee Vance."
      const last = current.nodes[current.nodes.length - 1];
      current.nodes[current.nodes.length - 1] = {type: 'text', text: last.text.replace(/\s+and\s*$/, '')};
      titles.push(current);
      current = {title: collapse(textContent(n)), nodes: []};
    } else current.nodes.push(n);
  }
  titles.push(current);
  const noteNodes = [...rest];
  for (const p of blocks.slice(1)) noteNodes.push({type: 'text', text: ' '}, ...p.children.filter(c => !isEl(c, 'figure', 'div')));
  let noteHtml = sanitize(noteNodes, {block: true});
  let score = null;
  const sm = /\s*(\d{1,2})\/10\.?\s*$/.exec(noteHtml);
  if (sm) { score = `${sm[1]}/10`; noteHtml = noteHtml.slice(0, sm.index).trim(); }
  return {titles: titles.map(t => ({title: t.title, ...bylineParts(t.nodes)})), noteHtml, score};
}

export function parseFavourites(bodyHtml) {
  const entries = [];
  let tier = 1, order = 0;
  const pos = {1: 0, 2: 0}, keys = new Set();
  for (const ev of events(parseFragment(bodyHtml))) {
    if (ev.type === 'hr') { if (entries.length) tier = 2; continue; }
    if (ev.type === 'figure') {
      if (tier !== 1) continue;
      // The most recent tier-1 entry without an image that began before this figure.
      const target = entries.findLast(e => e.tier === 1 && !e.image);
      const img = figureImage(ev.node);
      if (target && img) target.image = img;
      continue;
    }
    const e = parseEntry(ev.node);
    if (!e || !e.titles[0].title) continue;
    let key = slug(e.titles[0].title) || `entry-${order + 1}`;
    for (let n = 2; keys.has(key); n++) key = `${slug(e.titles[0].title)}-${n}`;
    keys.add(key);
    pos[tier]++;
    entries.push({key, tier, rank: tier === 1 ? pos[1] : null, order: ++order, position: pos[tier],
      score: e.score, titles: e.titles, noteHtml: e.noteHtml, image: null});
  }
  for (const e of entries) if (e.tier !== 1) e.image = null;
  return entries;
}

export function validateFavourites(entries, prev) {
  const t1 = entries.filter(e => e.tier === 1);
  if (t1.length < 10 || t1.some(e => !e.score)) throw new FeedError('favourites-structure', `expected at least 10 scored tier-1 entries, got ${t1.length}`);
  if (entries.length < 30) throw new FeedError('favourites-structure', `expected at least 30 entries, got ${entries.length}`);
  if (prev?.entries?.length && entries.length < 0.8 * prev.entries.length) {
    throw new FeedError('favourites-structure', `entries fell from ${prev.entries.length} to ${entries.length}`);
  }
}

export function snapshotFromPost(post, prev) {
  if (typeof post?.body_html !== 'string') throw new FeedError('favourites-structure', 'response has no body_html');
  const entries = parseFavourites(post.body_html);
  validateFavourites(entries, prev);
  return {postUrl: post.canonical_url || null, updatedAt: post.updated_at || null, entries};
}

// Tries each configured API URL; always re-parses so parser fixes apply without waiting for a post edit.
// If Substack's Cloudflare challenges the runner, the last good snapshot stays.
export async function syncSubstack(prev, {http, config, log = () => {}}) {
  let lastErr = null;
  for (const url of config.substack.api) {
    try {
      const res = await http.get(url, {kind: 'json', attempts: 3});
      let post;
      try { post = res.json(); } catch { throw new FeedError('not-json', `${url} did not return JSON`); }
      const snapshot = snapshotFromPost(post, prev);
      snapshot.postUrl ??= config.substack.postUrl;
      const changed = JSON.stringify(snapshot) !== JSON.stringify(prev ?? null);
      log(`substack: ${snapshot.entries.length} entries${changed ? ' (changed)' : ''}`);
      return {ok: true, snapshot, changed};
    } catch (err) {
      lastErr = err;
      log(`substack ${url}: FAILED ${err.code ?? ''} ${err.message}`);
    }
  }
  return {ok: false, snapshot: prev ?? null, changed: false, error: {code: lastErr?.code ?? 'crash', message: lastErr?.message ?? 'no API URL'}};
}

