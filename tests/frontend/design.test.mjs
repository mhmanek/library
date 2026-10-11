// Tokens meet WCAG AA in both themes; harmonised spines always carry gold-foil titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NIGHT, DAY, GOLD, TEXT_PAIRS, UI_PAIRS, TEXT_TOKENS, tokensCss} from '../../src/design/tokens.mjs';
import {harmonise, hueKey, MIN_GOLD_CONTRAST} from '../../src/build/colour.mjs';
import {contrast, hexToOklch, luminance} from '../../lib/color-math.mjs';
import {rng} from './helpers.mjs';

const themes = {night: NIGHT, day: DAY};

test('every text pair reaches 4.5:1 in both themes', () => {
  for (const [name, t] of Object.entries(themes)) {
    for (const [fg, bg] of TEXT_PAIRS[name]) {
      const r = contrast(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}`);
    }
  }
});

test('focus rings, marks and wires reach 3:1', () => {
  for (const [name, t] of Object.entries(themes)) {
    for (const [fg, bg] of UI_PAIRS[name]) assert.ok(contrast(t[fg], t[bg]) >= 3, `${name}: ${fg} on ${bg}`);
  }
});

test('the headline ratios match the design', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a.toFixed(2)} vs ${b}`);
  near(contrast(NIGHT.text, NIGHT.page), 14.09);
  near(contrast(NIGHT.gold, NIGHT.page), 9.02);
  near(contrast(NIGHT.muted, NIGHT.page), 6.79);
  near(contrast(DAY['text-strong'], DAY.page), 14.51);
  near(contrast(DAY.text, DAY.page), 11.21);
  near(contrast(DAY.muted, DAY.page), 5.52);
});

test('gold is never a day-mode text colour (it is 1.6:1 on parchment)', () => {
  assert.ok(contrast(GOLD, DAY.page) < 2);
  for (const k of TEXT_TOKENS) assert.notEqual(DAY[k].toLowerCase(), GOLD, `day --${k} must not be gold`);
});

test('tokens.css: night on :root, the OS fallback and the explicit day block', () => {
  const css = tokensCss();
  assert.match(css, /^:root\{--f-display:/);
  assert.match(css, /@media \(prefers-color-scheme:light\)\{:root:not\(\[data-theme=night\]\)\{/);
  assert.match(css, /:root\[data-theme=day\]\{/);
  assert.equal(css.match(/--page:#f1e7d2/g).length, 2);
});

const EXTREMES = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff69b4', '#ff8800', '#40e0d0',
  '#808080', '#f1e7d2', '#d9b45a', '#0b1634', '#7a2e2a', '#e9e4d8', '#1a4fa0'];

test('harmonise: dark cloth, in gamut, deterministic, gold-legible, unread never lighter', () => {
  const r = rng(2026);
  const inputs = [...EXTREMES, ...Array.from({length: 500}, () => '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0'))];
  for (const hex of inputs) {
    const a = harmonise(hex), b = harmonise(hex), u = harmonise(hex, {unread: true});
    assert.equal(a.hex, b.hex, 'deterministic');
    assert.match(a.hex, /^#[0-9a-f]{6}$/);
    assert.ok(hexToOklch(a.hex).l <= 0.405, `${hex} -> ${a.hex} is too light`);
    assert.ok(contrast(GOLD, a.hex) >= MIN_GOLD_CONTRAST, `${hex} -> ${a.hex}: ${contrast(GOLD, a.hex).toFixed(2)}`);
    assert.ok(contrast(GOLD, u.hex) >= MIN_GOLD_CONTRAST, `unread ${hex}`);
    assert.ok(luminance(u.hex) <= luminance(a.hex) + 1e-9, `unread ${hex} is lighter than read`);
  }
});

test('harmonise falls back for missing or bad input; hue keys put neutrals last', () => {
  assert.equal(harmonise(null).hex, harmonise('#22386b').hex);
  assert.equal(harmonise('nonsense').hex, harmonise('#22386b').hex);
  assert.ok(hueKey('#ffffff') >= 400 && hueKey('#000000') >= 400);
  assert.ok(hueKey('#ff0000') < 360);
});
