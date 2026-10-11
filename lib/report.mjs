// What a sync did, for humans: the job summary (markdown), the data commit message, and a catalog diff.
// Alert text for GITHUB_OUTPUT is built from our own codes and numbers only, never from remote text.
const one = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const cell = s => one(s).replace(/\|/g, '\\|');
const short = (s, n = 48) => { const t = one(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export const REMEDIES = {
  'network': 'The server did not answer. Usually transient; nothing to do unless it persists for a day.',
  'timeout': 'The request timed out. Usually transient.',
  'not-rss': 'Goodreads returned a page that is not RSS (seen 18–24 Dec 2025). Usually transient.',
  'parse': 'The feed was not valid XML. Usually transient; if it persists, Goodreads changed the feed.',
  'channel-title': "The feed title is not \"<owner>'s bookshelf: <shelf>\". Check goodreads.ownerName and goodreads.shelves in config.json.",
  'item-owner': 'Items belong to someone else. Check goodreads.userId and ownerName in config.json.',
  'item-schema': 'An item has no book id, title or author. Goodreads changed the feed format.',
  'shelf-mismatch': 'Items list a different exclusive shelf (an invalid shelf name returns every book). Check goodreads.shelves.',
  'pagination': 'Paging never reached an empty page, or a page repeated. Goodreads changed paging.',
  'drop': 'A shelf shrank by more than 20%. If you removed books on purpose, run the workflow manually with allow_drop.',
  'favourites-structure': 'The favourites post no longer parses as expected (fewer entries or scores). Check the post, then lib/substack.mjs.',
  'not-json': 'Substack returned something that is not JSON (a Cloudflare challenge?). Run `node scripts/sync.mjs --only substack` locally and push.',
  'wall-structure': 'The Worker /wall response has no items array. Check the Worker.',
  'too-large': 'The response exceeded the size cap.',
  'crash': 'Unexpected error; see the job log.',
};
export const remedy = code => REMEDIES[code] ?? (/^http-4/.test(code) ? `HTTP ${code.slice(5)}: the request was refused. A 403 usually means a missing or blocked User-Agent.`
  : /^http-5/.test(code) ? `HTTP ${code.slice(5)}: the server failed. Usually transient.` : 'See the job log.');

export function diffCatalog(prev, next) {
  const before = new Map((prev?.books ?? []).map(b => [b.id, b])), after = new Map((next?.books ?? []).map(b => [b.id, b]));
  const added = [], removed = [], moved = [], rated = [];
  let drift = 0, favourites = 0, covers = 0;
  for (const [id, b] of after) {
    const p = before.get(id);
    if (!p) { added.push(b); continue; }
    if (p.shelf !== b.shelf) moved.push({book: b, from: p.shelf, to: b.shelf});
    if (p.rating !== b.rating) rated.push({book: b, from: p.rating, to: b.rating});
    if (p.avgRating !== b.avgRating) drift++;
    if (JSON.stringify(p.favourite) !== JSON.stringify(b.favourite)) favourites++;
    if (p.cover?.stem !== b.cover?.stem) covers++;
  }
  for (const [id, b] of before) if (!after.has(id)) removed.push(b);
  return {added, removed, moved, rated, drift, favourites, covers};
}

const titled = (verb, list) => (list.length ? `${verb} ${list.slice(0, 2).map(b => `"${short(b.title, 40)}"`).join(', ')}${list.length > 2 ? ` +${list.length - 2} more` : ''}` : null);

export function commitMessage({diff, outcomes = {}, wallDiff = 0, sources = {}}) {
  const to = s => diff.moved.filter(m => m.to === s).map(m => m.book);
  const newOn = s => diff.added.filter(b => b.shelf === s);
  const parts = [
    titled('finished', [...to('read'), ...newOn('read')]),
    titled('started', [...to('currently-reading'), ...newOn('currently-reading')]),
    titled('gave up on', [...to('did-not-finish'), ...newOn('did-not-finish')]),
    newOn('to-read').length ? `+${newOn('to-read').length} want-to-read` : null,
    diff.removed.length ? `-${diff.removed.length} removed` : null,
    titled('re-rated', diff.rated.filter(r => !diff.moved.some(m => m.book.id === r.book.id)).map(r => r.book)),
    diff.favourites ? `${diff.favourites} favourites changed` : null,
    wallDiff ? `visitor shelf changed` : null,
    diff.drift ? `${diff.drift} world rating${diff.drift === 1 ? '' : 's'} moved` : null,
    diff.covers ? `${diff.covers} cover${diff.covers === 1 ? '' : 's'} updated` : null,
  ].filter(Boolean);
  const subject = `Sync: ${parts.join('; ') || 'data refresh'}`;
  const body = Object.entries(outcomes).map(([k, o]) => `${k}: ${o.skipped ? 'skipped' : o.ok ? 'ok' : `failed (${o.error?.code}), kept last good`}${sources[k]?.counts ? ` ${sources[k].counts}` : ''}`);
  return `${short(subject, 120)}\n\n${body.join('\n')}\n`;
}

export function alertMessage(alerts) {
  return alerts.map(a => `${a.source} failing since ${a.since} (${String(a.code).replace(/[^\w.-]/g, '')})`).join('; ').replace(/[^\w .:;()+-]/g, '');
}

export function renderSummary({nowIso, outcomes, shelves = {}, ol, covers, diff, warnings = [], alerts = [], dryRun, written = []}) {
  const L = [`## Library sync ${dryRun ? '(dry run) ' : ''}— ${nowIso}`, '', '| Source | Status | Details |', '|---|---|---|'];
  const status = o => (!o ? 'not run' : o.skipped ? 'skipped' : o.ok ? 'ok' : `**failed** \`${cell(o.error?.code)}\`, kept last good`);
  const gr = Object.entries(shelves).map(([s, x]) => `${s} ${x.count ?? '?'}${x.ok ? (x.unchanged ? ' (304)' : '') : ` **${cell(x.error?.code)}**`}`).join(' · ');
  L.push(`| Goodreads | ${status(outcomes.goodreads)} | ${cell(gr)} |`);
  L.push(`| Substack favourites | ${status(outcomes.substack)} | ${cell(outcomes.substack?.detail ?? '')} |`);
  L.push(`| Visitor shelf | ${status(outcomes.wall)} | ${cell(outcomes.wall?.detail ?? '')} |`);
  if (ol) L.push(`| Open Library | ${ol.circuitOpen ? '**circuit open**' : 'ok'} | ${ol.skipped ? 'skipped' : `${ol.requests} requests, ${ol.hits} hits, ${ol.misses} misses, ${ol.deferred} deferred (of ${ol.wanted} wanted)`} |`);
  if (covers) L.push(`| Covers | ok | ${covers.skipped ? 'skipped' : `fetched ${covers.fetched} (ok ${covers.ok}, bad ${covers.bad}, err ${covers.err}), pending ${covers.pending}${covers.wouldFetch ? `, would fetch ${covers.wouldFetch}` : ''}, removed ${covers.removed ?? 0} files`} |`);
  const failing = Object.entries(outcomes).filter(([, o]) => o && !o.ok && !o.skipped);
  if (failing.length) {
    L.push('', '### What to do');
    for (const [k, o] of failing) L.push(`- **${k}** \`${cell(o.error?.code)}\`: ${remedy(o.error?.code)}`);
  }
  if (diff) {
    L.push('', '### Changes');
    const lines = [
      ...diff.added.slice(0, 20).map(b => `- added to ${b.shelf ?? 'favourites'}: ${cell(b.title)}`),
      diff.added.length > 20 ? `- … and ${diff.added.length - 20} more added` : null,
      ...diff.removed.slice(0, 20).map(b => `- removed: ${cell(b.title)}`),
      ...diff.moved.map(m => `- moved ${m.from} → ${m.to}: ${cell(m.book.title)}`),
      ...diff.rated.map(r => `- rating ${r.from} → ${r.to}: ${cell(r.book.title)}`),
      diff.drift ? `- ${diff.drift} Goodreads average ratings drifted` : null,
      diff.favourites ? `- ${diff.favourites} favourites changed` : null,
      diff.covers ? `- ${diff.covers} covers changed` : null,
    ].filter(Boolean);
    L.push(...(lines.length ? lines : ['- nothing published changed']));
  }
  if (written.length) L.push('', `Files written: ${written.map(f => `\`${f}\``).join(', ')}`);
  if (warnings.length) { L.push('', '### Warnings'); for (const w of warnings) L.push(`- ${cell(w)}`); }
  if (alerts.length) { L.push('', '### Alert', `- ${alertMessage(alerts)}`); }
  return L.join('\n') + '\n';
}
