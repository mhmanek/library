// CSS concatenation and minification, the JS module graph copied with ?v=<hash> on every relative import
// (GitHub Pages caches for 10 minutes, so stable paths plus content hashes avoid version skew), fonts.
import {readFile, writeFile, mkdir, readdir, copyFile} from 'node:fs/promises';
import {join, dirname, relative, resolve, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {tokensCss} from '../design/tokens.mjs';

export const CSS_ORDER = ['fonts.css', 'base.css', 'layout.css', 'components.css', 'shelf.css', 'favourites.css', 'card.css', 'visitors.css', 'print.css'];
export const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 10);

// Minifies outside strings and comments only, so data URIs and content:'…' survive byte for byte.
export function minifyCss(css) {
  const out = [];
  const re = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
  let last = 0, m;
  const squeeze = s => s.replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1');
  while ((m = re.exec(css))) {
    out.push(squeeze(css.slice(last, m.index)));
    if (!m[0].startsWith('/*')) out.push(m[0]);
    last = re.lastIndex;
  }
  out.push(squeeze(css.slice(last)));
  return out.join('').replace(/;}/g, '}').trim();
}

export async function buildCss(srcDir) {
  const parts = [];
  for (const file of CSS_ORDER) {
    let css = await readFile(join(srcDir, 'styles', file), 'utf8');
    if (file === 'fonts.css') css = css.replace(/url\(\.\.\/fonts\//g, 'url(fonts/');
    parts.push(css);
    if (file === 'fonts.css') parts.push(tokensCss());
  }
  return minifyCss(parts.join('\n'));
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;

// Copies src/js/** to assets/js/** and src/shared/* to assets/shared/*, rewriting every relative import to
// carry the content hash of its (already rewritten) target. Returns {path: hash} keyed by output path.
export async function buildJs(srcDir, assetsDir) {
  const files = [...await walk(join(srcDir, 'js')), ...await walk(join(srcDir, 'shared'))];
  const memo = new Map();
  const outPath = file => join(assetsDir, relative(srcDir, file));
  async function processFile(file, stack = []) {
    const key = resolve(file);
    if (memo.has(key)) return memo.get(key);
    if (stack.includes(key)) throw new Error(`import cycle through ${file}`);
    const src = await readFile(file, 'utf8');
    let text = src;
    for (const m of [...src.matchAll(SPEC)]) {
      const target = resolve(dirname(file), m[3]);
      const {h} = await processFile(target, [...stack, key]);
      text = text.replace(m[0], `${m[1]}${m[2]}${m[3]}?v=${h}${m[2]}`);
    }
    const result = {h: hash(text), text};
    memo.set(key, result);
    const out = outPath(file);
    await mkdir(dirname(out), {recursive: true});
    await writeFile(out, text);
    return result;
  }
  const hashes = {};
  for (const f of files) hashes[posix.normalize(relative(assetsDir, outPath(f)).replace(/\\/g, '/'))] = (await processFile(f)).h;
  return hashes;
}

export async function copyFonts(srcDir, assetsDir) {
  const from = join(srcDir, 'fonts'), to = join(assetsDir, 'fonts');
  await mkdir(to, {recursive: true});
  const copied = [];
  for (const e of await readdir(from, {withFileTypes: true})) {
    if (!e.isFile() || !/\.(woff2|txt)$/.test(e.name)) continue; // ttf/ stays behind: OG rendering only
    await copyFile(join(from, e.name), join(to, e.name));
    copied.push(`assets/fonts/${e.name}`);
  }
  return copied;
}
