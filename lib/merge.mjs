// Duplicate editions -> one book. The ladder, strongest evidence first: manual sameWork pairs, the same Goodreads
// id in two feeds (a book moved mid-sync), the same ISBN-13, the same Open Library work (only with a shared
// surname and equal markers, because OL conflates sets and adaptations), then the calibrated fuzzy rule from
// src/shared/match.js inside surname blocks. differentWork pairs are a cannot-link checked before every union.
// Deterministic: records are visited in numeric id order, so shuffled input gives identical output.
import {sameWork} from '../src/shared/match.js';
import {surnames, markers, sameMarkers} from '../src/shared/normalize.js';

export const SHELF_RANK = {'read': 0, 'currently-reading': 1, 'did-not-finish': 2, 'to-read': 3};
const rank = s => SHELF_RANK[s] ?? 9;
const byId = (a, b) => Number(a.goodreadsId) - Number(b.goodreadsId) || rank(a.shelf) - rank(b.shelf);

export const workOf = r => ({title: r.matchTitle ?? r.title, subtitle: r.subtitle, authors: r.authors, isbn13: r.isbn13, olWork: r.olWork ?? null, series: r.series});

// "Totto-chan" vs "Totto-chan: The Sequel" passes every title rule (one side simply lacks a subtitle, exactly like
// "Buffett" vs "Buffett: The Making of…"), so a sequel word on only one side is treated as one more marker.
const SEQUEL = /\b(sequel|prequel)\b/i;
export const sequelConflict = (a, b) => SEQUEL.test(`${a.title} ${a.subtitle ?? ''}`) !== SEQUEL.test(`${b.title} ${b.subtitle ?? ''}`);
// Not done: trusting Open Library when it calls two editions different works. It splits Hume's Enquiry from the
// Hackett edition (a real duplicate) yet files "The Making of Star Wars" and "…: Revenge of the Sith" as one work,
// so that pair needs a differentWork override in data/manual/overrides.json.
export const sameWorkStrict = (a, b) => !sequelConflict(a, b) && sameWork(a, b);

export function mergeRecords(records, {overrides = {}} = {}) {
  const recs = [...records].sort(byId);
  const parent = recs.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const members = new Map(recs.map((_, i) => [i, [i]]));
  const cannot = new Set((overrides.differentWork ?? []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const reasons = [];
  const idx = new Map();
  recs.forEach((r, i) => { if (!idx.has(r.goodreadsId)) idx.set(r.goodreadsId, []); idx.get(r.goodreadsId).push(i); });

  function union(i, j, why, force = false) {
    let a = find(i), b = find(j);
    if (a === b) return false;
    if (!force) {
      for (const x of members.get(a)) for (const y of members.get(b)) if (cannot.has(`${recs[x].goodreadsId}|${recs[y].goodreadsId}`)) return false;
    }
    if (b < a) [a, b] = [b, a];
    parent[b] = a;
    members.set(a, [...members.get(a), ...members.get(b)]);
    members.delete(b);
    reasons.push({a: recs[i].goodreadsId, b: recs[j].goodreadsId, why});
    return true;
  }
  const pairs = (list, test, why) => {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) if (test(recs[list[x]], recs[list[y]])) union(list[x], list[y], why);
  };
  const groupBy = keyOf => {
    const m = new Map();
    recs.forEach((r, i) => { const k = keyOf(r); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
    return [...m.values()].filter(l => l.length > 1);
  };

  for (const [a, b] of overrides.sameWork ?? []) {
    const [i] = idx.get(String(a)) ?? [], [j] = idx.get(String(b)) ?? [];
    if (i != null && j != null) union(i, j, 'manual', true);
  }
  for (const list of idx.values()) for (let k = 1; k < list.length; k++) union(list[0], list[k], 'same-id');
  for (const list of groupBy(r => r.isbn13)) pairs(list, () => true, 'isbn13');
  const overlap = (a, b) => { const sb = surnames(b.authors); return surnames(a.authors).some(s => sb.includes(s)); };
  const marks = r => markers([r.matchTitle ?? r.title, r.subtitle].filter(Boolean).join(': '));
  for (const list of groupBy(r => r.olWork)) pairs(list, (a, b) => overlap(a, b) && sameMarkers(marks(a), marks(b)), 'ol-work');
  // Fuzzy only inside surname blocks: exact, because the rule needs a shared surname anyway.
  const blocks = new Map();
  recs.forEach((r, i) => { for (const s of surnames(r.authors)) { if (!blocks.has(s)) blocks.set(s, []); blocks.get(s).push(i); } });
  for (const list of blocks.values()) if (list.length > 1) pairs(list, (a, b) => sameWorkStrict(workOf(a), workOf(b)), 'title');

  const groups = [...members.values()].map(list => list.map(i => recs[i]).sort(byId)).sort((a, b) => byId(a[0], b[0]));
  return {groups, reasons};
}

// Primary edition: pinned by the favourites map, then the strongest shelf, then rated, then earliest added,
// then smallest id. This keeps the public id stable as editions come and go.
export function pickPrimary(group, pinned = new Set()) {
  const t = r => (r.addedAt ? Date.parse(r.addedAt) : Infinity);
  return [...group].sort((a, b) => (pinned.has(b.goodreadsId) - pinned.has(a.goodreadsId)) || rank(a.shelf) - rank(b.shelf)
    || ((b.rating > 0) - (a.rating > 0)) || t(a) - t(b) || byId(a, b))[0];
}

export function mergeGroup(group, {pinned} = {}) {
  const primary = pickPrimary(group, pinned);
  const ids = [...new Set(group.map(r => r.goodreadsId))];
  const others = group.filter(r => r !== primary);
  const members = [primary, ...others];
  const best = members.reduce((s, r) => (rank(r.shelf) < rank(s.shelf) ? r : s), primary);
  const grYears = members.map(r => r.published).filter(y => y != null);
  const olYear = members.map(r => r.olYear).find(y => y != null) ?? null;
  const dates = members.map(r => r.dateAdded).filter(Boolean).sort();
  const reads = members.map(r => r.readAt).filter(Boolean).sort();
  return {
    goodreadsId: primary.goodreadsId, primary, members,
    mergedIds: ids.filter(id => id !== primary.goodreadsId).sort((a, b) => Number(a) - Number(b)),
    shelf: best.shelf,
    rating: primary.rating > 0 ? primary.rating : Math.max(0, ...members.map(r => r.rating)),
    avgRating: primary.avgRating,
    title: primary.title, subtitle: primary.subtitle, series: primary.series, authors: primary.authors,
    isbn13: primary.isbn13 ?? members.find(r => r.isbn13)?.isbn13 ?? null,
    olWork: primary.olWork ?? members.find(r => r.olWork)?.olWork ?? null,
    pages: members.map(r => r.grPages).find(p => p >= 40) ?? members.map(r => r.olPages).find(p => p >= 40) ?? null,
    published: grYears.length ? Math.min(...grYears) : olYear,
    publishedSource: grYears.length ? 'goodreads' : olYear != null ? 'openlibrary' : null,
    dateAdded: dates[0] ?? null,
    readAt: reads.at(-1) ?? null,
    review: members.map(r => r.review).find(Boolean) ?? null,
  };
}
