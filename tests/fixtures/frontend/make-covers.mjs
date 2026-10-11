// Draws simple typographic covers for every stem in tests/fixtures/catalog-sample.json, so the fixture site
// renders without the real cover files. Run once; the .webp outputs are committed next to this script.
//   node tests/fixtures/frontend/make-covers.mjs
import sharp from 'sharp';
import {readFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const catalog = JSON.parse(await readFile(join(root, 'tests/fixtures/catalog-sample.json'), 'utf8'));
const antonio = join(root, 'src/fonts/ttf/Antonio-Bold.ttf');
const outDir = join(here, 'covers');
await mkdir(outDir, {recursive: true});

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
async function text(str, {size, color, width}) {
  const {data, info} = await sharp({text: {text: `<span foreground="${color}">${esc(str)}</span>`, fontfile: antonio, font: `Antonio Bold ${size}`, width, align: 'centre', rgba: true, dpi: 72}})
    .png().toBuffer({resolveWithObject: true});
  return {data, w: info.width, h: info.height};
}

for (const b of catalog.books) {
  if (!b.cover.stem) continue;
  const {w, h, colors} = b.cover;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${colors.bg}"/>
<rect x="0" y="${Math.round(h * 0.62)}" width="${w}" height="${Math.round(h * 0.06)}" fill="${colors.accent}"/>
<rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="${colors.bgInk}" stroke-opacity=".35" stroke-width="2"/></svg>`;
  const title = await text(b.title.toUpperCase(), {size: b.cover.square ? 54 : 60, color: colors.bgInk, width: w - 90});
  const author = await text(b.authors[0].toUpperCase(), {size: 26, color: colors.bgInk, width: w - 90});
  const img = sharp(Buffer.from(svg)).composite([
    {input: title.data, left: Math.round((w - title.w) / 2), top: Math.round(h * 0.18)},
    {input: author.data, left: Math.round((w - author.w) / 2), top: Math.round(h * 0.76)},
  ]);
  const buf = await img.png().toBuffer();
  await sharp(buf).webp({quality: 82}).toFile(join(outDir, `${b.cover.stem}-400.webp`));
  await sharp(buf).resize(200).webp({quality: 82}).toFile(join(outDir, `${b.cover.stem}-200.webp`));
  console.log(b.cover.stem, b.title);
}
