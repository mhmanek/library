// Text normalisation shared by the Node sync/build and the browser (recommend form, visitor-shelf stamps).
// Plain ES module with no Node APIs, so the browser can import it as-is.

const SPECIAL = {'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ß': 'ss', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'þ': 'th', 'Þ': 'TH'};

// Unicode-safe folding: case, accents, curly quotes, "&" vs "and" and punctuation never matter.
// Uses \p{L}/\p{N}, so 三体 or Πλάτων never fold to an empty string.
export function fold(s) {
  return String(s ?? '')
    .replace(/[łŁøØæÆœŒßđĐıþÞ]/g, c => SPECIAL[c])
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[‘’‚‛′`]/g, "'").replace(/[“”„‟″]/g, '"')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const slug = s => fold(s).replace(/ /g, '-');

// Sort key that ignores a leading article.
export const sortKey = s => fold(s).replace(/^(the|a|an) /, '');

const SERIES_TAIL = /\s*\([^()]*#[^()]*\)\s*$/;

// The part of a title used for matching: no series suffix, no subtitle, folded.
export function shortTitle(title) {
  let t = String(title ?? '').replace(SERIES_TAIL, '');
  const colon = t.indexOf(': ');
  if (colon > 0) t = t.slice(0, colon);
  return fold(t);
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);

export function surname(name) {
  const tokens = fold(String(name ?? '').replace(/\([^)]*\)/g, '')).split(' ').filter(t => t && !SUFFIXES.has(t));
  return tokens.at(-1) ?? '';
}

export const surnames = authors => [...new Set((authors ?? []).map(surname).filter(Boolean))];

const PARTICLES = new Set(['le', 'la', 'de', 'du', 'da', 'di', 'del', 'della', 'des', 'van', 'von', 'der', 'den', 'ten', 'ter', 'st', 'saint', 'al', 'el', 'bin', 'ibn']);

// The family name with its particles, for readable slugs: "Ursula K. Le Guin" -> "le guin", "John le Carré" -> "le carre".
// Matching keeps using surname(), the bare last token.
export function familyName(name) {
  const tokens = fold(String(name ?? '').replace(/\([^)]*\)/g, '')).split(' ').filter(t => t && !SUFFIXES.has(t));
  let i = tokens.length - 1;
  while (i > 1 && PARTICLES.has(tokens[i - 1])) i--;
  return tokens.slice(Math.max(i, 0)).join(' ');
}

const ROMAN = {i: 1, v: 5, x: 10};
const roman = s => [...s.toLowerCase()].reduce((acc, ch, i, a) => {
  const v = ROMAN[ch], next = ROMAN[a[i + 1]] ?? 0;
  return acc + (v < next ? -v : v);
}, 0);

// Markers that make two similar titles different works: volume numbers, year ranges, adaptations.
export function markers(title) {
  const t = String(title ?? '');
  const vol = /\b(?:vol(?:ume)?|book|part|pt|tome)\.?\s*(\d+|[ivx]{1,5})\b/i.exec(t);
  const years = /\b(1\d{3}|20\d{2})\s*[-–—]\s*(1\d{3}|20\d{2})\b/.exec(t);
  const adapt = [...t.matchAll(/\b(classics illustrated|graphic novel|manga|summary|instaread|study guide|sparknotes|cliffs ?notes|workbook|young readers?)\b/gi)]
    .map(m => fold(m[1]).replace(/ /g, '')).sort();
  return {
    volume: vol ? (/^\d+$/.test(vol[1]) ? Number(vol[1]) : roman(vol[1])) : null,
    years: years ? `${years[1]}-${years[2]}` : null,
    adapt: [...new Set(adapt)].join(',') || null,
  };
}

export const sameMarkers = (a, b) => a.volume === b.volume && a.years === b.years && a.adapt === b.adapt;

// Levenshtein ratio: 1 - distance / max length.
export function similarity(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'at', 'by', 'with', 'from']);

// Token-set Jaccard similarity without stop words.
export function jaccard(a, b) {
  const set = s => new Set(fold(s).split(' ').filter(t => t && !STOP.has(t)));
  const x = set(a), y = set(b);
  if (!x.size && !y.size) return 1;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
