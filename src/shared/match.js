// "Is this the same work?" — the calibrated rule from his own data (11 Oct 2026): ISBN-13 or Open Library
// work equality first; otherwise short-title similarity ≥ 0.90 AND a shared author surname AND equal
// volume/year/adaptation markers AND equal series. Fuzzy matching alone wrongly merges The Outsiders
// (Thorndike vs Hinton), the two Elon Musk biographies, Skidelsky's Keynes volumes and Knit India I–IV.
import {fold, shortTitle, surnames, markers, sameMarkers, similarity, jaccard} from './normalize.js';

export const TITLE_THRESHOLD = 0.9;

const overlap = (a, b) => a.some(x => b.includes(x));

// a, b: {title, subtitle?, authors: [], isbn13?, olWork?, series?: {name, index}}
export function sameWork(a, b) {
  if (a.isbn13 && b.isbn13 && a.isbn13 === b.isbn13) return true;
  const sa = surnames(a.authors), sb = surnames(b.authors);
  if (!overlap(sa, sb)) return false;
  const ma = markers(fullTitle(a)), mb = markers(fullTitle(b));
  if (!sameMarkers(ma, mb)) return false;
  if (a.olWork && b.olWork && a.olWork === b.olWork) return true;
  if (!sameSeries(a.series, b.series)) return false;
  if (subtitleConflict(a.subtitle, b.subtitle)) return false;
  return similarity(shortTitle(a.title), shortTitle(b.title)) >= TITLE_THRESHOLD;
}

const fullTitle = x => [x.title, x.subtitle].filter(Boolean).join(': ');

function sameSeries(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return true; // one edition may simply omit the series suffix
  return fold(a.name) === fold(b.name) && String(a.index ?? '') === String(b.index ?? '');
}

function subtitleConflict(a, b) {
  if (!a || !b) return false;
  const fa = fold(a), fb = fold(b);
  if (fa.includes(fb) || fb.includes(fa)) return false;
  return jaccard(a, b) < 0.2;
}

// Browser-side lookup against site/data/match.json entries {i, s, r, f, ol, t, a}
// (slug, shelf, rating, favourite 'tier:rank', olWork, short title, surnames).
// candidate: {title, author, olWork}. Returns the entry or null.
export function findInIndex(candidate, index) {
  if (candidate.olWork) {
    const hit = index.find(e => e.ol && e.ol === candidate.olWork);
    if (hit) return hit;
  }
  const t = shortTitle(candidate.title);
  const sn = surnames([candidate.author].filter(Boolean));
  if (!t) return null;
  let best = null, bestScore = 0;
  for (const e of index) {
    if (sn.length && !overlap(sn, e.a)) continue;
    const score = similarity(t, e.t);
    if (score >= TITLE_THRESHOLD && score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}
