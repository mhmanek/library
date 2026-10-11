// Marginalia, computed once here and shipped in books.json (CONTRACT Stats). Read stats use the read shelf's
// Goodreads books only, never favourites-only entries. There are deliberately no year or timeline fields:
// only 9 of 169 read books have a read date, and the add dates are dominated by the October 2025 back-fill.
const round2 = x => Math.round(x * 100) / 100;
const mean = xs => (xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const PAGE_CAP = 3000; // omnibus or data-entry errors would swamp the total

function pageStats(books) {
  const known = books.filter(b => Number.isInteger(b.pages) && b.pages <= PAGE_CAP);
  return {total: known.reduce((s, b) => s + b.pages, 0), known: known.length};
}

export function computeStats(books) {
  const read = books.filter(b => b.shelf === 'read' && b.goodreadsId);
  const rated = read.filter(b => b.rating > 0);
  const withAvg = rated.filter(b => b.avgRating != null);
  const hist = {5: 0, 4: 0, 3: 0, 2: 0, 1: 0};
  for (const b of rated) hist[Math.min(5, Math.max(1, Math.floor(b.rating)))]++;

  const oldest = read.filter(b => b.published != null && b.publishedSource === 'goodreads')
    .reduce((o, b) => (!o || b.published < o.published ? b : o), null);
  const longest = read.filter(b => Number.isInteger(b.pages) && b.pages <= PAGE_CAP).reduce((o, b) => (!o || b.pages > o.pages ? b : o), null);

  const authorCount = new Map();
  for (const b of read) { const a = b.authors[0]; authorCount.set(a, (authorCount.get(a) ?? 0) + 1); }
  const topAuthors = [...authorCount].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5).map(([name, count]) => ({name, count}));

  const deltas = withAvg.map(b => ({id: b.id, delta: round2(b.rating - b.avgRating)}));
  const crush = deltas.filter(d => d.delta > 0).reduce((o, d) => (!o || d.delta > o.delta ? d : o), null);
  const harsh = deltas.filter(d => d.delta < 0).reduce((o, d) => (!o || d.delta < o.delta ? d : o), null);

  const toRead = books.filter(b => b.shelf === 'to-read');
  const last = toRead.filter(b => b.dateAdded).reduce((o, b) => (!o || b.dateAdded > o.dateAdded ? b : o), null);
  const favs = books.filter(b => b.favourite);

  return {
    read: {
      count: read.length, rated: rated.length, mean: mean(rated.map(b => b.rating)),
      worldMean: mean(withAvg.map(b => b.avgRating)), hist, pages: pageStats(read),
      oldest: oldest ? {id: oldest.id, year: oldest.published} : null,
      longest: longest ? {id: longest.id, pages: longest.pages} : null,
      topAuthors, crush, harsh, dated: read.filter(b => b.readAt).length,
    },
    toRead: {count: toRead.length, pages: pageStats(toRead), lastAdded: last ? {id: last.id, date: last.dateAdded} : null},
    dnf: {count: books.filter(b => b.shelf === 'did-not-finish').length},
    reading: {count: books.filter(b => b.shelf === 'currently-reading').length},
    favourites: {
      ranked: favs.filter(b => b.favourite.tier === 1).length, more: favs.filter(b => b.favourite.tier === 2).length,
      elevens: favs.filter(b => b.favourite.score === '11/10').length, offGoodreads: favs.filter(b => !b.goodreadsId).length,
    },
  };
}
