#!/usr/bin/env node
// Offline stage: committed data/, covers/ and config.json -> site/. Never touches the network.
//   node scripts/build.mjs [--base /library/] [--site-url URL] [--out site] [--dev] [--now ISO]
// CI passes --base "$BASE_PATH/" and --site-url "$BASE_URL" from actions/configure-pages.
import {resolve, join} from 'node:path';
import {access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {readJson} from '../lib/json.mjs';
import {loadData, buildCatalog} from '../lib/catalog.mjs';
import {validateBooks, validateWall, validateWantToRead} from '../lib/schema.mjs';

// "/library", "library/", "//library//" -> "/library/"; "" or "/" -> "/".
export const normalizeBase = b => { const parts = String(b ?? '/').split('/').filter(Boolean); return parts.length ? `/${parts.join('/')}/` : '/'; };
const buildDateOf = d => d.toISOString().slice(0, 10).replace(/-/g, '');

export async function build({root = process.cwd(), out = 'site', base, siteUrl, dev = false, now} = {}) {
  root = resolve(root);
  const config = await loadConfig(root);
  const data = await loadData(root);
  const catalog = buildCatalog(data, config);
  const errors = validateBooks(catalog);
  if (errors.length) throw new Error(`books.json would break the contract:\n  ${errors.slice(0, 20).join('\n  ')}`);
  const wall = await readJson(join(root, 'data', 'wall.json'), {items: []});
  const wallErrors = validateWall(wall);
  if (wallErrors.length) throw new Error(`data/wall.json is invalid:\n  ${wallErrors.slice(0, 20).join('\n  ')}`);
  const wantToRead = await readJson(join(root, 'data', 'manual', 'want-to-read.json'), {items: []});
  const wantErrors = validateWantToRead(wantToRead);
  if (wantErrors.length) throw new Error(`data/manual/want-to-read.json is invalid:\n  ${wantErrors.slice(0, 20).join('\n  ')}`);

  const b = normalizeBase(base ?? config.site.base);
  const url = String(siteUrl ?? (dev ? `http://localhost:8080${b.replace(/\/$/, '')}` : config.site.url)).replace(/\/+$/, '');
  const date = now ? new Date(now) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`--now: not a date: ${now}`);

  const sitePath = join(root, 'src', 'build', 'site.mjs');
  if (!(await access(sitePath).then(() => true, () => false))) {
    throw new Error(`src/build/site.mjs does not exist yet: the site templates (frontend) are not built. The catalog itself is fine (${catalog.books.length} books).`);
  }
  const {buildSite} = await import(pathToFileURL(sitePath).href);
  if (typeof buildSite !== 'function') throw new Error('src/build/site.mjs must export buildSite({catalog, wall, wantToRead, config, root, outDir, base, siteUrl, buildDate, dev})');
  return buildSite({catalog, wall, wantToRead, config, root, outDir: resolve(root, out), base: b, siteUrl: url, buildDate: buildDateOf(date), dev});
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--base') o.base = val();
    else if (a === '--site-url') o.siteUrl = val();
    else if (a === '--out') o.out = val();
    else if (a === '--now') o.now = val();
    else if (a === '--dev') o.dev = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return o;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const r = await build(args);
    const n = r?.files?.length ?? Object.keys(r?.files ?? {}).length;
    console.log(`built ${args.out ?? 'site'}/ (${n} files)`);
    if (r?.report) console.log(typeof r.report === 'string' ? r.report : JSON.stringify(r.report, null, 2));
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
