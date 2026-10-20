// Browser entry. The page works without any of this; JS only enhances: the live visitor shelf and (lazily)
// the recommendation form.
const boot = JSON.parse(document.getElementById('boot')?.textContent || '{}');

let rec = null;
const recommend = () => (rec ??= import('./recommend.js').then(m => m.initRecommend(boot)));

if ('IntersectionObserver' in window) {
  // Tabs flicker once, DuQuantum-style, when they first come into view.
  const lit = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-lit'); lit.unobserve(e.target); }
  }, {threshold: 0.4});
  document.querySelectorAll('.tab').forEach(x => lit.observe(x));

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
