// Visitor shelf at runtime: fetch the live list from the Worker after idle and merge it over the build's
// snapshot. Rendering uses DOM APIs and textContent only; visitor text never touches innerHTML.
import {cleanItem, mergeWall} from './lib/wall-merge.js';
import {formatDay} from './lib/format.js';

export const wallState = {reachable: null};
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

function card(item, isNew) {
  const li = el('li', 'vcard');
  li.dataset.id = item.id;
  const art = el('article');
  art.setAttribute('aria-labelledby', `v-${item.id}`);
  const cv = el('span', 'vc-cv');
  cv.setAttribute('aria-hidden', 'true');
  if (item.coverId) {
    const img = new Image(72, 108);
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.src = `https://covers.openlibrary.org/b/id/${item.coverId}-M.jpg`;
    cv.append(img);
  } else cv.append(el('b', '', item.title));
  const tx = el('div', 'vc-tx');
  const h = el('h3');
  h.id = `v-${item.id}`;
  h.append(el('cite', '', item.title));
  if (item.author) h.append(' ', el('span', 'by', item.author));
  tx.append(h);
  if (item.note) { const bq = el('blockquote'); bq.append(el('p', '', `“${item.note}”`)); tx.append(bq); }
  const meta = el('p', 'meta', 'Recommended by ');
  const t = el('time', '', formatDay(item.date));
  t.dateTime = item.date;
  meta.append(el('b', '', item.name || 'a visitor'), ' · ', t);
  tx.append(meta);
  art.append(cv, tx);
  if (isNew) art.append(el('span', 'fresh', 'New'));
  li.append(art);
  return li;
}

function clamp(ul) {
  const more = document.querySelector('[data-wall-more]');
  const limit = +ul.dataset.visible || 12;
  const items = [...ul.children];
  items.forEach((li, i) => { li.hidden = i >= limit && !ul.dataset.all; });
  if (more) {
    more.parentElement.hidden = items.length <= limit || Boolean(ul.dataset.all);
    more.textContent = `Show all ${items.length}`;
    more.onclick = () => { ul.dataset.all = '1'; clamp(ul); };
  }
  document.querySelector('[data-wall-empty]')?.toggleAttribute('hidden', items.length > 0);
}

export async function loadWall(boot) {
  const ul = document.querySelector('[data-wall]');
  if (!ul) return;
  clamp(ul);
  if (!boot.worker) return;
  let items;
  try {
    const res = await fetch(`${boot.worker}/wall`, {signal: AbortSignal.timeout(4000), credentials: 'omit', headers: {accept: 'application/json'}});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    items = (Array.isArray(json.items) ? json.items : []).map(cleanItem).filter(Boolean).slice(0, 200);
    wallState.reachable = true;
  } catch (err) {
    // A network error or timeout usually means *.workers.dev is blocked here; the form warns up front.
    if (err?.name === 'TypeError' || err?.name === 'TimeoutError') wallState.reachable = false;
    return;
  }
  const snapshot = [...ul.children].map(li => li.dataset.id);
  const merged = mergeWall(snapshot, items);
  if (!merged.changed) return;
  const old = new Map([...ul.children].map(li => [li.dataset.id, li]));
  ul.replaceChildren(...merged.items.map(({item, isNew}) => (isNew ? card(item, true) : old.get(item.id))));
  clamp(ul);
}
