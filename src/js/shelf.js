// The stacks console: search, sort, view and the gilt filter over the server-rendered lists, kept in the
// URL. Also the antilibrary clamp, on-demand covers, live counts, roving focus and the spine reader.
import {comparator} from './lib/sort.js';
import {haystack, tokens, matches} from './lib/search.js';
import {parseState, serializeState} from './lib/url.js';
import {formatNumber as n, formatYear} from './lib/format.js';
import {sortKey, surname} from '../shared/normalize.js';

const CLAMP = {shelf: 72, covers: 24, list: 40};
const text = (el, sel) => el.querySelector(sel)?.textContent ?? '';
const num = s => { const m = /\d[\d,]*(?:\.\d+)?/.exec(s ?? ''); return m ? +m[0].replace(/,/g, '') : null; };

// Colour sort key from the cover's own colour: hue for chromatic covers, neutrals last by lightness.
export function hueOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 500;
  const v = parseInt(m[1], 16), r = (v >> 16) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < 0.08) return 400 + Math.round((max + min) * 50);
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return Math.round((h * 60 + 360) % 360);
}

// Everything the console and the card need, read back from the server-rendered item once at init.
export function readItem(li, i = 0) {
  const a = li.firstElementChild, d = a.dataset;
  const title = text(li, 'cite');
  const au = text(li, '.au').replace(/^\s*by\s+/, '');
  const yText = li.querySelector('.y:not(.u)')?.textContent ?? '';
  const yn = num(yText);
  const img = li.querySelector('.cv');
  const fr = li.style.getPropertyValue('--fr').trim() || null, sp = li.style.getPropertyValue('--sp').trim();
  return {
    li, a, slug: li.id.slice(5), i, title, au, gr: d.gr ?? /\/book\/show\/(\d+)/.exec(a.getAttribute('href') ?? '')?.[1] ?? null,
    r: num(text(li, '.r')) ?? 0, wr: d.wr ? +d.wr : null, p: num(li.querySelector('.p:not(.u)')?.textContent), y: yn === null ? null : /BCE/.test(yText) ? -yn : yn,
    d: d.d ?? '', ra: d.ra ?? '', fav: d.fav ?? '', alt: (d.alt ?? '').split(' ').filter(Boolean),
    stem: img ? /covers\/([0-9a-f]+)-200/.exec(img.getAttribute('src') ?? '')?.[1] ?? null : null, fr, sp,
    t: sortKey(title), s: surname(au.split(/, | and /)[0]), hue: hueOf(fr || sp), gilt: li.classList.contains('g'),
    hay: haystack(title, text(li, '.sub'), text(li, '.ser'), au),
  };
}
const indexList = ol => [...ol.children].map(readItem);

// Antilibrary cover stems and frame colours are not in the HTML (they would cost ~15 KB gzipped);
// they arrive in one small file the first time something needs them.
let stacksJson = null;
export const loadStacks = () => (stacksJson ??= fetch('data/stacks.json', {credentials: 'omit'}).then(r => (r.ok ? r.json() : {})).catch(() => ({})));

