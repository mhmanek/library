#!/usr/bin/env node
// Offline debugging: why does a book look the way it does? For a Goodreads id, a slug, a fav- id or a title
// fragment, prints the normalised records, the merge decisions, the favourite match and the cover candidates
// with their cached verdicts.
//   node scripts/explain.mjs 24113
//   node scripts/explain.mjs "black swan"
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {loadData, assemble, publicBook} from '../lib/catalog.mjs';
import {fold} from '../src/shared/normalize.js';

export function explain(query, assembled, data) {
  const q = String(query).trim(), f = fold(q);
  const ids = b => [b.id, b.slug, b.goodreadsId, ...b.mergedIds].filter(Boolean);
  let hits = assembled.books.filter(b => ids(b).includes(q) || ids(b).includes(q.replace(/^gr-/, '')));
  if (!hits.length && f) hits = assembled.books.filter(b => fold(`${b.title} ${b.subtitle ?? ''} ${b.authors.join(' ')}`).includes(f));
  const out = [];
  if (!hits.length) {
    const rec = assembled.records.find(r => r.goodreadsId === q);
    out.push(rec ? `gr ${q} is in the feeds but hidden by data/manual/overrides.json` : `no book matches "${q}"`);
    return out.join('\n');
  }
  for (const b of hits.slice(0, 5)) {
    out.push(`\n== ${b.id}  ${b.slug}  [${b.shelf ?? 'favourites-only'}]  ${b.title}${b.subtitle ? `: ${b.subtitle}` : ''} — ${b.authors.join(', ')}`);
    for (const r of b.members) {
      out.push(`  record gr ${r.goodreadsId} on ${r.shelf}: "${r.rawTitle}" by ${r.authors[0]}`);
      out.push(`    -> title "${r.title}" subtitle ${JSON.stringify(r.subtitle)} series ${JSON.stringify(r.series)} isbn13 ${r.isbn13 ?? '-'} olWork ${r.olWork ?? '-'} pages gr ${r.grPages ?? '-'}/ol ${r.olPages ?? '-'} rating ${r.rating} added ${r.dateAdded}`);
    }
    const mine = new Set(b.members.map(r => r.goodreadsId));
    for (const m of assembled.reasons.filter(x => mine.has(x.a) || mine.has(x.b))) out.push(`  merged ${m.a} + ${m.b} by ${m.why}`);
    if (b.favourite) out.push(`  favourite: tier ${b.favourite.tier}${b.favourite.rank ? ` rank ${b.favourite.rank}` : ''} order ${b.favourite.order} ${b.favourite.score ?? ''} (matched by ${b.matchedBy})`);
    else out.push('  favourite: none');
    out.push(`  review: ${b.review ? (b.reviewHtml ? 'shown' : 'dropped (duplicates the favourite note)') : 'none'}`);
    const entries = data.covers?.entries ?? {};
    for (const c of b.candidates) {
      const e = entries[c.url];
      const verdict = !e ? 'not fetched yet' : e.s === 'ok' ? `ok ${e.w}x${e.h}${e.square ? ' square' : ''} ${e.hash}` : e.s === 'bad' ? `bad (${e.why})` : `error x${e.n}`;
      out.push(`  cover ${c.url === b.coverUrl ? '*' : ' '} ${c.source.padEnd(11)} ${verdict}  ${c.url}${c.after ? ' (only after an HTTP failure)' : ''}`);
    }
    out.push(`  chosen: ${b.cover.source}${b.cover.stem ? ` ${b.cover.stem}` : ''}  colors ${JSON.stringify(b.cover.colors)}`);
    out.push(`  public: ${JSON.stringify(publicBook(b))}`);
  }
  if (hits.length > 5) out.push(`\n(${hits.length - 5} more matches)`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const query = process.argv.slice(2).join(' ');
  if (!query) { console.error('usage: node scripts/explain.mjs <goodreads id | slug | fav-id | title fragment>'); process.exit(2); }
  const config = await loadConfig();
  const data = await loadData();
  const a = assemble(data, config);
  console.log(explain(query, a, data));
  if (a.warnings.length) console.log(`\nwarnings:\n  ${a.warnings.join('\n  ')}`);
}
