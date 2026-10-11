#!/usr/bin/env node
// Post-build gate for CI: required files, the books.json contract, every cover present, every relative
// link resolvable, gzip budgets, no <base>, a CSP, and nothing that looks like a secret.
//   node scripts/check-site.mjs [site]
import {readFile, readdir, stat, access} from 'node:fs/promises';
import {join, resolve, dirname, posix, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {validateBooks, validateWall} from '../lib/schema.mjs';

export const BUDGET = {html: 130 * 1024, css: 16 * 1024, js: 20 * 1024, booksWarn: 180 * 1024, booksFail: 250 * 1024};
export const REQUIRED = ['index.html', '404.html', 'data/books.json', 'data/match.json', 'data/wall.json', 'assets/app.css', 'assets/js/main.js',
  'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'og.png'];
// Split so this file never matches its own scan if someone copies it into site/.
const SECRETS = [new RegExp('github' + '_pat_[A-Za-z0-9_]{10,}'), new RegExp('gh' + 'p_[A-Za-z0-9]{20,}'), new RegExp('-----' + 'BEGIN'), new RegExp('gh[osu]' + '_[A-Za-z0-9]{30,}')];

const exists = p => access(p).then(() => true, () => false);
const gz = s => gzipSync(s, {level: 9}).length;
const kb = b => `${(b / 1024).toFixed(1)} KB`;
const strip = u => u.split('#')[0].split('?')[0];
const external = u => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u) || u === '';

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base)); else out.push(posix.normalize(p.slice(base.length + 1).replace(/\\/g, '/')));
  }
  return out;
}

const attrUrls = html => {
  const urls = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) urls.push(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1].split(',')) urls.push(part.trim().split(/\s+/)[0]);
  return urls.map(u => u.replace(/&amp;/g, '&'));
};
const importSpecs = js => [...js.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);
const dynamicSpecs = js => [...js.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);

export async function checkSite(dir) {
  dir = resolve(dir);
  const errors = [], warnings = [], sizes = {};
  for (const f of REQUIRED) if (!(await exists(join(dir, f)))) errors.push(`missing ${f}`);
  if (errors.length) return {errors, warnings, sizes};

  const index = await readFile(join(dir, 'index.html'), 'utf8');
  const notFound = await readFile(join(dir, '404.html'), 'utf8');
  for (const [name, html] of [['index.html', index], ['404.html', notFound]]) {
    if (/<base[\s>]/i.test(html)) errors.push(`${name} has a <base> element (it breaks #book/ links)`);
    if (!/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src (?:'|&#39;)self(?:'|&#39;)/.test(html)) errors.push(`${name} has no Content-Security-Policy meta`);
  }

  let books;
  try { books = JSON.parse(await readFile(join(dir, 'data/books.json'), 'utf8')); } catch (err) { errors.push(`data/books.json is not JSON: ${err.message}`); }
  if (books) {
    for (const e of validateBooks(books).slice(0, 30)) errors.push(`books.json ${e}`);
    for (const b of books.books ?? []) for (const src of [b.cover?.src, b.cover?.src2x].filter(Boolean)) if (!(await exists(join(dir, src)))) errors.push(`missing cover ${src} (${b.id})`);
  }
  try {
    const wall = JSON.parse(await readFile(join(dir, 'data/wall.json'), 'utf8'));
    for (const e of validateWall(wall)) errors.push(`wall.json ${e}`);
  } catch (err) { errors.push(`data/wall.json is not JSON: ${err.message}`); }

  // index.html must use relative URLs only, and every one must exist.
  const missing = new Set();
  for (const u of attrUrls(index)) {
    if (external(u)) continue;
    if (u.startsWith('/')) { errors.push(`index.html uses a root-absolute URL ${u} (relative only, so any base path works)`); continue; }
    if (!(await exists(join(dir, decodeURIComponent(strip(u)))))) missing.add(u);
  }
  // 404.html is base-absolute by design: map the base prefix back onto the site root.
  const base = /href="([^"]*?)assets\/app\.css/.exec(notFound)?.[1] ?? '/';
  for (const u of attrUrls(notFound)) {
    if (external(u) || !u.startsWith(base)) continue;
    const rel = strip(u).slice(base.length);
    if (rel && !(await exists(join(dir, decodeURIComponent(rel))))) missing.add(u);
  }
  const css = await readFile(join(dir, 'assets/app.css'), 'utf8');
  for (const m of css.matchAll(/url\((?!["']?(?:data:|#|%23))["']?([^"')]+)["']?\)/g)) if (!(await exists(join(dir, 'assets', strip(m[1]))))) missing.add(`app.css ${m[1]}`);

  // The module graph: every relative import resolves; the initial (static) graph is what the budget counts.
  const jsDir = join(dir, 'assets');
  const seen = new Set();
  let initial = '';
  async function visit(file, isStatic) {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) { missing.add(file.slice(dir.length + 1)); return; }
    if (isStatic) initial += text;
    for (const spec of importSpecs(text)) if (spec.startsWith('.')) await visit(join(dirname(file), strip(spec)), isStatic);
    for (const spec of dynamicSpecs(text)) if (spec.startsWith('.')) await visit(join(dirname(file), strip(spec)), false);
  }
  await visit(join(jsDir, 'js/main.js'), true);
  for (const u of missing) errors.push(`broken link ${u}`);

  sizes.html = gz(index); sizes.css = gz(css); sizes.js = gz(initial);
  sizes.books = books ? gz(JSON.stringify(books)) : 0;
  if (sizes.html > BUDGET.html) errors.push(`index.html is ${kb(sizes.html)} gzipped (budget ${kb(BUDGET.html)})`);
  if (sizes.css > BUDGET.css) errors.push(`app.css is ${kb(sizes.css)} gzipped (budget ${kb(BUDGET.css)})`);
  if (sizes.js > BUDGET.js) errors.push(`initial JS is ${kb(sizes.js)} gzipped (budget ${kb(BUDGET.js)})`);
  if (sizes.books > BUDGET.booksFail) errors.push(`books.json is ${kb(sizes.books)} gzipped (budget ${kb(BUDGET.booksFail)})`);
  else if (sizes.books > BUDGET.booksWarn) warnings.push(`books.json is ${kb(sizes.books)} gzipped (warn at ${kb(BUDGET.booksWarn)})`);

  for (const f of await walk(dir)) {
    if (!['.html', '.js', '.css', '.json', '.txt', '.svg', '.xml', ''].includes(extname(f))) continue;
    const text = await readFile(join(dir, f), 'utf8');
    for (const re of SECRETS) if (re.test(text)) errors.push(`${f} contains something that looks like a secret (${re.source.slice(0, 12)}…)`);
  }
  return {errors, warnings, sizes};
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const dir = process.argv[2] ?? 'site';
  if (!(await stat(dir).then(s => s.isDirectory(), () => false))) { console.error(`check-site: ${dir} is not a directory (run the build first)`); process.exit(1); }
  const {errors, warnings, sizes} = await checkSite(dir);
  console.log(`check-site ${dir}: html ${kb(sizes.html ?? 0)} · css ${kb(sizes.css ?? 0)} · js ${kb(sizes.js ?? 0)} · books.json ${kb(sizes.books ?? 0)} (gzip)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors.slice(0, 60)) console.error(`  error: ${e}`);
  if (errors.length > 60) console.error(`  … and ${errors.length - 60} more`);
  if (errors.length) { console.error(`check-site: ${errors.length} problem(s)`); process.exit(1); }
  console.log('check-site: ok');
}
