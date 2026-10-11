// Shared test helpers: the sample catalog, a seeded synthetic catalog of any size (for budgets), and a
// one-call fixture build into a temp directory.
import {readFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite} from '../../src/build/site.mjs';
import {loadConfig} from '../../lib/config.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const COVERS = join(ROOT, 'tests/fixtures/frontend/covers');
export const sample = async () => JSON.parse(await readFile(join(ROOT, 'tests/fixtures/catalog-sample.json'), 'utf8'));
export const sampleWall = async () => JSON.parse(await readFile(join(ROOT, 'tests/fixtures/frontend/wall-sample.json'), 'utf8'));
export const config = async (overrides = {}) => {
  const c = await loadConfig(ROOT, {});
  return {...c, ...overrides, site: {...c.site, ...overrides.site}, visitorShelf: {...c.visitorShelf, ...overrides.visitorShelf}, margins: {...c.margins, ...overrides.margins}};
};

export async function buildFixture({catalog, wall, cfg, base = '/library/', siteUrl = 'https://mhmanek.github.io/library', dev = false} = {}) {
  const outDir = await mkdtemp(join(tmpdir(), 'library-site-'));
  const result = await buildSite({catalog: catalog ?? await sample(), wall: wall ?? await sampleWall(), config: cfg ?? await config(), root: ROOT, outDir, base, siteUrl, buildDate: '20261011', dev, coversDir: COVERS});
  const html = await readFile(join(outDir, 'index.html'), 'utf8');
  return {outDir, html, ...result};
}

// Mulberry32: tiny, seeded, good enough for test data.
export function rng(seed = 42) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const WORDS = ('light shadow engine river atlas quiet empire mind theory infinity markets numbers garden machine signal ocean silence '
  + 'history future courage reason chance order chaos memory stars island winter summer letters secret language money power '
  + 'patterns origins questions answers science spirit journey kingdom glass iron paper fire water stone tower bridge city road '
  + 'children mountain forest desert compass method dialogue republic algorithm entropy symmetry fortune harvest frontier').split(' ');
const FIRST = 'Ada Alan Claude Richard Ursula Neal Stanislaw Douglas Peter Nassim Rory Edward Daniel Charlie Walter Ashlee Mary Jane Toni Italo Jorge Haruki Chimamanda Arundhati Vikram'.split(' ');
const LAST = 'Lovelace Turing Shannon Feynman Le Guin Stephenson Lem Hofstadter Thiel Taleb Sutherland Thorp Kahneman Munger Isaacson Vance Shelley Austen Morrison Calvino Borges Murakami Adichie Roy Seth'.split(' ');
const STEMS = ['a1b2c3d4e5f60718', 'b2c3d4e5f6071829', 'c3d4e5f607182930', 'd4e5f60718293041', 'e5f6071829304152', 'f607182930415263', '0718293041526374', '1829304152637485', '2930415263748596'];
const hex = r => '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0');

