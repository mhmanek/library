// Visitor shelf at runtime: fetch the live list from the Worker after idle and merge it over the build's
// snapshot. Rendering uses DOM APIs and textContent only; visitor text never touches innerHTML.
import {cleanItem, mergeWall} from './lib/wall-merge.js';
import {PC, el, tiltFor, noteSize, pictureEl, stampEl, postmarkEl, addressEl} from './lib/postcard.js';

export const wallState = {reachable: null};
const SVG = 'http://www.w3.org/2000/svg';

// Same markup as visitorCard() in src/templates/visitors.mjs: picture side out, a checkbox to turn it over.
function card(item, isNew) {
  const li = el('li', 'vcard');
  li.dataset.id = item.id;
  li.style.setProperty('--tilt', `${tiltFor(item.id)}deg`);
  const art = el('article', 'pc pc--wall');
  art.setAttribute('aria-labelledby', `v-${item.id}`);

  const hit = el('label', 'pc-hit'), tog = el('input', 'pc-tog'), turn = el('span', 'pc-turn');
  tog.type = 'checkbox';
  tog.setAttribute('aria-label', PC.turn + item.title);
  turn.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg'), use = document.createElementNS(SVG, 'use');
  svg.setAttribute('class', 'i i-turn'); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', '#i-turn');
  svg.append(use); turn.append(svg); hit.append(tog, turn);

  const front = el('div', 'pc-side pc-front'), capt = el('div', 'pc-cap'), h = el('h3', 'pc-cap-t');
  h.id = `v-${item.id}`;
  h.append(el('cite', '', item.title));
  if (item.author) h.append(' ', el('span', 'by', item.author));
  capt.append(h);
  front.append(pictureEl(item), capt);

  const back = el('div', 'pc-side pc-back'), corner = el('span', 'pc-corner'), msg = el('div', 'pc-msg');
  corner.append(stampEl(item), postmarkEl(item.date));
  if (item.note) { const n = el('p', 'pc-note', item.note); n.dataset.size = noteSize(item.note); msg.append(n); }
  else msg.append(el('p', 'pc-none', PC.noNote));
  const sig = el('p', 'pc-sig');
  sig.append(el('span', 'sr-only', `${PC.by} `), item.name || PC.anon);
  msg.append(sig);
  back.append(corner, msg, addressEl());

  const flip = el('div', 'pc-flip');
  flip.append(front, back);
  art.append(hit, flip);
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
