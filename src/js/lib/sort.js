// Comparators over plain sort keys, shared by the build (default server order) and the browser (re-sorting).
// Key shape: {r: rating, wr: world avg | null, p: pages | null, y: year | null, d: 'YYYYMMDD' | '',
//             hue: number, t: sortKey(title), s: surname, fr: favourite rank for ordering | null, i: default index}
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
// Unknown values always sort last, whatever the direction.
const by = (get, dir) => (a, b) => {
  const x = num(get(a)), y = num(get(b));
  if (x === null || y === null) return (x === null) - (y === null);
  return dir * (x - y);
};
const text = get => (a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0);
const chain = (...cmps) => (a, b) => { for (const c of cmps) { const v = c(a, b); if (v) return v; } return 0; };

const byTitle = text(k => k.t);
const byIndex = (a, b) => a.i - b.i;
const rated = k => (k.r > 0 ? k.r : null);
const love = k => (k.r > 0 && num(k.wr) !== null ? k.r - k.wr : null);

export const COMPARATORS = {
  // The default for the read shelf: best first, his ranking breaking ties, then the crowd.
  best: chain(by(rated, -1), by(k => k.fr, 1), by(k => k.wr, -1), byTitle, byIndex),
  mine: chain(by(rated, -1), by(k => k.wr, -1), byTitle, byIndex),
  world: chain(by(k => k.wr, -1), byTitle, byIndex),
  love: chain(by(love, -1), byTitle, byIndex),
  title: chain(byTitle, byIndex),
  author: chain(text(k => k.s), byTitle, byIndex),
  long: chain(by(k => k.p, -1), byTitle, byIndex),
  old: chain(by(k => k.y, 1), byTitle, byIndex),
  added: chain(by(k => (k.d ? Number(k.d) : null), -1), byTitle, byIndex),
  colour: chain(by(k => k.hue, 1), byTitle, byIndex),
};

// '' means "shelf order": whatever the build rendered, i.e. the original index.
export function comparator(sort) {
  return sort && COMPARATORS[sort] ? COMPARATORS[sort] : byIndex;
}

// Favourite ordering key: tier-1 rank first (1..20), then tier 2 by post order, offset past tier 1.
export const favOrder = f => (!f ? null : f.tier === 1 ? f.rank ?? f.order : 1000 + f.order);
