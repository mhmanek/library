// Single source of the site's colours and type, mirroring the QUANTUM theme of email-design/design.mjs but
// recoloured navy & gold. Generates tokens.css and feeds og.png and the contrast tests. Dark only.
export const FONTS = {
  display: "Antonio,'Bahnschrift Condensed','DIN Condensed','Arial Narrow','Roboto Condensed',Impact,sans-serif",
  mono: "'Intel One Mono',ui-monospace,Menlo,Consolas,'Roboto Mono','Courier New',monospace",
  read: "'Crimson Pro','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif",
  hand: "'Nothing You Could Do','Segoe Print','Bradley Hand','Comic Sans MS',cursive",
};

export const GOLD = '#d9b45a';
export const NAVY = '#0b1634';

// DuQuantum's own grain: fractal noise, alpha quantised to 0 or .25 so it reads as film, not fog.
export const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncG type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncB type='linear' slope='2' intercept='-.5'/%3E%3CfeFuncA type='discrete' tableValues='0 .25'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const COLOURS = {
  gold: GOLD, 'gold-key': '#a8822e', 'gold-hi': '#f0d58c', 'gold-lo': '#c79f45',
  glow: 'linear-gradient(-32deg,#c79f45 0%,#e2c06a 55%,#c79f45 100%)',
  'on-gold': NAVY, 'mark-me': GOLD, 'mark-me-ring': NAVY, 'plank-edge': GOLD, plank: '#22386b',
  'paper-ink': NAVY, 'paper-muted': '#56627f', 'paper-line': 'rgb(34 56 107/.09)',
  pen: '#23408e', // blue-black ink on the cream postcards
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

// Text-on-surface pairs that must reach 4.5:1 (body-size text).
export const TEXT_PAIRS = [['text', 'page'], ['text', 'panel'], ['text', 'page-deep'], ['gold', 'page'], ['gold', 'panel'], ['gold', 'page-deep'],
  ['muted', 'page'], ['muted', 'panel'], ['muted', 'page-deep'], ['placeholder', 'page-deep'], ['on-gold', 'gold'], ['on-gold', 'gold-lo'],
  ['heading', 'page'], ['link', 'page'], ['err', 'page'], ['ok', 'page'], ['paper-ink', 'paper'], ['paper-muted', 'paper'], ['pen', 'paper'], ['gold', 'plank']];
// Non-text boundaries that must reach 3:1 (focus rings, input borders, data marks).
export const UI_PAIRS = [['focus', 'page'], ['focus', 'panel'], ['mark-me', 'page'], ['mark-world', 'panel'], ['bar', 'page'], ['wire', 'page']];

const block = t => Object.entries(t).map(([k, v]) => (k === 'color-scheme' ? `color-scheme:${v}` : `--${k}:${v}`)).join(';');

export function tokensCss() {
  const fonts = `--f-display:${FONTS.display};--f-mono:${FONTS.mono};--f-read:${FONTS.read};--f-hand:${FONTS.hand};--grain:${GRAIN}`;
  return `:root{${fonts};${block(COLOURS)}}`;
}
