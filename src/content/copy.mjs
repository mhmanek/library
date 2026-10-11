// Every user-facing string, in Malhar's voice, so copy edits never touch templates.
// Functions take numbers from the catalog; nothing here is HTML except where a template wraps it in raw().
import {formatNumber as n} from '../js/lib/format.js';

const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export const word = k => words[k] ?? n(k);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const COPY = {
  title: "Malhar's Library",
  description: (c) => `Every book I've finished (${n(c.read)}), my favourites in my own words, and ${n(c.toRead)} I haven't got to yet. Kept up to date from Goodreads.`,
  skip: 'Skip to the library',
  prompt: '$ cd ~/library',
  intro: (c) => `Every book I've finished, the ${word(c.ranked)} I'd press into your hands first, and the ${word(c.toRead)} I haven't got to yet. `
    + 'The notes are from my Substack, Mr Philomath; the shelves keep themselves up to date from Goodreads.',
  nav: [['favourites', 'favourites'], ['read', 'read'], ['antilibrary', 'antilibrary'], ['visitors', 'visitors'], ['recommend', 'recommend']],

  now: {tab: 'Reading now', display: 'On the desk', dek: 'What I have open at the moment.'},
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
  read: {
    tab: 'Read', display: "Everything I've finished",
    dek: (count, rated, dated) => `${rated === count ? `All ${n(count)} rated` : `${n(count)} books, ${n(rated)} rated`}, ${dated ? `${word(dated)} of them dated` : 'none of them dated'}: Goodreads only knows when I finished ${word(dated)}, so I won't pretend otherwise. Gilt spines are five stars; numbered ones are my top twenty; thicker books are longer.`,
    gilt: 'Gilt only',
    giltHint: '5★ & favourites',
  },
  anti: {
    tab: 'Antilibrary', display: 'The antilibrary',
    dek: 'Umberto Eco kept 30,000 books, most of them unread; Nassim Taleb called that an antilibrary. The unread ones are the point. Mine grows most weeks.',
    more: (k) => `Walk the stacks: show all ${n(k)}`,
    less: 'Fewer, please',
  },
  dnf: {tab: 'Did not finish', display: 'Did not finish', dek: 'Put down without guilt. Life is short and the antilibrary is long.'},
  visitors: {
    tab: 'Visitor shelf', display: 'Left by visitors',
    dek: "Books people have slipped into the returns slot, and I've shelved. Thank you.",
    empty: 'Your book here?', by: 'Recommended by', anon: 'a visitor', more: (k) => `Show all ${n(k)}`, fresh: 'New',
    stamps: {read: (r) => `Read it${r ? ` · ${r}★` : ''}`, 'to-read': 'In my antilibrary', 'currently-reading': 'On my desk', 'did-not-finish': 'Put down', fav: 'A favourite'},
  },
  recommend: {
    tab: 'Recommend', display: 'Leave a book in the returns slot',
    dek: 'Tell me what I should read next. I read every card; the ones I shelve go on the visitor shelf.',
    cardHead: 'Recommendation card · Nº —',
    book: 'Book', bookHint: 'Start typing; I’ll look it up on Open Library', author: 'Author', note: 'Why I should read it', name: 'Signed',
    nameHint: 'shown on the visitor shelf if I shelve it', email: 'Email (private)', emailHint: 'only so I can reply; never shown',
    submit: 'Drop it in the slot', posting: 'Posting…', small: 'Spam-checked by Cloudflare Turnstile.',
    plate: 'Book return · Recommendations',
    prefer: 'Prefer email?',
    postcard: 'The returns slot opens soon. Until then, a postcard works just as well:',
    postcardCta: 'Email me a book',
  },
  footer: {
    synced: (when) => `Shelves last changed ${when} · checked every 6 hours`,
    failing: (since) => `Goodreads hasn't answered since ${since}; showing the last good copy`,
    favourites: (when) => `Favourites from My Favourite Books (Mr Philomath${when ? `, updated ${when}` : ''})`,
    favouritesFailing: ' · from a saved copy',
    wall: 'Visitor shelf refreshed every 15 minutes',
    covers: 'Covers belong to their publishers and designers, shown small via Goodreads, Open Library and Substack to identify each book. Want one removed?',
    stack: 'Plain Node, no framework',
    source: 'Source on GitHub',
    type: 'Type: Antonio, Intel One Mono, Crimson Pro (SIL OFL)',
    loop: 'This library contains a book about itself.',
    reset: 'Follow my system theme',
  },
  card: {close: 'Close card', prev: 'Previous book', next: 'Next book', copy: 'Copy link', copied: 'Link copied', gone: 'That book has left the shelf.', hint: '← → browse · Esc close'},
  empty: (q) => `Nothing on this shelf matches “${q}”.`,
  miss: (q) => `Not in the catalogue. Recommend “${q}” to me`,
  hint: '← → to browse · Enter to open',
  notFound: {
    display: 'Not in the catalogue',
    dek: "This page doesn't exist, or it's still in the antilibrary.",
    back: 'Back to the library', search: (q) => `Search for “${q}”`,
  },
  plural,
};
