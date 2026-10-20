// The library card: a native modal <dialog> filled from the favourites' records (#favs), the plate's note
// and the review <template>. History-backed at #book/<slug>, so Back closes it and links can be shared.
import {parseHash, bookHash} from './lib/url.js';
import {formatDay, formatYear, formatRating, formatAvg, formatNumber as n, formatDelta} from './lib/format.js';

const SHELF_LABEL = {read: 'Read', 'to-read': 'Antilibrary', 'did-not-finish': 'Did not finish', 'currently-reading': 'Reading now'};
const DEFAULTS = {s: null, sub: '', r: 0, wr: null, p: null, y: null, d: '', ra: '', fav: '', alt: [], c: null, gr: null, ser: ''};
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const text = (root, sel) => root?.querySelector(sel)?.textContent ?? '';

// The build leaves empty fields out of each record; this puts the defaults back.
export function readRecords(json) {
  try { return JSON.parse(json || '[]').map(r => ({...DEFAULTS, ...r})); } catch { return []; }
}

export function initCard({boot, toast}) {
  const dlg = document.getElementById('card');
  if (!dlg) return null;
  const f = name => dlg.querySelector(`[data-f="${name}"]`);
  const prevBtn = dlg.querySelector('[data-prev]'), nextBtn = dlg.querySelector('[data-next]');
  const recs = readRecords(document.getElementById('favs')?.textContent);
  const bySlug = new Map(recs.map(r => [r.i, r])), order = recs.map(r => r.i);
  let current = null, pushed = false, opener = null;

  // Resolves a slug (or gr-<id> / merged id alias) to its record.
  function lookup(slug) {
    const id = slug.replace(/^gr-/, '');
    return bySlug.get(slug) ?? recs.find(r => r.gr === id || r.alt.includes(id)) ?? null;
  }
  // The plate or "And more" entry that carries the note; the second book of a paired entry is found by its link.
  const plateFor = slug => document.getElementById(`fav-${slug}`) ?? document.querySelector(`#favourites [data-open="${slug}"]`)?.closest('[data-book]') ?? null;

  function dumbbell(me, world, shelfName) {
    const box = f('vs');
    box.replaceChildren();
    const x = v => `${((v - 1) / 4) * 100}%`;
    const plot = el('div', 'vs-plot');
    plot.setAttribute('aria-hidden', 'true');
    plot.append(el('span', 'vs-ax'));
    for (const t of [1, 2, 3, 4, 5]) { const tk = el('span', 'vs-tk'); tk.style.left = x(t); plot.append(tk); }
    // Axis ends are labelled beside the line, so the two direct labels never collide with them.
    for (const t of [1, 5]) { const tl = el('span', 'vs-tl', String(t)); tl.style.left = x(t); tl.style.translate = t === 1 ? 'calc(-100% - 12px) 0' : '12px 0'; plot.append(tl); }
    const rated = me > 0, known = world !== null;
    if (rated && known) { const cn = el('span', 'vs-cn'); cn.style.left = x(Math.min(me, world)); cn.style.width = `${(Math.abs(me - world) / 4) * 100}%`; plot.append(cn); }
    const lbls = [];
    if (known) { const d = el('span', 'vs-dot vs-wd'); d.style.left = x(world); plot.append(d); lbls.push([world, `Goodreads ${formatAvg(world)}`]); }
    if (rated) { const d = el('span', 'vs-dot vs-me'); d.style.left = x(me); plot.append(d); lbls.push([me, `Me ${formatRating(me)}`]); }
    // Me above the axis, Goodreads below: the labels can't collide, and they are clamped at the ends.
    for (const [v, s] of lbls) {
      const lb = el('span', s.startsWith('Me') ? 'vs-lb' : 'vs-lb lo', s);
      lb.style.left = x(v);
      lb.style.translate = v <= 1.5 ? '-6px 0' : v >= 4.5 ? 'calc(-100% + 6px) 0' : '-50% 0';
      plot.append(lb);
    }
    let sentence;
    if (rated && known) {
      const d = me - world;
      sentence = `My rating ${formatRating(me)} · Goodreads average ${formatAvg(world)} · ${formatDelta(d)} ${d >= 0 ? 'kinder' : 'harsher'} than the crowd`;
    } else if (rated) sentence = `My rating ${formatRating(me)}`;
    else if (known) sentence = `${shelfName === 'did-not-finish' ? 'Did not finish' : shelfName === 'currently-reading' ? 'Reading it now' : 'Not read yet'} · Goodreads average ${formatAvg(world)}`;
    if (!sentence) { box.hidden = true; return; }
    box.hidden = false;
    if (known || rated) box.append(plot);
    box.append(el('p', 'vs-txt', sentence));
  }

  function fillCover(rec, plate) {
    const cover = f('cover');
    cover.replaceChildren();
    dlg.style.setProperty('--fr', rec.fr || rec.sp);
    if (rec.c) {
      const img = new Image(400, 600);
      img.alt = ''; img.decoding = 'async';
      const known = plate?.querySelector('img') ?? null;
      if (known?.naturalWidth) img.height = Math.round(400 * known.naturalHeight / known.naturalWidth);
      img.src = `covers/${rec.c}-400.webp`;
      cover.append(img);
    } else {
      const t = el('span', 'tcover');
      t.style.setProperty('--sp', rec.sp);
      t.append(el('b', '', rec.t), el('i', '', rec.au));
      cover.append(t);
    }
  }

  function populate(rec) {
    const slug = rec.i, plate = plateFor(slug), shelfName = rec.s, fav = rec.fav;
    const score = text(plate, '.score b');
    const eyebrow = [shelfName ? SHELF_LABEL[shelfName] : 'Favourite'];
    if (fav.startsWith('1:')) eyebrow.push(`Favourite Nº ${fav.slice(2)}`); else if (fav && shelfName) eyebrow.push('Favourite');
    if (score) eyebrow.push(score);
    if (!shelfName) eyebrow.push('Not on my Goodreads');
    f('eyebrow').textContent = eyebrow.join(' · ');
    f('title').textContent = rec.t;
    f('subtitle').textContent = rec.sub;
    f('authors').textContent = rec.au;
    fillCover(rec, plate);

    dumbbell(rec.r, rec.wr, shelfName);

    const facts = f('facts');
    facts.replaceChildren();
    const fact = (k, v, muted = false) => { facts.append(el('dt', '', k)); facts.append(el('dd', muted ? 'nr' : '', v)); };
    fact('Pages', rec.p ? n(rec.p) : 'Unknown', !rec.p);
    fact('First published', formatYear(rec.y), !rec.y);
    if (shelfName === 'read') fact('Finished', rec.ra ? formatDay(rec.ra) : 'Not recorded', !rec.ra);
    if (rec.d) fact(shelfName === 'to-read' ? 'In the antilibrary since' : 'On Goodreads since', formatDay(rec.d));
    if (rec.ser) fact('Series', rec.ser);
    if (rec.alt.length) fact('Editions', rec.alt.length === 1 ? 'Shelved twice (two editions)' : `Shelved ${rec.alt.length + 1} times (${rec.alt.length + 1} editions)`);

    const note = f('note');
    note.replaceChildren();
    const noteSrc = plate?.querySelector('.note');
    if (noteSrc) {
      note.append(...[...noteSrc.childNodes].map(x => x.cloneNode(true)));
      const from = el('p', 'from', '— from ');
      const a = el('a', '', 'My Favourite Books on Mr Philomath');
      a.href = boot.postUrl;
      from.append(a);
      note.append(from);
    }
    const review = f('review');
    review.replaceChildren();
    const tpl = document.getElementById(`rev-${slug}`);
    if (tpl) { review.append(tpl.content.cloneNode(true)); review.append(el('p', 'from', '— my Goodreads review')); }

    const gr = f('gr');
    gr.hidden = !rec.gr;
    if (rec.gr) gr.href = `https://www.goodreads.com/book/show/${rec.gr}`;
    const k = order.indexOf(slug);
    f('pos').textContent = k >= 0 ? `${String(k + 1).padStart(2, '0')} / ${String(order.length).padStart(2, '0')}` : '';
    const label = (btn, j, word) => {
      const t = bySlug.get(order[j]);
      btn.disabled = !t;
      btn.setAttribute('aria-label', t ? `${word} book: ${t.t}` : `${word} book`);
    };
    label(prevBtn, k - 1, 'Previous');
    label(nextBtn, k + 1, 'Next');
  }

  function open(slug, {from = null, push = true} = {}) {
    const rec = lookup(slug);
    if (!rec) { toast?.('That book has left the shelf.'); if (parseHash(location.hash)) history.replaceState(history.state, '', location.pathname + location.search); return false; }
    if (from) opener = from;
    current = rec.i;
    populate(rec);
    if (push && location.hash !== bookHash(rec.i)) { history.pushState({card: rec.i}, '', bookHash(rec.i)); pushed = true; }
    else if (!push && location.hash !== bookHash(rec.i)) history.replaceState(history.state, '', bookHash(rec.i));
    if (!dlg.open) {
      restoreOffset();
      dlg.showModal();
      document.documentElement.classList.add('card-open');
    }
    dlg.querySelector('.card-body').scrollTop = 0;
    f('title').focus({preventScroll: true});
    return true;
  }

  function close() {
    if (!dlg.open) return;
    if (pushed && parseHash(location.hash)) { pushed = false; history.back(); return; }
    if (parseHash(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
    dlg.close();
  }

  function step(delta) {
    // Prev/next replace the entry, so a single Back still closes the card.
    const rec = bySlug.get(order[order.indexOf(current) + delta]);
    if (!rec) return;
    current = rec.i;
    populate(rec);
    history.replaceState(history.state, '', bookHash(rec.i));
    if (!opener?.isConnected) opener = plateFor(rec.i)?.querySelector('a[data-open]') ?? null;
  }

  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('card-open');
    const back = opener?.isConnected ? opener : null;
    current = null; opener = null;
    back?.focus();
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-close]').addEventListener('click', close);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  dlg.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  dlg.querySelector('[data-copy]').addEventListener('click', async () => {
    const url = `${boot.siteUrl}/${bookHash(current)}`;
    try { await navigator.clipboard.writeText(url); toast?.('Link copied'); }
    catch { toast?.(url); }
  });
  addEventListener('popstate', () => {
    const slug = parseHash(location.hash);
    if (slug && slug !== current) open(slug, {push: false});
    else if (!slug && dlg.open) { pushed = false; dlg.close(); }
  });

  // Desktop: drag the window by its title bar. Mobile: swipe the sheet down to close.
  const windowed = matchMedia('(min-width: 900px) and (pointer: fine)');
  const bar = dlg.querySelector('[data-drag]');
  let drag = null;
  function restoreOffset() {
    let o = {x: 0, y: 0};
    try { o = JSON.parse(sessionStorage.getItem('ml:card') ?? '{"x":0,"y":0}'); } catch { /* ignore */ }
    setOffset(windowed.matches ? o : {x: 0, y: 0});
  }
  function setOffset({x, y}) {
    const r = dlg.getBoundingClientRect();
    const maxX = (innerWidth + (r.width || 600)) / 2 - 64, maxY = (innerHeight + (r.height || 400)) / 2 - 42;
    x = Math.max(-maxX, Math.min(maxX, x)); y = Math.max(-maxY, Math.min(maxY, y));
    dlg.style.setProperty('--dx', `${x}px`); dlg.style.setProperty('--dy', `${y}px`);
    return {x, y};
  }
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const style = getComputedStyle(dlg);
    drag = {x0: e.clientX, y0: e.clientY, dx: parseFloat(style.getPropertyValue('--dx')) || 0, dy: parseFloat(style.getPropertyValue('--dy')) || 0, t0: performance.now(), sheet: !windowed.matches};
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.sheet) dlg.style.setProperty('--sy', `${Math.max(0, e.clientY - drag.y0)}px`);
    else drag.last = setOffset({x: drag.dx + e.clientX - drag.x0, y: drag.dy + e.clientY - drag.y0});
  });
  const endDrag = e => {
    if (!drag) return;
    const dy = e.clientY - drag.y0, v = dy / Math.max(1, performance.now() - drag.t0);
    if (drag.sheet) { dlg.style.removeProperty('--sy'); if (dy > 96 || v > 0.5) close(); }
    else if (drag.last) { try { sessionStorage.setItem('ml:card', JSON.stringify(drag.last)); } catch { /* ignore */ } }
    drag = null;
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('dblclick', () => { setOffset({x: 0, y: 0}); try { sessionStorage.removeItem('ml:card'); } catch { /* ignore */ } });

  // Links, not buttons: without JS they go to Goodreads; with JS a plain click opens the card, and the
  // first hover or focus rewrites href so new-tab and copy-link give the site's own deep link.
  const prime = e => {
    const a = e.target.closest?.('a[data-open]');
    if (!a || a.dataset.primed) return;
    a.dataset.primed = '1';
    const gr = /\/book\/show\/(\d+)/.exec(a.getAttribute('href') ?? '')?.[1];
    if (gr) a.dataset.gr = gr;
    a.href = bookHash(a.dataset.open);
    a.setAttribute('aria-haspopup', 'dialog');
  };
  document.addEventListener('pointerover', prime);
  document.addEventListener('focusin', prime);
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[data-open], a[href^="#book/"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.closest('dialog')) return;
    const slug = a.dataset.open ?? parseHash(a.getAttribute('href'));
    if (!slug) return;
    e.preventDefault();
    open(slug, {from: a});
  });

  const initial = parseHash(location.hash);
  if (initial) open(initial, {push: false});
  return {open, close};
}
