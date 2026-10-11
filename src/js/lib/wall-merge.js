// Pure parts of the visitor-shelf refresh, so Node can test them: the live /wall list is authoritative
// (unapproved or removed items disappear); an identical list means no re-render.
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Never trust the network: plain strings with the contract's limits, and nothing but the known fields.
export function cleanItem(x) {
  if (!x || typeof x !== 'object' || !/^\d+$/.test(String(x.id ?? '')) || typeof x.title !== 'string' || !x.title.trim()) return null;
  return {
    id: String(x.id), title: str(x.title, 200), author: str(x.author, 120), name: str(x.name, 40), note: str(x.note, 280),
    olWork: /^OL\d+W$/.test(x.olWork ?? '') ? x.olWork : null, coverId: Number.isInteger(x.coverId) && x.coverId > 0 ? x.coverId : null,
    year: Number.isInteger(x.year) ? x.year : null, date: /^\d{4}-\d{2}-\d{2}$/.test(x.date ?? '') ? x.date : '',
  };
}

export function mergeWall(snapshotIds, items) {
  const ids = items.map(x => String(x.id));
  const same = ids.length === snapshotIds.length && ids.every((id, i) => id === snapshotIds[i]);
  const known = new Set(snapshotIds);
  return {changed: !same, items: items.map(item => ({item, isNew: !known.has(String(item.id))}))};
}
