// Day/night knob. The inline bootstrap already set data-theme before first paint; this keeps it in step,
// remembers an explicit choice, follows the OS while nothing is stored, and can forget the choice again.
const KEY = 'ml:theme';
const root = document.documentElement;
const os = matchMedia('(prefers-color-scheme: light)');
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const store = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

function apply(theme) {
  root.dataset.theme = theme;
  document.querySelector('[data-knob]')?.setAttribute('aria-pressed', String(theme === 'night'));
  const page = getComputedStyle(root).getPropertyValue('--page').trim();
  for (const m of document.querySelectorAll('meta[name=theme-color]')) m.content = page;
  dispatchEvent(new CustomEvent('themechange', {detail: theme}));
}

export function initTheme({toast} = {}) {
  apply(root.dataset.theme === 'day' ? 'day' : 'night');
  document.querySelector('[data-knob]')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'night' ? 'day' : 'night';
    store(next);
    apply(next);
  });
  os.addEventListener('change', () => { if (!stored()) apply(os.matches ? 'day' : 'night'); });
  document.querySelector('[data-theme-reset]')?.addEventListener('click', () => {
    store(null);
    apply(os.matches ? 'day' : 'night');
    toast?.('Following your system theme');
  });
}
