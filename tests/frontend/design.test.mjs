// Tokens meet WCAG AA; harmonised spines always carry gold-foil titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {COLOURS, GOLD, TEXT_PAIRS, UI_PAIRS, tokensCss} from '../../src/design/tokens.mjs';
import {harmonise, hueKey, MIN_GOLD_CONTRAST} from '../../src/build/colour.mjs';
import {contrast, hexToOklch, luminance} from '../../lib/color-math.mjs';
import {rng} from './helpers.mjs';

test('every text pair reaches 4.5:1', () => {
  for (const [fg, bg] of TEXT_PAIRS) {
    const r = contrast(COLOURS[fg], COLOURS[bg]);
    assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}`);
  }
});

test('focus rings, marks and wires reach 3:1', () => {
  for (const [fg, bg] of UI_PAIRS) assert.ok(contrast(COLOURS[fg], COLOURS[bg]) >= 3, `${fg} on ${bg}`);
});

test('the headline ratios match the design', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a.toFixed(2)} vs ${b}`);
  near(contrast(COLOURS.text, COLOURS.page), 14.09);
  near(contrast(COLOURS.gold, COLOURS.page), 9.02);
  near(contrast(COLOURS.muted, COLOURS.page), 6.79);
});

test('tokens.css: one dark palette on :root, nothing that follows the OS', () => {
  const css = tokensCss();
  assert.match(css, /^:root\{--f-display:[^}]*--page:#0b1634;[^}]*color-scheme:dark\}$/);
  assert.doesNotMatch(css, /prefers-color-scheme|data-theme/);
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
