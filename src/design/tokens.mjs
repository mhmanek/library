// Single source of the site's colours and type, mirroring the QUANTUM theme of email-design/design.mjs but
// recoloured navy & gold. Generates tokens.css and feeds og.png and the contrast tests.
// Gold is a material, not an ink, in day mode: it only ever appears as a fill behind navy text.
export const FONTS = {
  display: "Antonio,'Bahnschrift Condensed','DIN Condensed','Arial Narrow','Roboto Condensed',Impact,sans-serif",
  mono: "'Intel One Mono',ui-monospace,Menlo,Consolas,'Roboto Mono','Courier New',monospace",
  read: "'Crimson Pro','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif",
};

export const GOLD = '#d9b45a';
export const NAVY = '#0b1634';

// DuQuantum's own grain: fractal noise, alpha quantised to 0 or .25 so it reads as film, not fog.
export const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncG type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncB type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncA type='discrete' tableValues='0 .25'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const SHARED = {
  gold: GOLD, 'gold-key': '#a8822e', 'gold-hi': '#f0d58c', 'gold-lo': '#c79f45',
  glow: 'linear-gradient(-32deg,#c79f45 0%,#e2c06a 55%,#c79f45 100%)',
  'on-gold': NAVY, 'mark-me': GOLD, 'mark-me-ring': NAVY, 'plank-edge': GOLD, plank: '#22386b',
  'paper-ink': NAVY, 'paper-muted': '#56627f', 'paper-line': 'rgb(34 56 107/.09)',
};

export const NIGHT = {
  ...SHARED,
  page: NAVY, 'page-deep': '#081028', panel: '#12204a', 'panel-2': '#0f1d42',
  rule: '#22386b', 'rule-hi': '#2e4785',
  'glow-shadow': '0 0 18px rgb(217 180 90/.35)',
  text: '#efe4c8', 'text-strong': '#fbf3dd', muted: '#93a0bd', placeholder: '#7d8aa8',
  heading: GOLD, 'accent-text': GOLD, link: GOLD, 'link-line': 'rgb(217 180 90/.55)', 'link-w': '1px',
  wire: GOLD, focus: GOLD, 'sel-bg': GOLD, 'sel-fg': NAVY,
  'shelf-wall': '#081028', paper: '#f6efdc',
  ok: '#9cc79a', err: '#e8927c', 'mark-world': '#93a0bd', bar: GOLD,
  'grain-opacity': '.22', 'node-glow': '0 0 10px rgb(217 180 90/.55)', 'card-frame': GOLD, 'scan': 'rgb(255 255 255/.035)',
  'heading-fill': 'linear-gradient(-32deg,#c79f45 8%,#f0d58c 58%,#d9b45a 100%)',
  shadow: '0 18px 40px rgb(3 7 20/.55)', backdrop: 'rgb(5 10 26/.62)', 'page-dim': '#070f24' /* page under the backdrop: fills the scrollbar gutter the backdrop can't reach */,
  'color-scheme': 'dark',
};

export const DAY = {
  ...SHARED,
  page: '#f1e7d2', 'page-deep': '#e8dcc2', panel: '#f8f1e1', 'panel-2': '#fbf5e6',
  rule: '#c9b98f', 'rule-hi': '#22386b',
  'glow-shadow': '0 0 0 1px #a8822e',
  text: '#1f2b52', 'text-strong': NAVY, muted: '#4f5b78', placeholder: '#535f7c',
  heading: NAVY, 'accent-text': NAVY, link: '#22386b', 'link-line': GOLD, 'link-w': '2px',
  wire: '#22386b', focus: NAVY, 'sel-bg': NAVY, 'sel-fg': '#f1e7d2',
  'shelf-wall': '#e8dcc2', paper: '#fbf5e6',
  ok: '#2f6b3a', err: '#9a3a28', 'mark-world': '#4f5b78', bar: '#22386b',
  'grain-opacity': '.12', 'node-glow': 'none', 'card-frame': NAVY, 'scan': 'rgb(11 22 52/.04)',
  'heading-fill': 'linear-gradient(#0b1634,#0b1634)',
  shadow: '0 14px 30px rgb(60 44 10/.18)', backdrop: 'rgb(29 26 21/.35)', 'page-dim': '#a79f90',
  'color-scheme': 'light',
};

// Text-on-surface pairs that must reach 4.5:1 (body-size text) in each theme.
export const TEXT_PAIRS = {
  night: [['text', 'page'], ['text', 'panel'], ['text', 'page-deep'], ['gold', 'page'], ['gold', 'panel'], ['gold', 'page-deep'],
    ['muted', 'page'], ['muted', 'panel'], ['muted', 'page-deep'], ['placeholder', 'page-deep'], ['on-gold', 'gold'], ['on-gold', 'gold-lo'],
    ['heading', 'page'], ['link', 'page'], ['err', 'page'], ['ok', 'page'], ['paper-ink', 'paper'], ['paper-muted', 'paper'], ['gold', 'plank']],
  day: [['text-strong', 'page'], ['text', 'page'], ['text', 'panel'], ['muted', 'page'], ['muted', 'page-deep'], ['muted', 'panel'],
    ['heading', 'page'], ['accent-text', 'panel'], ['link', 'page'], ['on-gold', 'gold'], ['on-gold', 'gold-lo'], ['err', 'page'], ['ok', 'page'],
    ['err', 'paper'], ['paper-ink', 'paper'], ['paper-muted', 'paper'], ['placeholder', 'page-deep']],
};
// Non-text boundaries that must reach 3:1 (focus rings, input borders, data marks).
export const UI_PAIRS = {
  night: [['focus', 'page'], ['focus', 'panel'], ['mark-me', 'page'], ['mark-world', 'panel'], ['bar', 'page'], ['wire', 'page']],
  day: [['focus', 'page'], ['focus', 'panel'], ['rule-hi', 'page'], ['mark-world', 'panel'], ['bar', 'page'], ['wire', 'page'], ['mark-me-ring', 'panel']],
};
// Tokens used as text colours; in day mode none of them may be gold.
export const TEXT_TOKENS = ['text', 'text-strong', 'muted', 'placeholder', 'heading', 'accent-text', 'link', 'focus'];

const block = t => Object.entries(t).map(([k, v]) => (k === 'color-scheme' ? `color-scheme:${v}` : `--${k}:${v}`)).join(';');

// Night on :root; the OS decides for no-JS visitors; an explicit choice (set before first paint) wins.
export function tokensCss() {
  const fonts = `--f-display:${FONTS.display};--f-mono:${FONTS.mono};--f-read:${FONTS.read};--grain:${GRAIN}`;
  return `:root{${fonts};${block(NIGHT)}}`
    + `@media (prefers-color-scheme:light){:root:not([data-theme=night]){${block(DAY)}}}`
    + `:root[data-theme=day]{${block(DAY)}}`;
}
