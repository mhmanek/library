// Every user-facing string, in Malhar's voice, so copy edits never touch templates. The postcards' printed
// words (address, stamp, postmark) live in src/js/lib/postcard.js because the browser draws cards too.
// Functions take numbers from the catalog; nothing here is HTML except where a template wraps it in raw().
import {formatNumber as n} from '../js/lib/format.js';

const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export const word = k => words[k] ?? n(k);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const COPY = {
  title: "Malhar's Library",
  description: (f) => `My ${word(f.ranked)} favourite books, ranked, and ${n(f.more)} more I'd recommend, with what I wrote about each on Mr Philomath. Post me a book I should read next.`,
  ogAlt: (f) => `Malhar's Library: ${n(f.ranked)} favourite books, and a postcard to recommend one`,
  skip: 'Skip to the library',
  nav: [['favourites', 'favourites'], ['visitors', 'visitors'], ['recommend', 'recommend']],

  favourites: {
    tab: 'Favourites', display: 'Turned up to eleven',
    dek: (elevens) => `Ranked, roughly, with what I wrote about each on Mr Philomath.${elevens ? ` ${cap(word(elevens))} of them go to eleven.` : ''}`,
    more: (k) => `And ${word(k)} more I'd recommend`,
    source: 'From My Favourite Books on Mr Philomath',
    eleven: 'goes to eleven',
    notOnGoodreads: 'Not on my Goodreads shelf',
    margins: 'My shelf on Margins, the app I read in. The card redraws itself; Margins can’t sync here, so Goodreads does the bookkeeping.',
    marginsAlt: "My Margins profile card: a sketch of me with the books I'm reading and my favourites",
  },
  visitors: {
    tab: 'Visitor shelf', display: 'Postcards from visitors',
    dek: "Books people have posted through the returns slot, and I've shelved. Turn a card over to read what they wrote. Thank you.",
    empty: 'Your postcard here?', by: 'Recommended by', anon: 'a visitor', more: (k) => `Show all ${n(k)}`, fresh: 'New',
    stamps: {read: (r) => `Read it${r ? ` · ${r}★` : ''}`, 'to-read': 'In my antilibrary', 'currently-reading': 'On my desk', 'did-not-finish': 'Put down', fav: 'A favourite'},
  },
  recommend: {
    tab: 'Recommend', display: 'Post me a book',
    dek: 'Pick a book for the front, write on the back, and drop it in the slot. I read every card; the ones I shelve go on the visitor shelf.',
    cardHead: 'Postcard: recommend me a book',
    print: 'Post card', book: 'On the front', bookHint: 'Start typing; the cover comes from Open Library', author: 'By',
    note: 'Message', notePh: 'Dear Malhar, you have to read this because…', name: 'Signed', namePh: 'a visitor',
    nameHint: 'shown on the visitor shelf if I shelve it', email: 'Reply to (private)', emailHint: 'only so I can reply; never shown',
    turn: 'See the front', unturn: 'Back to writing',
    submit: 'Post it', submitMail: 'Post it by email', posting: 'Posting…',
    small: 'Spam-checked by Cloudflare Turnstile.', smallMail: 'Opens your email app with the card written out.',
    plate: 'Book return · Postcards',
    prefer: 'Prefer email?',
    postcard: 'The returns slot needs JavaScript, but a postcard by email works just as well:',
    postcardCta: 'Email me a book',
  },
  footer: {
    synced: (when) => `Goodreads data last changed ${when} · checked once a day`,
    failing: (since) => `Goodreads hasn't answered since ${since}; showing the last good copy`,
    favourites: (when) => `Favourites from My Favourite Books (Mr Philomath${when ? `, updated ${when}` : ''})`,
    favouritesFailing: ' · from a saved copy',
    wall: 'Visitor shelf refreshed every 15 minutes',
    covers: 'Covers belong to their publishers and designers, shown small via Goodreads, Open Library and Substack to identify each book. Want one removed?',
    stack: 'Plain Node, no framework',
    source: 'Source on GitHub',
    type: 'Type: Antonio, Intel One Mono, Crimson Pro, Nothing You Could Do (SIL OFL)',
    loop: 'This library contains a book about itself.',
  },
  card: {label: 'Malhar’s Library', close: 'Close card', prev: 'Previous book', next: 'Next book', copy: 'Copy link', copied: 'Link copied', gone: 'That book has left the shelf.', hint: '← → browse · Esc close'},
  notFound: {
    display: 'Not in the catalogue',
    dek: "This page doesn't exist, or it's been taken off the shelf.",
    back: 'Back to the library',
  },
  plural,
};
