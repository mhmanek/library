// Search: fold the query the same way as the haystack, then AND the tokens as word prefixes,
// so 'lem' finds Stanisław Lem but not 'problem', and 'godel' finds Gödel.
import {fold} from '../../shared/normalize.js';

export const tokens = q => fold(q).split(' ').filter(Boolean);

// Haystacks are folded once at init; the leading space makes every word start match ' ' + token.
export const haystack = (...parts) => ` ${fold(parts.filter(Boolean).join(' '))}`;

export const matches = (hay, toks) => toks.every(t => hay.includes(` ${t}`));