export function initShelf({onMiss} = {}) {
  const stacks = document.getElementById('stacks');
  if (!stacks) return null;
  const shelves = [...stacks.querySelectorAll('ol[data-list]')].map(ol => {
    const section = ol.closest('section');
    const aside = section.querySelector('.sec-aside');
    return {ol, name: ol.dataset.list, items: indexList(ol), clamp: +ol.dataset.clamp || 0, expanded: false, section, aside,
      asideText: aside?.textContent ?? '', empty: section.querySelector('[data-empty]'), more: section.querySelector('[data-more]'), reader: section.querySelector('[data-reader]'), visible: []};
  });
  const q = document.getElementById('q'), sortSel = document.querySelector('[data-sort]'), gilt = document.querySelector('[data-gilt]');
  const count = document.querySelector('[data-count]'), miss = document.querySelector('[data-miss]'), hint = document.querySelector('[data-kbhint]');
  const radios = [...stacks.querySelectorAll('input[name=view]')];
  const total = shelves.reduce((k, s) => k + s.items.length, 0);
  const state = parseState(location.search);
  let urlTimer = 0, findTimer = 0, liveTimer = 0;

  const writeUrl = () => history.replaceState(history.state, '', `${location.pathname}${serializeState(state, location.search)}${location.hash}`);

  async function ensureImages(s) {
    if (state.view !== 'covers' || s.items.every(it => it.li.querySelector('.cv') || it.fr)) return;
    const stacks = await loadStacks();
    for (const it of s.visible) {
      if (it.img || it.li.querySelector('.cv')) continue;
      it.img = true;
      const [stem, fr] = stacks[it.slug] ?? [];
      if (fr) { it.fr = fr; it.li.style.setProperty('--fr', fr); }
      if (!stem) continue;
      it.stem = stem;
      const img = new Image(200, 300);
      img.className = 'cv'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.src = `covers/${stem}-200.webp`; img.srcset = `covers/${stem}-400.webp 2x`;
      it.a.querySelector('.sp').after(img);
    }
  }

  function apply({announce = true} = {}) {
    stacks.dataset.view = state.view;
    for (const r of radios) r.checked = r.value === state.view;
    if (sortSel) sortSel.value = state.sort;
    gilt?.setAttribute('aria-pressed', String(state.gilt));
    const toks = tokens(state.q);
    const cmp = comparator(state.sort);
    let shown = 0;
    for (const s of shelves) {
      const sorted = [...s.items].sort(cmp);
      if (sorted.some((it, k) => s.ol.children[k] !== it.li)) s.ol.append(...sorted.map(it => it.li));
      const hits = sorted.filter(it => (!toks.length || matches(it.hay, toks)) && (!state.gilt || s.name !== 'read' || it.gilt));
      const limit = s.clamp && !s.expanded && !toks.length ? CLAMP[state.view] : Infinity;
      const hitSet = new Set(hits.slice(0, limit));
      for (const it of s.items) it.li.hidden = !hitSet.has(it);
      s.visible = hits.slice(0, limit);
      shown += hits.length;
      if (s.more) {
        s.more.hidden = toks.length > 0 || hits.length <= CLAMP[state.view];
        s.more.textContent = s.expanded ? s.more.dataset.labelLess : s.more.dataset.labelMore;
        s.more.setAttribute('aria-expanded', String(s.expanded));
      }
      const filtered = toks.length || (state.gilt && s.name === 'read');
      if (s.aside) s.aside.textContent = filtered ? `${n(hits.length)} of ${n(s.items.length)}` : s.asideText;
      if (s.empty) {
        s.empty.hidden = !(filtered && !hits.length);
        s.empty.textContent = toks.length ? `Nothing on this shelf matches “${state.q.trim()}”.` : 'Nothing gilt here yet.';
      }
      ensureImages(s);
      resetRoving(s);
    }
    if (miss) {
      miss.hidden = !(toks.length && !shown);
      if (!miss.hidden) {
        const link = miss.querySelector('a');
        link.textContent = `Not in the catalogue. Recommend “${state.q.trim()}” to me →`;
        link.onclick = () => onMiss?.(state.q.trim());
      }
    }
    if (count && announce) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        count.textContent = toks.length || state.gilt ? `${n(shown)} of ${n(total)} books` : `${n(total)} books`;
      }, 300);
    }
  }

  // One Tab stop per shelf; arrow keys move between books (WAI-ARIA roving tabindex).
  function resetRoving(s) {
    const current = s.items.find(it => it.a.tabIndex === 0 && !it.li.hidden);
    for (const it of s.items) it.a.tabIndex = -1;
    const first = current ?? s.visible[0];
    if (first) first.a.tabIndex = 0;
  }

  function move(s, from, key) {
    const vis = s.visible, k = vis.indexOf(from);
    if (k < 0) return null;
    const flat = state.view === 'list';
    if (key === 'ArrowRight' || (flat && key === 'ArrowDown')) return vis[k + 1];
    if (key === 'ArrowLeft' || (flat && key === 'ArrowUp')) return vis[k - 1];
    if (key === 'Home') return vis[0];
    if (key === 'End') return vis.at(-1);
    if (key === 'PageDown') return vis[Math.min(vis.length - 1, k + 10)];
    if (key === 'PageUp') return vis[Math.max(0, k - 10)];
    // Up/down: the geometrically nearest book in the row above or below.
    const r = from.li.getBoundingClientRect(), cx = r.left + r.width / 2, down = key === 'ArrowDown';
    let best = null, bestScore = Infinity;
    for (const it of vis) {
      const b = it.li.getBoundingClientRect();
      const dy = down ? b.top - r.bottom : r.top - b.bottom;
      if (dy < -2) continue;
      const score = dy * 4 + Math.abs(b.left + b.width / 2 - cx);
      if (score < bestScore) { best = it; bestScore = score; }
    }
    return best;
  }

  for (const s of shelves) {
    s.ol.addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
      const from = s.items.find(it => it.a === document.activeElement);
      const to = from && move(s, from, e.key);
      if (!to) return;
      e.preventDefault();
      from.a.tabIndex = -1; to.a.tabIndex = 0; to.a.focus();
    });
    s.ol.addEventListener('focusin', e => {
      const it = s.items.find(x => x.a === e.target);
      if (!it) return;
      for (const x of s.items) if (x.a.tabIndex === 0 && x !== it) x.a.tabIndex = -1;
      it.a.tabIndex = 0;
      if (hint) hint.hidden = !e.target.matches(':focus-visible');
      read(s, it);
    });
    s.ol.addEventListener('focusout', () => { if (hint) hint.hidden = true; });
    s.ol.addEventListener('pointerover', e => {
      const li = e.target.closest?.('.bk');
      const it = li && s.items.find(x => x.li === li);
      if (it) read(s, it);
    });
    s.more?.addEventListener('click', () => {
      s.expanded = !s.expanded;
      apply();
      if (!s.expanded) s.section.scrollIntoView({block: 'start'});
    });
  }

  // The spine reader shows the hovered or focused spine's details (a duplicate of its accessible name).
  function read(s, it) {
    if (!s.reader || state.view !== 'shelf') return;
    const bits = [`${it.title} — ${it.au}`, it.p ? `${n(it.p)} pp` : '', it.y ? formatYear(it.y) : ''].filter(Boolean);
    s.reader.textContent = bits.join(' · ');
  }

  for (const r of radios) r.addEventListener('change', () => { if (r.checked) { state.view = r.value; apply(); writeUrl(); } });
  sortSel?.addEventListener('change', () => { state.sort = sortSel.value; apply(); writeUrl(); });
  gilt?.addEventListener('click', () => { state.gilt = !state.gilt; apply(); writeUrl(); });
  document.querySelector('[data-find]')?.addEventListener('submit', e => { e.preventDefault(); q.blur(); });
  if (q) {
    q.value = state.q;
    q.addEventListener('input', () => {
      state.q = q.value;
      clearTimeout(findTimer); clearTimeout(urlTimer);
      findTimer = setTimeout(apply, 120);
      urlTimer = setTimeout(writeUrl, 400);
    });
    q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; state.q = ''; apply(); writeUrl(); } });
    addEventListener('keydown', e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      q.focus();
    });
  }
  apply({announce: false});

  const find = slug => {
    for (const s of shelves) {
      const id = slug.replace(/^gr-/, '');
      const it = s.items.find(x => x.slug === slug || x.gr === id || x.alt.includes(id));
      if (it) return {s, it};
    }
    return null;
  };
  return {
    find,
    // Makes a deep-linked book reachable: lift the clamp, clear a filter hiding it.
    reveal(slug) {
      const hit = find(slug);
      if (!hit) return null;
      if (hit.it.li.hidden) {
        if (hit.s.clamp) hit.s.expanded = true;
        if (state.q || state.gilt) { state.q = ''; state.gilt = false; if (q) q.value = ''; writeUrl(); }
        apply();
      }
      return hit.it.li;
    },
    order: name => (shelves.find(s => s.name === name)?.visible ?? []).map(it => it.slug),
    view: () => state.view,
  };
}
