// The returns slot, loaded lazily: a postcard whose front, laid beside the back, becomes the chosen book's
// cover while the visitor writes. An ARIA 1.2 combobox over Open Library (always ending with the title as
// typed, so any book can be posted), "already on my shelf" from match.json,
// Turnstile on first focus, validation, the POST to the Worker, and a mailto fallback for every failure
// (some school and office networks block *.workers.dev). Without a Worker the card goes out by email.
import {findInIndex} from '../shared/match.js';
import {formatDay} from './lib/format.js';
import {pictureEl, stampEl, PC} from './lib/postcard.js';
import {wallState} from './wall.js';

const OL = 'https://openlibrary.org/search.json';
const MIN_GAP = 1000, DEBOUNCE = 350, TIMEOUT = 3000;
const LIMITS = {title: 200, author: 120, note: 280, name: 40, email: 120};
const MSG = {
  title: 'Which book? Type a title.', long: 'That is a little long.', email: 'That email doesn’t look right (or leave it blank).',
  turnstile: 'The robot check didn’t pass. Try again, or email me instead.',
  rate: 'That’s a lot of recommendations for one day. Thank you! The slot reopens tomorrow.',
  jammed: 'The returns slot is jammed (some school and office networks block it).',
  blocked: 'Heads up: this network seems to block the returns slot. The email button below always works.',
  wait: 'One moment…', ol: 'Suggestions aren’t loading right now. Type the title and author yourself.',
  mailed: 'Your email app should open with the card written out. Nothing opened? Write to the address below.',
};
// Study guides and knock-off summaries crowd out the book itself.
const JUNK = /^(summary|study guide|workbook|companion workbook|sparknotes|cliffsnotes)\b|\b(summary (of|and|&)|analysis of|study guide (for|to)|workbook for)\b/i;
const fold = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// What Open Library is asked for: Solr syntax stripped out, and the word still being typed matched as a
// prefix, so "harry pot" already finds Harry Potter.
export function olQuery(text) {
  const words = String(text).replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  if (!/\s$/.test(text) && last.length >= 2) words[words.length - 1] = `${last}*`;
  return words.join(' ');
}

// Junk dropped, one entry per title and author (the first, or the first with a cover), at most eight.
export function cleanDocs(docs) {
  const out = [], seen = new Map();
  for (const d of docs) {
    if (JUNK.test(d.title)) continue;
    const key = `${fold(d.title)}|${fold(d.author)}`;
    const at = seen.get(key);
    if (at !== undefined) { if (!out[at].coverId && d.coverId) out[at] = d; continue; }
    seen.set(key, out.length);
    out.push(d);
  }
  return out.slice(0, 8);
}

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

