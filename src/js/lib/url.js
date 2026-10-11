// URL state: ?view= ?sort= ?q= ?gilt=1 and #book/<slug>. Defaults are omitted so shared links stay short.
export const VIEWS = ['shelf', 'covers', 'list'];
export const SORTS = ['', 'mine', 'world', 'love', 'title', 'author', 'long', 'old', 'added', 'colour'];
export const DEFAULT_STATE = Object.freeze({view: 'shelf', sort: '', q: '', gilt: false});

export function parseState(search = '') {
  const p = new URLSearchParams(search);
  const view = p.get('view'), sort = p.get('sort');
  return {
    view: VIEWS.includes(view) ? view : 'shelf',
    sort: SORTS.includes(sort) ? sort : '',
    q: (p.get('q') ?? '').slice(0, 120),
    gilt: p.get('gilt') === '1',
  };
}

// Keeps unrelated parameters (utm tags, ?theme= for screenshots) untouched.
export function serializeState(state, search = '') {
  const p = new URLSearchParams(search);
  const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
  set('view', state.view !== 'shelf' ? state.view : '');
  set('sort', state.sort);
  set('q', state.q?.trim() ?? '');
  set('gilt', state.gilt ? '1' : '');
  const s = p.toString();
  return s ? `?${s}` : '';
}

// '#book/anathem-stephenson' -> 'anathem-stephenson'; also '#book/gr-2845024'. Anything else -> null.
export function parseHash(hash = '') {
  const m = /^#book\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(decodeURIComponent(hash));
  return m ? m[1] : null;
}

export const bookHash = slug => `#book/${slug}`;
