// Every user-facing string, in Malhar's voice, so copy edits never touch templates. The postcards' printed
// words (address, stamp, postmark) live in src/js/lib/postcard.js because the browser draws cards too.
// Functions take numbers from the catalog; nothing here is HTML except where a template wraps it in raw().
import {formatNumber as n} from '../js/lib/format.js';

export const COPY = {
  title: "Malhar's Library",
  description: 'My favourite books, my Goodreads and Margins shelves, and a postcard for recommending me a book.',
  ogAlt: (f) => `Malhar's Library: ${n(f.ranked)} favourite books, and a postcard to recommend one`,
  skip: 'Skip to the library',

  links: {label: 'Elsewhere', goodreads: 'Goodreads', margins: 'Margins'},
  favourites: {tab: 'Favourites', display: 'My favourite books', more: 'More favourites on Mr Philomath'},
  visitors: {
    tab: 'Visitor shelf', display: 'Postcards from visitors',
    dek: "Books people have posted through the returns slot, and I've shelved. Turn a card over to read what they wrote. Thank you.",
    empty: 'Your postcard here?', by: 'Recommended by', anon: 'a visitor', more: (k) => `Show all ${n(k)}`, fresh: 'New',
    stamps: {read: (r) => `Read it${r ? ` · ${r}★` : ''}`, 'to-read': 'In my antilibrary', 'currently-reading': 'On my desk', 'did-not-finish': 'Put down', fav: 'A favourite'},
  },
  recommend: {
    tab: 'Recommend', display: 'Recommend me a book',
    dek: 'Pick a book, write a message, and send me your book rec as a postcard :)',
    cardHead: 'Postcard: recommend me a book',
    print: 'Post card', book: 'Book recommendation', cover: 'Cover', author: 'By',
    note: 'Message', notePh: 'Dear Malhar, you have to read this because…', name: 'Signed', namePh: 'your name',
    email: 'Your email', emailHint: 'optional; only so I can reply, never shown',
    submit: 'Post it', submitMail: 'Post it by email', posting: 'Posting…',
    small: 'Spam-checked by Cloudflare Turnstile.', smallMail: 'Opens your email app with the card written out.',
    plate: 'Book return · Postcards',
    prefer: 'Prefer email?',
    postcard: 'The returns slot needs JavaScript, but a postcard by email works just as well:',
    postcardCta: 'Email me a book',
  },
  footer: {
    wall: 'Visitor shelf refreshed every 15 minutes',
  },
  notFound: {
    display: 'Not in the catalogue',
    dek: "This page doesn't exist, or it's been taken off the shelf.",
    back: 'Back to the library',
  },
};