export function mailtoFor(email, {title = '', author = '', note = '', name = '', from = ''} = {}) {
  const subject = title ? `Book recommendation: ${title}` : 'Book recommendation';
  const body = title ? `${title}${author ? ` by ${author}` : ''}\n\n${note}${name ? `\n\n— ${name}` : ''}${from ? `\n${from}` : ''}` : '';
  return `mailto:${email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
}

export function badgeFor(hit) {
  if (!hit) return '';
  if (hit.f?.startsWith('1:')) return `Nº ${hit.f.slice(2)}`;
  if (hit.s === 'read') return hit.r ? `Read · ${Math.floor(hit.r)}★` : 'Read';
  return {'to-read': 'Antilibrary', 'did-not-finish': 'DNF', 'currently-reading': 'On my desk'}[hit.s] ?? (hit.f ? 'Favourite' : '');
}
export function shelfMessage(hit) {
  if (!hit) return '';
  if (hit.f?.startsWith('1:')) return `That’s my Nº ${hit.f.slice(2)}!`;
  if (hit.s === 'read') return `Good taste: I’ve read this one${hit.r ? ` (${Math.floor(hit.r)}★)` : ''}. Recommend it anyway, or pick another?`;
  if (hit.s === 'to-read') return 'Already in my antilibrary. Your card bumps it up the pile.';
  if (hit.s === 'did-not-finish') return 'I gave up on this one. Convince me in the note?';
  if (hit.s === 'currently-reading') return 'It’s on my desk right now!';
  return hit.f ? 'One of my favourites already!' : '';
}

let api = null;
export function initRecommend(boot) {
  if (api) return api;
  const form = document.querySelector('[data-rec]');
  if (!form) return (api = {});
  const live = form.dataset.mode === 'post' && Boolean(boot.worker && boot.siteKey);
  const $ = sel => form.querySelector(sel);
  const title = $('#rec-title'), author = $('#rec-author'), note = $('#rec-note'), name = $('#rec-name'), email = $('#rec-email');
  const pic = $('[data-pic]'), cap = $('[data-cap]'), corner = $('[data-stamp]');
  const list = $('#rec-list'), status = $('[data-lb-status]'), onshelf = $('[data-onshelf]');
  const coverBox = $('[data-covers]'), coverRow = coverBox.lastElementChild;
  const submit = $('[data-submit]'), msg = $('[data-msg]'), errsum = $('[data-errsum]');
  const returns = form.closest('.returns'), wrap = form.parentElement, thanks = wrap.querySelector('[data-thanks]');
  const shownAt = performance.now(), submitLabel = submit.firstElementChild.textContent;
  let selection = null, options = [], active = -1, index = null, token = null, widget = null, tsLoading = null;

  // ---- match.json: is it already on one of my shelves?
  const loadIndex = () => (index ??= fetch('data/match.json', {credentials: 'omit'}).then(r => (r.ok ? r.json() : [])).catch(() => []));
  const lookup = async (t, a, olWork) => findInIndex({title: t, author: a, olWork}, await loadIndex());
  async function checkShelf() {
    const hit = title.value.trim() ? await lookup(title.value, author.value, selection?.olWork ?? null) : null;
    const m = shelfMessage(hit);
    onshelf.textContent = m;
    onshelf.hidden = !m;
  }

  // ---- The picture side follows the book: its cover once chosen from Open Library, else a cloth placeholder.
  function drawFront() {
    const t = title.value.trim(), a = author.value.trim(), cover = selection?.coverId ?? null;
    cap.textContent = t ? `${t}${a ? ` · ${a}` : ''}` : PC.front;
    const key = cover ? `c${cover}` : `p${t}\n${a}`;
    if (pic.dataset.key === key) return;
    pic.dataset.key = key;
    pic.replaceChildren(pictureEl({coverId: cover, title: t, author: a, large: true}));
    const old = corner.querySelector('.pc-stamp');
    if ((old.dataset.cover ?? '') !== String(cover ?? '')) { const st = stampEl({coverId: cover}); st.dataset.cover = String(cover ?? ''); old.replaceWith(st); }
  }

  // ---- Open Library client: debounce, ≥1 s between requests, abort stale, 3 s timeout, circuit breaker.
  const cache = new Map();
  let lastReq = 0, failures = 0, pausedUntil = 0, debounce = 0, inflight = null;
  async function search(q) {
    const key = olQuery(q);
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    if (Date.now() < pausedUntil) throw new Error('paused');
    const wait = lastReq + MIN_GAP - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    inflight?.abort();
    const ctrl = inflight = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT);
    lastReq = Date.now();
    try {
      const url = `${OL}?q=${encodeURIComponent(key)}&fields=key,title,author_name,first_publish_year,cover_i,edition_count&limit=20`;
      const res = await fetch(url, {signal: ctrl.signal, credentials: 'omit'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const docs = cleanDocs(((await res.json()).docs ?? []).filter(d => typeof d.title === 'string').map(d => ({
        title: d.title.slice(0, 200), author: (Array.isArray(d.author_name) ? d.author_name[0] : '')?.slice(0, 120) ?? '',
        year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null, coverId: Number.isInteger(d.cover_i) ? d.cover_i : null,
        olWork: /^\/works\/(OL\d+W)$/.exec(d.key ?? '')?.[1] ?? null,
      })));
      failures = 0;
      cache.set(key, docs);
      if (cache.size > 20) cache.delete(cache.keys().next().value);
      return docs;
    } catch (err) {
      if (ctrl.signal.aborted && ctrl.signal.reason?.name !== 'TimeoutError') throw err; // superseded, not a failure
      if (++failures >= 2) { pausedUntil = Date.now() + 60000; failures = 0; }
      throw err;
    } finally { clearTimeout(timer); if (inflight === ctrl) inflight = null; }
  }

  function setExpanded(open) {
    list.hidden = !open;
    title.setAttribute('aria-expanded', String(open));
    if (!open) { active = -1; title.removeAttribute('aria-activedescendant'); }
  }
  function highlight(k) {
    active = k;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === k)));
    const li = list.children[k];
    if (li?.id) { title.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({block: 'nearest'}); }
    else title.removeAttribute('aria-activedescendant');
  }
  // The suggestions, then the title exactly as typed: whatever the book, it is always on the list.
  async function render(docs, typed) {
    const idx = await loadIndex();
    options = [...docs, {own: true, title: typed}];
    list.replaceChildren(...options.map((d, i) => {
      const li = el('li');
      li.id = `rec-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.addEventListener('pointerdown', e => { e.preventDefault(); choose(i); });
      if (d.own) {
        li.className = 'lb-own';
        li.append(el('span', 'nc'));
        const tx = el('span');
        tx.append(el('b', '', `“${typed}”`), docs.length ? 'Not listed? Recommend it as typed' : 'Recommend it as typed');
        li.append(tx, el('span'));
        return li;
      }
      if (d.coverId) {
        const img = new Image(32, 48);
        img.alt = ''; img.loading = 'lazy'; img.src = `https://covers.openlibrary.org/b/id/${d.coverId}-S.jpg`;
        li.append(img);
      } else li.append(el('span', 'nc'));
      const tx = el('span');
      tx.append(el('b', '', d.title), [d.author, d.year].filter(Boolean).join(' · '));
      li.append(tx);
      const badge = badgeFor(findInIndex({title: d.title, author: d.author, olWork: d.olWork}, idx));
      li.append(badge ? el('span', 'bd', badge) : el('span'));
      return li;
    }));
    setExpanded(true);
    status.textContent = docs.length ? `${docs.length} suggestion${docs.length === 1 ? '' : 's'}` : 'No suggestions; you can recommend it as typed';
  }
  function note1(text) {
    list.replaceChildren(el('li', 'lb-note', text));
    setExpanded(true);
    status.textContent = text;
  }
  function choose(i) {
    const d = options[i];
    if (!d) return;
    setExpanded(false);
    if (d.own) { unchoose(); author.focus(); return; }
    title.value = d.title;
    if (d.author) author.value = d.author;
    selection = {...d};
    drawFront();
    checkShelf();
    showCovers(selection);
  }
  function unchoose() { selection = null; coverBox.hidden = true; coverRow.replaceChildren(); drawFront(); }

  // ---- Covers: the chosen book's other covers on Open Library (the work's own, topped up from its editions),
  // so the visitor can pick the edition they mean. At most 12; nothing shows unless there is a choice.
  const coverCache = new Map();
  async function coversFor(olWork) {
    if (coverCache.has(olWork)) return coverCache.get(olWork);
    const get = async url => { const r = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(5000)}); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
    const ids = new Set();
    const add = list => { for (const id of Array.isArray(list) ? list : []) if (Number.isInteger(id) && id > 0) ids.add(id); };
    try {
      add((await get(`https://openlibrary.org/works/${olWork}.json`)).covers);
      if (ids.size < 6) for (const e of (await get(`https://openlibrary.org/works/${olWork}/editions.json?limit=50`)).entries ?? []) add(e.covers);
    } catch { /* whatever arrived is enough */ }
    const out = [...ids];
    coverCache.set(olWork, out);
    return out;
  }
  async function showCovers(sel) {
    coverBox.hidden = true;
    coverRow.replaceChildren();
    if (!sel.olWork) return;
    const all = [...new Set([sel.coverId, ...await coversFor(sel.olWork)].filter(Boolean))].slice(0, 12);
    if (selection !== sel) return;
    if (!sel.coverId && all.length) { sel.coverId = all[0]; drawFront(); }
    if (all.length < 2) return;
    coverRow.replaceChildren(...all.map((id, k) => {
      const label = el('label', 'cv'), radio = el('input');
      radio.type = 'radio'; radio.name = 'cover'; radio.value = String(id); radio.checked = id === sel.coverId;
      radio.setAttribute('aria-label', `Cover ${k + 1} of ${all.length}`);
      radio.addEventListener('change', () => { if (radio.checked && selection === sel) { sel.coverId = id; drawFront(); } });
      const img = new Image(40, 60);
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = `https://covers.openlibrary.org/b/id/${id}-S.jpg`;
      label.append(radio, img);
      return label;
    }));
    coverBox.hidden = false;
  }

  title.addEventListener('input', () => {
    if (selection && title.value !== selection.title) unchoose(); else drawFront();
    clearTimeout(debounce);
    const q = title.value.trim();
    if (q.length < 3) { setExpanded(false); return; }
    debounce = setTimeout(async () => {
      try { const docs = await search(title.value); if (title.value.trim() === q && document.activeElement === title) render(docs, q); }
      catch (err) { if (err?.name !== 'AbortError' && Date.now() < pausedUntil) note1(MSG.ol); }
    }, DEBOUNCE);
  });
  title.addEventListener('keydown', e => {
    const open = !list.hidden && options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open && options.length) setExpanded(true); highlight(Math.min(options.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); setExpanded(false); } else if (title.value) { e.preventDefault(); title.value = ''; unchoose(); } }
    else if (e.key === 'Tab') setExpanded(false);
  });
  title.addEventListener('blur', () => { setTimeout(() => setExpanded(false), 120); checkShelf(); });
  author.addEventListener('change', checkShelf);
  author.addEventListener('input', drawFront);
  const counter = $('[data-count-n]');
  note.addEventListener('input', () => { counter.textContent = String(note.value.length); });

  // ---- Turnstile, injected on the first focus inside the form.
  function loadTurnstile() {
    if (tsLoading) return tsLoading;
    tsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => {
        const slot = $('#rec-ts');
        try {
          widget = window.turnstile.render(slot, {
            sitekey: boot.siteKey, action: 'recommend', appearance: 'interaction-only', theme: 'light',
            size: slot.clientWidth >= 300 ? 'flexible' : 'compact', 'refresh-expired': 'auto',
            callback: t => { token = t; }, 'expired-callback': () => { token = null; }, 'error-callback': () => { token = null; },
          });
          resolve();
        } catch (err) { reject(err); }
      };
      s.onerror = () => reject(new Error('turnstile blocked'));
      document.head.append(s);
    });
    return tsLoading;
  }
  form.addEventListener('focusin', () => { loadIndex(); if (live) loadTurnstile().catch(() => {}); }, {once: true});
  if (live && wallState.reachable === false) showMsg(MSG.blocked, {mail: true});

  async function getToken() {
    if (token) return token;
    showMsg(MSG.wait);
    await loadTurnstile().catch(() => {});
    const until = Date.now() + 15000;
    while (!token && Date.now() < until) await new Promise(r => setTimeout(r, 250));
    return token;
  }

  // ---- Validation and messages.
  const fields = {title, author, note, name, ...(email ? {email} : {})};
  function setError(k, text) {
    const input = fields[k], err = form.querySelector(`#rec-${k}-err`);
    if (!input || !err) return;
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(x => x && x !== err.id);
    if (text) ids.push(err.id);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
    err.textContent = text;
    err.hidden = !text;
  }
  function validate() {
    const errors = {};
    if (!title.value.trim()) errors.title = MSG.title;
    for (const [k, max] of Object.entries(LIMITS)) if ((fields[k]?.value ?? '').length > max) errors[k] = MSG.long;
    if (email?.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) errors.email = MSG.email;
    return errors;
  }
  function showErrors(errors) {
    for (const k of Object.keys(fields)) setError(k, errors[k] ?? '');
    const keys = Object.keys(errors);
    errsum.hidden = !keys.length;
    if (!keys.length) return;
    errsum.textContent = keys.length === 1 ? errors[keys[0]] : `${keys.length} things to fix before this card can go in the slot.`;
    fields[keys[0]].focus();
  }
  function showMsg(text, {mail = false} = {}) {
    msg.replaceChildren(text);
    if (mail) {
      const a = el('a', 'btn btn--ghost btn--sm', 'Email it instead');
      a.href = mailtoFor(boot.email, values());
      msg.append(' ', a);
    }
    msg.hidden = !text;
  }
  const values = () => ({title: title.value.trim(), author: author.value.trim(), note: note.value.trim(), name: name.value.trim(), from: email.value.trim()});
  const busy = on => { submit.setAttribute('aria-disabled', String(on)); submit.firstElementChild.textContent = on ? 'Posting…' : submitLabel; };

  let sending = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;
    const errors = validate();
    showErrors(errors);
    if (Object.keys(errors).length) return;
    if (!live) { location.href = mailtoFor(boot.email, values()); showMsg(MSG.mailed); return; }
    sending = true; busy(true); showMsg('');
    try {
      const t = await getToken();
      if (!t) { showMsg(MSG.turnstile, {mail: true}); return; }
      showMsg('');
      const v = values();
      const body = {
        title: v.title, author: v.author, olWork: selection?.olWork ?? null, coverId: selection?.coverId ?? null, year: selection?.year ?? null,
        note: v.note, name: v.name, email: email?.value.trim() ?? '', website: form.elements.website.value, t: Math.round(performance.now() - shownAt), turnstileToken: t,
      };
      let res, json = {};
      try {
        res = await fetch(`${boot.worker}/recommend`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), credentials: 'omit'});
        json = await res.json().catch(() => ({}));
      } catch { showMsg(MSG.jammed, {mail: true}); return; }
      if (res.ok && json.ok) { received(v.name); return; }
      token = null;
      if (res.status === 400 && Array.isArray(json.fields)) { showErrors(Object.fromEntries(json.fields.filter(k => k in fields).map(k => [k, k === 'title' ? MSG.title : k === 'email' ? MSG.email : MSG.long]))); }
      else if (res.status === 403) { showMsg(MSG.turnstile, {mail: true}); }
      else if (res.status === 429) { showMsg(MSG.rate); }
      else showMsg(MSG.jammed, {mail: true});
      if (widget !== null) window.turnstile?.reset(widget);
    } finally { sending = false; busy(false); }
  });

  // ---- Success: the postmark thumps onto the stamp, the card drops into the slot, the plate glints.
  function received(who) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const d = new Date(), today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    const day = corner.querySelector('time');
    day.textContent = formatDay(today); day.dateTime = today;
    const finish = () => {
      form.hidden = true;
      returns.classList.remove('is-posting');
      returns.classList.add('is-received');
      thanks.querySelector('[data-stamp-text]').textContent = `Received ${formatDay(today)}`;
      thanks.querySelector('[data-thanks-text]').textContent = `Thank you${who ? `, ${who}` : ''}. It’s in the slot. I read every card; the ones I shelve go on the visitor shelf.`;
      thanks.hidden = false;
      thanks.focus();
    };
    if (reduce) { finish(); return; }
    form.classList.add('is-marked');
    setTimeout(() => returns.classList.add('is-posting'), 700);
    setTimeout(finish, 1650);
  }
  thanks.querySelector('[data-again]').addEventListener('click', () => {
    form.reset(); unchoose(); form.classList.remove('is-marked'); onshelf.hidden = true; counter.textContent = '0'; showErrors({}); showMsg('');
    token = null;
    if (widget !== null) window.turnstile?.reset(widget);
    thanks.hidden = true; form.hidden = false; returns.classList.remove('is-received');
    title.focus();
  });

  // This module arrives lazily: catch up on anything the visitor did before it loaded.
  if (form.contains(document.activeElement)) { loadIndex(); if (live) loadTurnstile().catch(() => {}); }
  if (title.value.trim()) checkShelf();
  drawFront();
  counter.textContent = String(note.value.length);

  return (api = {});
}