// A catalog that satisfies validateBooks, shaped like the real one (shelf mix, subtitles, favourites).
export function synthCatalog({read = 170, toRead = 928, dnf = 3, reading = 0, seed = 7} = {}) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
  const words = (lo, hi) => Array.from({length: lo + Math.floor(r() * (hi - lo + 1))}, () => pick(WORDS)).join(' ');
  const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const books = [];
  const slugs = new Set();
  let id = 100000;
  const make = (shelf, i) => {
    id += 1 + Math.floor(r() * 50);
    const title = cap(words(1, 5));
    const author = `${pick(FIRST)} ${pick(LAST)}`;
    let slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${author.split(' ').at(-1).toLowerCase().replace(/[^a-z]+/g, '-')}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slugs.has(slug)) slug += `-${id}`;
    slugs.add(slug);
    const stem = r() < 0.92 ? pick(STEMS) : null;
    const rating = shelf === 'read' ? [5, 5, 4, 4, 4, 3, 2][Math.floor(r() * 7)] : 0;
    const fav = shelf === 'read' && i < 66 ? {tier: i < 20 ? 1 : 2, rank: i < 20 ? i + 1 : null, order: i + 1, position: i < 20 ? i + 1 : i - 19, groupId: slug,
      score: i < 3 ? '11/10' : i < 20 ? '10/10' : null, bylineHtml: author, noteHtml: `${cap(words(18, 70))}. <em>${cap(words(2, 4))}</em> and <a href="https://example.com/${i}" rel="noopener">this essay</a>.`} : null;
    return {
      id: `gr-${id}`, slug, goodreadsId: String(id), title, subtitle: r() < 0.55 ? cap(words(3, 10)) : null, series: r() < 0.08 ? {name: cap(words(1, 2)), index: String(1 + Math.floor(r() * 6))} : null,
      authors: r() < 0.15 ? [author, `${pick(FIRST)} ${pick(LAST)}`] : [author], shelf, rating, avgRating: Math.round((3.4 + r() * 1.2) * 100) / 100,
      pages: r() < 0.93 ? 80 + Math.floor(r() * 900) : null, published: r() < 0.02 ? -Math.floor(r() * 500) : r() < 0.95 ? 1800 + Math.floor(r() * 225) : null,
      dateAdded: `20${15 + Math.floor(r() * 11)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, readAt: null,
      isbn13: null, olWork: null, reviewHtml: null, goodreadsUrl: `https://www.goodreads.com/book/show/${id}`,
      cover: stem ? {stem, src: `covers/${stem}-200.webp`, src2x: `covers/${stem}-400.webp`, w: 400, h: 600, square: false, source: 'goodreads', colors: {bg: hex(r), spine: hex(r), accent: hex(r), ink: '#f1e7d2', bgInk: '#1d1a15'}}
        : {stem: null, src: null, src2x: null, w: 400, h: 600, square: false, source: 'placeholder', colors: {bg: hex(r), spine: hex(r), accent: '#d9b45a', ink: '#f1e7d2', bgInk: '#f1e7d2'}},
      favourite: fav, mergedIds: [],
    };
  };
  for (let i = 0; i < read; i++) books.push(make('read', i));
  for (let i = 0; i < reading; i++) books.push(make('currently-reading', i));
  for (let i = 0; i < dnf; i++) books.push(make('did-not-finish', i));
  for (let i = 0; i < toRead; i++) books.push(make('to-read', i));
  const readBooks = books.filter(b => b.shelf === 'read');
  const hist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0};
  for (const b of readBooks) hist[Math.floor(b.rating)]++;
  const at = iso => iso;
  return {
    version: 1, syncedAt: at('2026-10-11T14:17:03Z'),
    sources: {goodreads: {profileUrl: 'https://www.goodreads.com/user/show/113503174-malhar-manek', changedAt: null, failingSince: null, items: {read, 'currently-reading': reading, 'did-not-finish': dnf, 'to-read': toRead}},
      substack: {postUrl: 'https://www.malharmanek.com/p/books', updatedAt: '2026-05-24T17:04:24.158Z', changedAt: null, failingSince: null}, wall: {changedAt: null, failingSince: null, count: 0}},
    counts: {read, reading, dnf, toRead, favourites: Math.min(66, read), favouritesOnly: 0},
    stats: {
      read: {count: read, rated: read, mean: 4.22, worldMean: 4.1, hist, pages: {total: readBooks.reduce((k, b) => k + (b.pages ?? 0), 0), known: readBooks.filter(b => b.pages).length},
        oldest: {id: readBooks[0].id, year: -385}, longest: {id: readBooks[1].id, pages: 1796}, topAuthors: [{name: readBooks[0].authors[0], count: 3}], crush: {id: readBooks[2].id, delta: 1.32}, harsh: {id: readBooks[3].id, delta: -2.11}, dated: 9},
      toRead: {count: toRead, pages: {total: toRead * 300, known: toRead}, lastAdded: null}, dnf: {count: dnf}, reading: {count: reading},
      favourites: {ranked: 20, more: Math.max(0, Math.min(66, read) - 20), elevens: 3, offGoodreads: 0},
    },
    books,
  };
}
