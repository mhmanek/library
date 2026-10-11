// Hand-written validator for the books.json contract (docs/CONTRACT.md). Used by check-site and tests.
// Returns a list of problems; an empty list means valid.
const SHELF = ['read', 'currently-reading', 'did-not-finish', 'to-read'];
const SOURCES = ['override', 'substack', 'goodreads', 'openlibrary', 'placeholder'];
const HEX = /^#[0-9a-f]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SAFE_TAGS = new Set(['a', 'em', 'strong', 'br', 'p', 'blockquote']);

const isInt = v => Number.isInteger(v);
const isNullable = (v, test) => v === null || test(v);
const isStr = v => typeof v === 'string';

// Checks that an HTML fragment only uses the allowlisted tags and safe hrefs.
export function unsafeHtml(html) {
  const problems = [];
  for (const m of String(html).matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!SAFE_TAGS.has(tag)) problems.push(`tag <${tag}>`);
    const attrs = m[2].trim();
    if (attrs && !m[0].startsWith('</')) {
      if (tag !== 'a') problems.push(`attributes on <${tag}>`);
      else {
        for (const a of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
          if (a[1] === 'href' && !/^(https:|mailto:)/.test(a[2])) problems.push(`href ${a[2]}`);
          if (!['href', 'rel'].includes(a[1])) problems.push(`attribute ${a[1]} on <a>`);
        }
      }
    }
  }
  if (/javascript:/i.test(html)) problems.push('javascript: URL');
  return problems;
}

