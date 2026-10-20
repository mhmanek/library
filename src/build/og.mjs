// og.png (1200x630) and the PNG favicons, drawn with sharp: SVG shapes (navy cloth, grain, the two-wire
// circuit, a shelf of harmonised spines on a gold rail) plus text layers from the committed TTFs, because
// librsvg can't be trusted to find Antonio. Cached by input hash, so most builds just copy bytes.
import sharp from 'sharp';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {hash} from './assets.mjs';
import {COLOURS, GOLD, NAVY} from '../design/tokens.mjs';
import {formatNumber as n} from '../js/lib/format.js';

const W = 1200, H = 630, T = 76, TH = 86, GAP = 13;
const KEY = '#a8822e';

function geometry() {
  const ketX = 64, tilesX = 150, row1 = 132, row2 = row1 + TH + 44;
  const xs1 = [], xs2 = [];
  for (let i = 0; i < 6; i++) { xs1.push(tilesX + i * (T + GAP)); xs2.push(tilesX + i * (T + GAP)); }
  const apos = tilesX + 6 * (T + GAP), last = apos + 22 + GAP;
  xs1.push(last); xs2.push(last);
  const cx = 950, node = 1136;
  return {ketX, row1, row2, xs1, xs2, apos, cx, node};
}

function svgShapes({spines}) {
  const g = geometry();
  const mid = y => y + TH / 2;
  const tile = x => (y) => `<rect x="${x}" y="${y}" width="${T}" height="${TH}" fill="${KEY}"/><rect x="${x}" y="${y}" width="${T}" height="${TH - 6}" fill="${GOLD}"/>`;
  const wires = [g.row1, g.row2].map(y => `<rect x="${g.ketX + 64}" y="${mid(y) - 1.5}" width="${g.node - g.ketX - 64}" height="3" fill="${GOLD}"/>`).join('');
  const ket = y => `<path d="M${g.ketX + 46} ${mid(y) - 17}l9 17-9 17" fill="none" stroke="${GOLD}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  let x = 64;
  const shelf = [];
  for (const s of spines) {
    const w = Math.round(s.w * 0.92), h = Math.round(118 * s.h / 100);
    if (x + w > W - 64) break;
    const y = 586 - h;
    shelf.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${s.sp}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#shade)"/>`);
    if (s.g) shelf.push(`<rect x="${x}" y="${y + 7}" width="${w}" height="2" fill="${GOLD}"/><rect x="${x}" y="${y + 11}" width="${w}" height="1" fill="${GOLD}"/><rect x="${x}" y="${y + h - 12}" width="${w}" height="1" fill="${GOLD}"/><rect x="${x}" y="${y + h - 9}" width="${w}" height="2" fill="${GOLD}"/>`);
    x += w + 2;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feComponentTransfer><feFuncR type="linear" slope="2" intercept="-.5"/><feFuncG type="linear" slope="2" intercept="-.5"/><feFuncB type="linear" slope="2" intercept="-.5"/><feFuncA type="discrete" tableValues="0 .25"/></feComponentTransfer></filter>
<linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset=".14" stop-color="#fff" stop-opacity=".1"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
<radialGradient id="lamp" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#f0d58c" stop-opacity=".12"/><stop offset="1" stop-color="#f0d58c" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${NAVY}"/><rect width="${W}" height="${H}" fill="url(#lamp)"/>
<rect x="0" y="0" width="${W}" height="12" fill="${GOLD}"/>
${wires}${ket(g.row1)}${ket(g.row2)}
${g.xs1.map(x => tile(x)(g.row1)).join('')}${g.xs2.map(x => tile(x)(g.row2)).join('')}
<circle cx="${g.cx}" cy="${mid(g.row1)}" r="11" fill="${GOLD}"/><rect x="${g.cx - 1.5}" y="${mid(g.row1)}" width="3" height="${g.row2 - g.row1}" fill="${GOLD}"/>
<circle cx="${g.cx}" cy="${mid(g.row2)}" r="20" fill="${NAVY}" stroke="${GOLD}" stroke-width="3"/><rect x="${g.cx - 1.5}" y="${mid(g.row2) - 20}" width="3" height="40" fill="${GOLD}"/><rect x="${g.cx - 20}" y="${mid(g.row2) - 1.5}" width="40" height="3" fill="${GOLD}"/>
<circle cx="${g.node}" cy="${mid(g.row1)}" r="9" fill="${GOLD}"/><circle cx="${g.node}" cy="${mid(g.row2)}" r="9" fill="${GOLD}"/>
${shelf.join('')}
<rect x="40" y="586" width="${W - 80}" height="4" fill="${GOLD}"/><rect x="40" y="590" width="${W - 80}" height="14" fill="#22386b"/>
<rect width="${W}" height="${H}" filter="url(#n)" opacity=".5"/>
</svg>`;
}

async function textLayer(text, {fontfile, size, color, letterSpacing = 0}) {
  const spacing = letterSpacing ? ` letter_spacing="${Math.round(letterSpacing * 1024)}"` : '';
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const {data, info} = await sharp({text: {text: `<span foreground="${color}"${spacing}>${safe}</span>`, fontfile, font: `${fontfile.includes('Antonio') ? 'Antonio' : 'Intel One Mono'} Bold ${size}`, rgba: true, dpi: 72}}).png().toBuffer({resolveWithObject: true});
  return {input: data, w: info.width, h: info.height};
}

export async function renderOg({derived, catalog, siteUrl, srcDir}) {
  const antonio = join(srcDir, 'fonts/ttf/Antonio-Bold.ttf'), mono = join(srcDir, 'fonts/ttf/IntelOneMono-Bold.ttf');
  const spines = derived.read.slice(0, 60).map(m => ({w: m.w, h: m.h, sp: m.sp, g: m.cls.includes('g')}));
  const g = geometry();
  const layers = [];
  const place = async (text, opts, pos) => { const l = await textLayer(text, opts); layers.push({input: l.input, ...pos(l)}); };
  const tileText = (ch, x, y) => place(ch, {fontfile: antonio, size: 70, color: NAVY}, l => ({left: Math.round(x + (T - l.w) / 2), top: Math.round(y + (TH - 6 - l.h) / 2 + 2)}));
  const letters1 = 'MALHARS', letters2 = 'LIBRARY';
  for (let i = 0; i < 7; i++) { await tileText(letters1[i], g.xs1[i], g.row1); await tileText(letters2[i], g.xs2[i], g.row2); }
  await place('’', {fontfile: antonio, size: 84, color: GOLD}, () => ({left: g.apos, top: g.row1 - 8}));
  for (const y of [g.row1, g.row2]) await place('|0', {fontfile: mono, size: 30, color: GOLD}, l => ({left: g.ketX, top: Math.round(y + (TH - l.h) / 2)}));
  await place(siteUrl.replace(/^https?:\/\//, ''), {fontfile: mono, size: 22, color: COLOURS.muted}, () => ({left: 64, top: 52}));
  const c = catalog.counts;
  await place(`${n(c.read)} READ  ·  ${n(c.toRead)} IN THE ANTILIBRARY  ·  ${n(catalog.stats.favourites.ranked)} FAVOURITES`, {fontfile: mono, size: 22, color: COLOURS.text, letterSpacing: 2}, () => ({left: 64, top: 404}));
  return sharp(Buffer.from(svgShapes({spines}))).composite(layers).png({palette: true, quality: 90, effort: 8}).toBuffer();
}

export async function renderFavicons(srcDir) {
  const svg = (await readFile(join(srcDir, 'static/favicon.svg'), 'utf8')).replace(/<style>[\s\S]*?<\/style>/, '').replace('class="bg"', `fill="${NAVY}"`);
  const png = size => sharp(Buffer.from(svg), {density: 72 * size / 32}).resize(size, size).png().toBuffer();
  return {'favicon-32.png': await png(32), 'apple-touch-icon.png': await png(180)};
}

// Cache by input hash under .cache/og so the dev server's rebuilds stay fast.
export async function cachedImages({root, srcDir, derived, catalog, siteUrl}) {
  const key = hash(JSON.stringify([catalog.counts, catalog.stats.favourites.ranked, siteUrl, derived.read.slice(0, 60).map(m => [m.w, m.h, m.sp, m.cls]),
    await readFile(new URL(import.meta.url), 'utf8'), await readFile(join(srcDir, 'static/favicon.svg'), 'utf8')]));
  const dir = join(root, '.cache', 'og');
  try {
    const [og, f32, apple] = await Promise.all(['og.png', 'favicon-32.png', 'apple-touch-icon.png'].map(f => readFile(join(dir, `${key}-${f}`))));
    return {'og.png': og, 'favicon-32.png': f32, 'apple-touch-icon.png': apple};
  } catch { /* render below */ }
  const out = {'og.png': await renderOg({derived, catalog, siteUrl, srcDir}), ...await renderFavicons(srcDir)};
  try {
    await mkdir(dir, {recursive: true});
    await Promise.all(Object.entries(out).map(([f, buf]) => writeFile(join(dir, `${key}-${f}`), buf)));
  } catch { /* a read-only checkout just renders every time */ }
  return out;
}
