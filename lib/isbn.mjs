// ISBN helpers. Goodreads RSS only carries an ISBN-10 (and 14% of books have none), so the ISBN-13 used for
// merging and Open Library lookups is derived here. Invalid checksums become null: never guess.

export const cleanIsbn = s => String(s ?? '').toUpperCase().replace(/[^0-9X]/g, '');

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

const ean = digits12 => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
};

export const isValidIsbn13 = s => /^97[89]\d{10}$/.test(s) && ean(s.slice(0, 12)) === s[12];

export function isbn10to13(s) {
  s = cleanIsbn(s);
  if (!isValidIsbn10(s)) return null;
  const body = '978' + s.slice(0, 9);
  return body + ean(body);
}

export function isbn13to10(s) {
  s = cleanIsbn(s);
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null; // 979 has no ISBN-10 form
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

// {isbn10, isbn13} from whatever the feed gave (10 or 13 digits, hyphens allowed).
export function isbnPair(raw) {
  const s = cleanIsbn(raw);
  if (s.length === 10) return isValidIsbn10(s) ? {isbn10: s, isbn13: isbn10to13(s)} : {isbn10: null, isbn13: null};
  if (s.length === 13) return isValidIsbn13(s) ? {isbn10: isbn13to10(s), isbn13: s} : {isbn10: null, isbn13: null};
  return {isbn10: null, isbn13: null};
}
