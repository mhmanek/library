// Pure formatters shared by the build (server-rendered text) and the browser (card, relative times).
// Date-only fields are parsed literally, never through Date, so a UTC runner can't shift them by a day.
// Month names are spelled out by hand because en-GB Intl writes "Sept".
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2025-09-04' or '20250904' -> '4 Sep 2025'
export function formatDay(day) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(day ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

// Negative years are BCE and always approximate for ancient texts.
export function formatYear(y) {
  if (y === null || y === undefined || y === '' || +y === 0 || !Number.isFinite(+y)) return 'Unknown';
  return +y < 0 ? `c. ${-y} BCE` : String(+y);
}

// His rating: 5 -> '5', 4.25 -> '4.25', 4.5 -> '4.5'.
export const formatRating = r => String(Math.round(+r * 100) / 100);
// The world average always carries two decimals.
export const formatAvg = a => (a === null || a === undefined || a === '' ? '' : (+a).toFixed(2));

const NF = new Intl.NumberFormat('en-GB');
export const formatNumber = n => NF.format(n);

// Signed difference with two decimals: +0.79, -0.92.
export const formatDelta = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(2)}`;

export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const min = Math.max(0, Math.round((now - then) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 2) return '1 day ago';
  if (d < 45) return `${d} days ago`;
  const mo = Math.round(d / 30.44);
  if (mo < 12) return `${mo} months ago`;
  const y = Math.round(d / 365.25);
  return y < 2 ? 'a year ago' : `${y} years ago`;
}

// '11 Oct 2026, 09:17 CDT'. en-US supplies the zone abbreviation (en-GB would print 'GMT-5').
export function syncTime(iso, timeZone = 'America/Chicago') {
  const t = new Date(iso);
  if (!Number.isFinite(+t)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'})
    .formatToParts(t).map(p => [p.type, p.value]));
  return `${+parts.day} ${MONTHS[+parts.month - 1]} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

// ['A'] 'A' · ['A','B'] 'A and B' · ['A','B','C'] 'A, B and C'
export const joinNames = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// 777 -> '777 pages'; null -> 'Unknown'
export const formatPages = p => (p ? `${formatNumber(p)} pages` : 'Unknown');
