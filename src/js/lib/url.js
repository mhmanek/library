// #book/<slug> deep links for the library card.
// '#book/anathem-stephenson' -> 'anathem-stephenson'; also '#book/gr-2845024'. Anything else -> null.
export function parseHash(hash = '') {
  const m = /^#book\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(decodeURIComponent(hash));
  return m ? m[1] : null;
}

export const bookHash = slug => `#book/${slug}`;
