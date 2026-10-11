// Browser entry. The page works without any of this; JS only enhances: card, console, theme knob,
// relative times, scroll-spy, the live visitor shelf and (lazily) the recommendation form.
import {initTheme} from './theme.js';
import {initShelf} from './shelf.js';
import {initCard} from './card.js';
import {relativeTime} from './lib/format.js';

const boot = JSON.parse(document.getElementById('boot')?.textContent || '{}');
const toastEl = document.querySelector('[data-toast]');
let toastTimer = 0;
const toast = msg => {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
};

let rec = null;
const recommend = () => (rec ??= import('./recommend.js').then(m => m.initRecommend(boot)));

initTheme({toast});
const shelf = initShelf({onMiss: title => recommend().then(r => r?.prefill(title))});
initCard({shelf, boot, toast});

const now = Date.now();
for (const t of document.querySelectorAll('time[data-rel]')) {
  const rel = relativeTime(t.dateTime, now);
  if (rel) { t.title = t.textContent; t.textContent = rel; }
}

// The Margins card disappears if its image fails (an inline onerror would break the CSP).
const margins = document.querySelector('[data-margins]');
const mImg = margins?.querySelector('img');
if (mImg) {
  mImg.addEventListener('error', () => { margins.hidden = true; });
  if (mImg.complete && !mImg.naturalWidth && mImg.currentSrc) margins.hidden = true;
}

if ('IntersectionObserver' in window) {
  // Tabs and 11/10 badges flicker once, DuQuantum-style, when they first come into view.
  const lit = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-lit'); lit.unobserve(e.target); }
  }, {threshold: 0.4});
  document.querySelectorAll('.tab, .score--11').forEach(x => lit.observe(x));

  const links = new Map([...document.querySelectorAll('.tnav a')].map(a => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of links.values()) a.removeAttribute('aria-current');
      links.get(e.target.id)?.setAttribute('aria-current', 'location');
    }
  }, {rootMargin: '-35% 0px -60% 0px'});
  for (const id of links.keys()) { const s = document.getElementById(id); if (s) spy.observe(s); }
  // Back at the masthead, no section is current.
  const top = document.getElementById('top');
  if (top) new IntersectionObserver(([e]) => { if (e.isIntersecting) for (const a of links.values()) a.removeAttribute('aria-current'); }, {rootMargin: '-35% 0px -60% 0px'}).observe(top);

  const form = document.querySelector('[data-rec]');
  if (form) {
    const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); recommend(); } }, {rootMargin: '600px 0px'});
    near.observe(form);
  }
}
document.querySelector('[data-rec]')?.addEventListener('focusin', recommend, {once: true});

const idle = cb => ('requestIdleCallback' in window ? requestIdleCallback(cb, {timeout: 3000}) : setTimeout(cb, 1200));
const wall = () => idle(() => import('./wall.js').then(m => m.loadWall(boot)));
if (document.readyState === 'complete') wall(); else addEventListener('load', wall, {once: true});

requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));
