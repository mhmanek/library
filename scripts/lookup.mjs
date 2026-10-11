#!/usr/bin/env node
// One-off Open Library title/author lookup for data/manual/favourites-map.json "notOnGoodreads" entries:
// prints candidate ISBN-13s (best-matching edition first) and cover ids so a human can pick one.
//   node scripts/lookup.mjs "The Art of Learning" "Josh Waitzkin"
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {createHttp} from '../lib/http.mjs';
import {cleanIsbn, isValidIsbn13, isbn10to13} from '../lib/isbn.mjs';

const FIELDS = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,editions,editions.key,editions.title,editions.isbn,editions.cover_i,isbn';
const to13 = s => { const c = cleanIsbn(s); return c.length === 13 ? (isValidIsbn13(c) ? c : null) : isbn10to13(c); };

export async function lookup(title, author, {http, limit = 5}) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}&fields=${FIELDS}&limit=${limit}`;
  const json = (await http.get(url, {kind: 'json'})).json();
  return (json.docs ?? []).map(doc => {
    const ed = doc.editions?.docs?.[0] ?? null;
    const edIsbns = [...new Set((ed?.isbn ?? []).map(to13).filter(Boolean))];
    const others = [...new Set((doc.isbn ?? []).map(to13).filter(Boolean))].filter(i => !edIsbns.includes(i));
    return {work: doc.key, title: doc.title, authors: doc.author_name ?? [], year: doc.first_publish_year ?? null,
      pages: doc.number_of_pages_median ?? null, workCover: doc.cover_i ?? null,
      edition: ed ? {key: ed.key, title: ed.title, cover: ed.cover_i ?? null, isbn13: edIsbns} : null, otherIsbn13: others.slice(0, 8)};
  });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const [title, author] = process.argv.slice(2);
  if (!title) { console.error('usage: node scripts/lookup.mjs "<title>" ["<author>"]'); process.exit(2); }
  const config = await loadConfig();
  const http = createHttp({userAgent: config.sync.userAgent});
  for (const r of await lookup(title, author, {http})) {
    console.log(`${r.work}  ${r.title} — ${r.authors.join(', ')} (${r.year ?? '?'}), ${r.pages ?? '?'} pp, work cover ${r.workCover ?? '-'}`);
    if (r.edition) console.log(`  best edition ${r.edition.key} "${r.edition.title}" cover ${r.edition.cover ?? '-'} isbn13 ${r.edition.isbn13.join(' ') || '-'}`);
    if (r.otherIsbn13.length) console.log(`  other isbn13: ${r.otherIsbn13.join(' ')}`);
  }
}
