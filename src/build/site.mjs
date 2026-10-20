// The front-end build: catalog (books.json) + wall snapshot + config -> a complete static site in outDir.
// Pure and offline. index.html uses relative URLs only (no <base>), so /library/ and a future custom
// domain both work; base and siteUrl only feed 404.html, canonical and the og tags (CONTRACT "URLs").
import {readFile, writeFile, mkdir, rm, copyFile, access} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {validateBooks} from '../../lib/schema.mjs';
import {shortTitle, surnames} from '../shared/normalize.js';
import {deriveCatalog} from './derive.mjs';
import {buildCss, buildJs, copyFonts, hash} from './assets.mjs';
import {cachedImages} from './og.mjs';
import {buildCsp} from '../templates/head.mjs';
import {renderPage} from '../templates/page.mjs';
import {renderNotFound} from '../templates/notfound.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET = {html: 130 * 1024, css: 16 * 1024, js: 20 * 1024, booksWarn: 180 * 1024, booksFail: 250 * 1024};
// Only these paths are ever removed from outDir, so a mistyped --out can't wipe anything else.
const OWNED = ['index.html', '404.html', 'og.png', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'data', 'assets', 'covers', '.nojekyll'];

export const matchIndex = catalog => catalog.books.map(b => ({
  i: b.slug, s: b.shelf, r: b.rating, f: b.favourite ? `${b.favourite.tier}:${b.favourite.rank ?? ''}` : null,
  ol: b.olWork, t: shortTitle(b.title), a: surnames(b.authors),
}));

const todayUtc = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const exists = p => access(p).then(() => true, () => false);
const gz = s => gzipSync(s, {level: 9}).length;

export async function buildSite({catalog, wall = {items: []}, config, root = process.cwd(), outDir, base, siteUrl, buildDate, dev = false, coversDir}) {
  base ??= config.site.base;
  siteUrl = (siteUrl ?? config.site.url).replace(/\/+$/, '');
  outDir ??= join(root, 'site');
  buildDate ??= todayUtc();
  coversDir ??= join(root, 'covers');
  if (!/^\/(.*\/)?$/.test(base)) throw new Error(`buildSite: base must start and end with '/', got ${base}`);
  const problems = validateBooks(catalog);
  if (problems.length) throw new Error(`buildSite: catalog fails the books.json contract:\n  ${problems.slice(0, 8).join('\n  ')}`);
  wall = {items: Array.isArray(wall?.items) ? wall.items : []};

  const files = [];
  const write = async (rel, data) => { const p = join(outDir, rel); await mkdir(dirname(p), {recursive: true}); await writeFile(p, data); files.push(rel); };
  await Promise.all(OWNED.map(p => rm(join(outDir, p), {recursive: true, force: true})));
  await mkdir(outDir, {recursive: true});

  const derived = deriveCatalog(catalog);
  const index = matchIndex(catalog);

  const css = await buildCss(SRC);
  const cssHash = hash(css);
  await write('assets/app.css', css);
  const jsHashes = await buildJs(SRC, join(outDir, 'assets'));
  for (const p of Object.keys(jsHashes)) files.push(`assets/${p}`);
  files.push(...await copyFonts(SRC, join(outDir, 'assets')));
  const assets = {css: `assets/app.css?v=${cssHash}`, js: `assets/js/main.js?v=${jsHashes['js/main.js']}`};

  const vs = config.visitorShelf ?? {};
  const live = Boolean(vs.workerUrl && vs.turnstileSiteKey);
  const boot = {
    worker: vs.workerUrl || null, siteKey: live ? vs.turnstileSiteKey : null, email: config.site.email,
    postUrl: catalog.sources.substack.postUrl || config.substack.postUrl, siteUrl, base, syncedAt: catalog.syncedAt, tz: config.site.timezone,
  };
  const csp = buildCsp({workerUrl: vs.workerUrl, dev});
  const images = await cachedImages({root, srcDir: SRC, derived, catalog, siteUrl});
  const ogImage = `${siteUrl}/og.png?v=${hash(images['og.png'])}`;

  const page = renderPage({catalog, config, wall, derived, index, assets, csp, boot, buildDate, canonical: `${siteUrl}/`, ogImage});
  if (/<base[\s>]/i.test(page)) throw new Error('index.html must not contain a <base> element (it breaks #book/ links)');
  await write('index.html', page);
  await write('404.html', renderNotFound({base, css: assets.css, siteUrl}));
  await write('data/books.json', JSON.stringify(catalog));
  await write('data/match.json', JSON.stringify(index));
  await write('data/wall.json', JSON.stringify(wall));
  await write('.nojekyll', '');
  for (const [name, buf] of Object.entries(images)) await write(name, buf);
  await write('favicon.svg', await readFile(join(SRC, 'static/favicon.svg')));

  const missingCovers = [];
  const wanted = new Set(catalog.books.flatMap(b => [b.cover.src, b.cover.src2x]).filter(Boolean));
  await mkdir(join(outDir, 'covers'), {recursive: true});
  for (const rel of wanted) {
    const from = join(coversDir, rel.replace(/^covers\//, ''));
    if (await exists(from)) { await copyFile(from, join(outDir, rel)); files.push(rel); }
    else missingCovers.push(rel);
  }

  const initialJs = ['js/main.js', 'js/card.js', 'js/lib/format.js', 'js/lib/url.js'];
  const jsText = await Promise.all(initialJs.map(p => readFile(join(outDir, 'assets', p), 'utf8')));
  const books = JSON.stringify(catalog);
  const report = {
    gzip: {html: gz(page), css: gz(css), js: gz(jsText.join('\n')), books: gz(books), match: gz(JSON.stringify(index))},
    raw: {html: page.length, css: css.length, books: books.length},
    counts: {items: derived.favourites.length},
    missingCovers, warnings: [],
  };
  if (report.gzip.html > BUDGET.html) report.warnings.push(`index.html is ${(report.gzip.html / 1024).toFixed(1)} KB gzipped (budget 130)`);
  if (report.gzip.css > BUDGET.css) report.warnings.push(`app.css is ${(report.gzip.css / 1024).toFixed(1)} KB gzipped (budget 16)`);
  if (report.gzip.js > BUDGET.js) report.warnings.push(`initial JS is ${(report.gzip.js / 1024).toFixed(1)} KB gzipped (budget 20)`);
  if (report.gzip.books > BUDGET.booksWarn) report.warnings.push(`books.json is ${(report.gzip.books / 1024).toFixed(1)} KB gzipped (warn at 180)`);
  if (missingCovers.length) report.warnings.push(`${missingCovers.length} referenced cover files are missing from ${coversDir}`);
  return {files, report};
}

export function formatReport(report) {
  const kb = b => `${(b / 1024).toFixed(1)} KB`;
  const g = report.gzip;
  return [`site: ${report.counts.items} favourites · gzip html ${kb(g.html)} · css ${kb(g.css)} · js ${kb(g.js)} · books.json ${kb(g.books)} · match.json ${kb(g.match)}`,
    ...report.warnings.map(w => `  warning: ${w}`)].join('\n');
}
