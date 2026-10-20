// Pure formatters shared by the build (server-rendered text) and the browser (postcards).
// Date-only fields are parsed literally, never through Date, so a UTC runner can't shift them by a day.
// Month names are spelled out by hand because en-GB Intl writes "Sept".
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2025-09-04' or '20250904' -> '4 Sep 2025'
export function formatDay(day) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(day ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

const NF = new Intl.NumberFormat('en-GB');
export const formatNumber = n => NF.format(n);

// ['A'] 'A' · ['A','B'] 'A and B' · ['A','B','C'] 'A, B and C'
export const joinNames = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
