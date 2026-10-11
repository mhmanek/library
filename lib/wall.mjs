// Visitor shelf snapshot: the Worker's GET /wall (approved recommendations), baked into each build as
// data/wall.json so the site has them even when the Worker is unreachable. Everything is plain text and
// whitelisted field by field, so an email (or anything else the Worker might ever add) can never be committed.
const DAY = /^\d{4}-\d{2}-\d{2}/;
const LIMITS = {title: 200, author: 120, name: 40, note: 280}; // CONTRACT WallItem limits
export const MAX_ITEMS = 200;

const plain = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim();
const intOrNull = v => (Number.isInteger(v) && v > 0 ? v : null);

export function sanitizeItems(items) {
  const out = [];
  for (const r of Array.isArray(items) ? items : []) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id ?? '');
    const title = plain(r.title, LIMITS.title);
    const date = typeof r.date === 'string' && DAY.test(r.date) ? r.date.slice(0, 10) : null;
    if (!/^\d+$/.test(id) || !title || !date) continue;
    out.push({
      id, title, author: plain(r.author, LIMITS.author),
      olWork: typeof r.olWork === 'string' && /^OL\d+W$/.test(r.olWork) ? r.olWork : null,
      coverId: intOrNull(r.coverId), year: Number.isInteger(r.year) && r.year !== 0 ? r.year : null,
      name: plain(r.name, LIMITS.name), note: plain(r.note, LIMITS.note), date,
    });
  }
  const seen = new Set();
  return out.filter(r => !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id))).slice(0, MAX_ITEMS);
}

export async function syncWall(prev, {http, config, log = () => {}}) {
  const workerUrl = config.visitorShelf?.workerUrl;
  const prevSnap = prev ?? {items: []};
  if (!workerUrl) return {ok: true, skipped: true, snapshot: prevSnap, changed: false};
  try {
    const res = await http.get(`${workerUrl}/wall`, {kind: 'json', timeout: 15_000, attempts: 3});
    let body;
    try { body = res.json(); } catch { throw Object.assign(new Error('wall response is not JSON'), {code: 'not-json'}); }
    if (!Array.isArray(body?.items)) throw Object.assign(new Error('wall response has no items array'), {code: 'wall-structure'});
    const snapshot = {items: sanitizeItems(body.items)};
    const changed = JSON.stringify(snapshot) !== JSON.stringify(prevSnap);
    log(`wall: ${snapshot.items.length} items${changed ? ' (changed)' : ''}`);
    return {ok: true, snapshot, changed};
  } catch (err) {
    log(`wall: FAILED ${err.code ?? ''} ${err.message}`);
    return {ok: false, snapshot: prevSnap, changed: false, error: {code: err.code ?? 'crash', message: err.message}};
  }
}
