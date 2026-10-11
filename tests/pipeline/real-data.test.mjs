// Checks on the committed real data (skipped before the first sync). These run in CI before every sync, so they
// assert invariants rather than counts: a test that pinned "166 read books" would fail the moment he finished a
// book, and a failing test blocks the sync that would have published it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {loadConfig} from '../../lib/config.mjs';
import {loadData, assemble, catalogFrom} from '../../lib/catalog.mjs';
import {validateBooks, validateWall} from '../../lib/schema.mjs';

const ROOT = new URL('../../', import.meta.url);
const exists = p => access(p).then(() => true, () => false);
const hasData = await exists(new URL('data/goodreads/read.json', ROOT));

test('environment: sharp encodes WebP; the lockfile carries the Linux binaries CI needs', async () => {
  const webp = await sharp({create: {width: 4, height: 4, channels: 3, background: '#d9b45a'}}).webp().toBuffer();
  assert.equal((await sharp(webp).metadata()).format, 'webp');
  const lock = await readFile(new URL('package-lock.json', ROOT), 'utf8');
  for (const p of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64', '@img/sharp-win32-x64']) assert.ok(lock.includes(`"node_modules/${p}"`), p);
  await loadConfig(fileURLToPath(ROOT));
});

test('committed data builds a valid catalog', {skip: !hasData && 'no committed data yet'}, async () => {
  const root = fileURLToPath(ROOT);
  const config = await loadConfig(root);
  const data = await loadData(root);
  const a = assemble(data, config);
  const cat = catalogFrom(a, data, config);
  assert.deepEqual(validateBooks(cat), []);
  assert.deepEqual(validateWall(data.wall), []);
  assert.deepEqual(a.warnings.filter(w => /^pin /.test(w)), [], 'every pin in data/manual/favourites-map.json resolves');
  const pins = Object.keys(data.manual.favouritesMap.pins ?? {});
  const all = new Set(cat.books.flatMap(b => [b.goodreadsId, ...b.mergedIds]));
  for (const id of pins) if (all.has(id)) assert.ok(cat.books.some(b => b.favourite && [b.goodreadsId, ...b.mergedIds].includes(id)), `pin ${id} carries a favourite`);
  // Raw feed counts never fall below the distinct books on each shelf (editions only ever merge).
  const items = cat.sources.goodreads.items;
  assert.ok(cat.counts.read <= items.read && cat.counts.toRead <= items['to-read'] + items.read);
  assert.ok(cat.counts.favouritesOnly <= Object.keys(data.manual.favouritesMap.notOnGoodreads ?? {}).length + a.warnings.length);
  // Known duplicate editions stay merged while both are on his shelves.
  for (const [x, y] of [['242105169', '241434373'], ['137252761', '1155'], ['130119', '448832'], ['1118485', '18194'], ['133057573', '176972']]) {
    if (!all.has(x) || !all.has(y)) continue;
    assert.ok(cat.books.some(b => [b.goodreadsId, ...b.mergedIds].includes(x) && [b.goodreadsId, ...b.mergedIds].includes(y)), `${x} + ${y}`);
  }
  // Every referenced cover file exists, and the published JSON stays inside the gzip budget.
  const missing = [];
  for (const b of cat.books) for (const src of [b.cover.src, b.cover.src2x]) if (src && !(await exists(new URL(src, ROOT)))) missing.push(src);
  assert.deepEqual(missing.slice(0, 5), []);
  const gz = gzipSync(JSON.stringify(cat)).length;
  assert.ok(gz < 250_000, `books.json gzips to ${gz} bytes`);
});