export function validateBooks(json) {
  const errors = [];
  const err = (path, msg) => { if (errors.length < 200) errors.push(`${path}: ${msg}`); };
  if (!json || typeof json !== 'object') return ['root: not an object'];
  if (json.version !== 1) err('version', 'must be 1');
  if (!isNullable(json.syncedAt, v => ISO.test(v))) err('syncedAt', 'must be ISO-8601 UTC or null');

  const s = json.sources ?? {};
  for (const key of ['goodreads', 'substack', 'wall']) if (!s[key]) err(`sources.${key}`, 'missing');
  if (s.goodreads) for (const shelf of SHELF) if (!isInt(s.goodreads.items?.[shelf])) err(`sources.goodreads.items.${shelf}`, 'must be an integer');
  if (s.wall && !isInt(s.wall.count)) err('sources.wall.count', 'must be an integer');

  for (const key of ['read', 'reading', 'dnf', 'toRead', 'favourites', 'favouritesOnly']) if (!isInt(json.counts?.[key])) err(`counts.${key}`, 'must be an integer');

  const st = json.stats ?? {};
  if (!st.read || !isInt(st.read.count)) err('stats.read.count', 'must be an integer');
  if (st.read && st.read.hist && Object.keys(st.read.hist).join() !== '1,2,3,4,5') err('stats.read.hist', 'must have keys 1..5');
  for (const key of ['toRead', 'dnf', 'reading', 'favourites']) if (!st[key]) err(`stats.${key}`, 'missing');

  if (!Array.isArray(json.books)) { err('books', 'must be an array'); return errors; }
  const ids = new Set(), slugs = new Set();
  json.books.forEach((b, i) => {
    const p = `books[${i}]${b?.id ? `(${b.id})` : ''}`;
    if (!/^(gr-\d+|fav-[a-z0-9-]+)$/.test(b.id ?? '')) err(p, 'bad id');
    if (ids.has(b.id)) err(p, 'duplicate id'); ids.add(b.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.slug ?? '')) err(p, 'bad slug');
    if (slugs.has(b.slug)) err(p, `duplicate slug ${b.slug}`); slugs.add(b.slug);
    if (!isNullable(b.goodreadsId, v => /^\d+$/.test(v))) err(p, 'bad goodreadsId');
    if (b.id?.startsWith('gr-') && b.goodreadsId !== b.id.slice(3)) err(p, 'goodreadsId must match id');
    if (!isStr(b.title) || !b.title) err(p, 'title required');
    if (!isNullable(b.subtitle, isStr)) err(p, 'bad subtitle');
    if (!isNullable(b.series, v => isStr(v.name) && isNullable(v.index, isStr))) err(p, 'bad series');
    if (!Array.isArray(b.authors) || !b.authors.length || b.authors.some(a => !isStr(a) || !a)) err(p, 'authors must be non-empty strings');
    if (!(b.shelf === null ? b.id?.startsWith('fav-') : SHELF.includes(b.shelf))) err(p, 'bad shelf');
    if (typeof b.rating !== 'number' || b.rating < 0 || b.rating > 5) err(p, 'bad rating');
    if (!isNullable(b.avgRating, v => typeof v === 'number' && v >= 0 && v <= 5)) err(p, 'bad avgRating');
    if (!isNullable(b.pages, v => isInt(v) && v > 0)) err(p, 'bad pages');
    if (!isNullable(b.published, v => isInt(v) && v !== 0)) err(p, 'bad published');
    if (!isNullable(b.dateAdded, v => DAY.test(v))) err(p, 'bad dateAdded');
    if (!isNullable(b.readAt, v => DAY.test(v))) err(p, 'bad readAt');
    if (!isNullable(b.isbn13, v => /^97[89]\d{10}$/.test(v))) err(p, 'bad isbn13');
    if (!isNullable(b.olWork, v => /^OL\d+W$/.test(v))) err(p, 'bad olWork');
    if (!isNullable(b.goodreadsUrl, v => /^https:\/\/www\.goodreads\.com\/book\/show\/\d+$/.test(v))) err(p, 'bad goodreadsUrl');
    if (b.reviewHtml !== null) { if (!isStr(b.reviewHtml)) err(p, 'bad reviewHtml'); else unsafeHtml(b.reviewHtml).forEach(x => err(p, `reviewHtml ${x}`)); }

    const c = b.cover ?? {};
    if (!SOURCES.includes(c.source)) err(p, 'bad cover.source');
    if (c.source === 'placeholder') {
      if (c.stem !== null || c.src !== null || c.src2x !== null) err(p, 'placeholder cover must have null stem/src/src2x');
    } else if (!/^[0-9a-f]{8,}$/.test(c.stem ?? '') || c.src !== `covers/${c.stem}-200.webp` || c.src2x !== `covers/${c.stem}-400.webp`) {
      err(p, 'cover src/src2x must be covers/<stem>-200.webp and -400.webp');
    }
    if (!isInt(c.w) || !isInt(c.h) || c.w <= 0 || c.h <= 0) err(p, 'bad cover size');
    if (typeof c.square !== 'boolean') err(p, 'cover.square must be boolean');
    for (const k of ['bg', 'spine', 'accent', 'ink', 'bgInk']) if (!HEX.test(c.colors?.[k] ?? '')) err(p, `bad cover.colors.${k}`);

    const f = b.favourite;
    if (f !== null) {
      if (!f || ![1, 2].includes(f.tier)) err(p, 'bad favourite.tier');
      else {
        if (f.tier === 1 ? !isInt(f.rank) : f.rank !== null) err(p, 'favourite.rank must be an integer in tier 1 and null in tier 2');
        if (!isInt(f.order) || !isInt(f.position)) err(p, 'favourite.order/position must be integers');
        if (!isStr(f.groupId) || !f.groupId) err(p, 'favourite.groupId required');
        if (!isNullable(f.score, v => /^\d{1,2}\/10$/.test(v))) err(p, 'bad favourite.score');
        for (const k of ['bylineHtml', 'noteHtml']) {
          if (!isStr(f[k])) err(p, `favourite.${k} must be a string`);
          else unsafeHtml(f[k]).forEach(x => err(p, `favourite.${k} ${x}`));
        }
      }
    }
    if (!Array.isArray(b.mergedIds) || b.mergedIds.some(x => !/^\d+$/.test(x))) err(p, 'bad mergedIds');
  });
  return errors;
}

export function validateWall(json) {
  const errors = [];
  if (!json || !Array.isArray(json.items)) return ['items: must be an array'];
  json.items.forEach((r, i) => {
    const p = `items[${i}]`;
    if (!/^\d+$/.test(r.id ?? '')) errors.push(`${p}: bad id`);
    if (!isStr(r.title) || !r.title || r.title.length > 200) errors.push(`${p}: bad title`);
    for (const [k, max] of [['author', 120], ['name', 40], ['note', 280]]) if (!isStr(r[k]) || r[k].length > max) errors.push(`${p}: bad ${k}`);
    if (!DAY.test(r.date ?? '')) errors.push(`${p}: bad date`);
    if ('email' in r || 'contact' in r) errors.push(`${p}: must never contain email`);
    if (!isNullable(r.coverId, isInt)) errors.push(`${p}: bad coverId`);
    if (!isNullable(r.olWork, v => /^OL\d+W$/.test(v))) errors.push(`${p}: bad olWork`);
  });
  return errors;
}
