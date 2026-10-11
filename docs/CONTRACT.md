# Contract between the subsystems

This file is the single source of truth where the design notes (`.cache/design/pipeline.md`, `.cache/design/frontend.md`) disagree. Everything here is decided; the design notes fill in details.

## Who owns what

| Area | Owner | Files |
|---|---|---|
| Shared contract (do not change without updating this file) | scaffold | `lib/config.mjs`, `lib/json.mjs`, `lib/color-math.mjs`, `lib/schema.mjs`, `src/shared/normalize.js`, `src/shared/match.js`, `config.json`, `package.json`, `docs/CONTRACT.md`, `tests/fixtures/catalog-sample.json` |
| Data pipeline | pipeline | `lib/*` (everything else), `scripts/sync.mjs`, `scripts/build.mjs`, `scripts/explain.mjs`, `scripts/lookup.mjs`, `data/manual/*`, `tests/pipeline/**`, `tests/fixtures/pipeline/**`, `.github/workflows/sync.yml` |
| Website | frontend | `src/**` (except `src/shared/*`), `scripts/check-site.mjs`, `scripts/serve.mjs`, `scripts/fetch-fonts.mjs`, `tests/frontend/**`, `tests/fixtures/frontend/**` |
| Recommendations | worker | `worker/**`, and the separate local repo `C:\Users\malha\code\library-inbox\**` |

Tests: root `npm test` runs `tests/**/*.test.mjs` (node:test). The Worker has its own `worker/package.json` and `worker/test/`.

## Build interface

- `lib/catalog.mjs` (pipeline): `loadData(root) -> Promise<Data>` and `buildCatalog(data, config) -> Catalog`, pure and offline. `Catalog` is exactly the `books.json` object below.
- `src/build/site.mjs` (frontend): `buildSite({catalog, wall, config, root, outDir, base, siteUrl, buildDate, dev}) -> Promise<{files, report}>`. It writes **everything** under `outDir` (default `site/`): `index.html`, `404.html`, `data/books.json`, `data/match.json`, `data/wall.json`, the referenced covers copied from `root/covers/`, CSS/JS/fonts/favicons/og.png.
  - `wall` is the parsed `data/wall.json` (`{items: []}` when absent).
  - `base` is the URL path prefix with leading and trailing slash (`/library/`, or `/` on a custom domain). `siteUrl` has no trailing slash. `buildDate` is `YYYYMMDD` (UTC).
- `scripts/build.mjs` (pipeline) exports `build({root, out, base, siteUrl, dev, now})` and runs it when invoked directly: `node scripts/build.mjs [--base /library/] [--site-url URL] [--out site] [--dev] [--now ISO]`. It calls `loadConfig`, `loadData`, `buildCatalog`, reads `data/wall.json`, then `buildSite`. CI passes `--base "$BASE_PATH/"` and `--site-url "$BASE_URL"` from actions/configure-pages.
- `scripts/serve.mjs` (frontend) imports `build` from `scripts/build.mjs`. Until the pipeline exists it can build from `tests/fixtures/catalog-sample.json` with `--fixture`.

## URLs

- **No `<base>` element.** `index.html` uses relative URLs only (`covers/…`, `assets/…`, `#book/<slug>`), so `/library/` and a future `books.malharmanek.com/` both work with no code change.
- `base` and `siteUrl` are used only for `404.html` (which can be served at any depth, so it uses `${base}assets/…`), `<link rel=canonical>`, `og:url` and `og:image`.

## books.json (`Catalog`)

```
{
  version: 1,
  syncedAt: ISO-8601 UTC | null,        // last time published data changed (from data/sync.json), not last check
  sources: {
    goodreads: {profileUrl, changedAt: ISO|null, failingSince: ISO|null,
                items: {"read": n, "currently-reading": n, "did-not-finish": n, "to-read": n}},   // raw feed counts
    substack:  {postUrl, updatedAt: ISO|null /*post's updated_at*/, changedAt: ISO|null, failingSince: ISO|null},
    wall:      {changedAt: ISO|null, failingSince: ISO|null, count: n}
  },
  counts: {read, reading, dnf, toRead, favourites, favouritesOnly},   // distinct books after merging editions
  stats: Stats,
  books: Book[]   // sorted: shelf read, currently-reading, did-not-finish, to-read, then null (favourites-only);
                  // then dateAdded desc (nulls last); then sortKey(title); then id
}

Book = {
  id: "gr-<digits>" | "fav-<slug>",
  slug: "[a-z0-9-]+", unique; ASCII slug(shortTitle(title)) + "-" + slug(familyName(authors[0])) (e.g. "the-left-hand-of-darkness-le-guin"); a title with no Latin letters becomes "book-<id>"; on collision the oldest Goodreads id keeps the plain slug and later ones append "-" + goodreadsId (or "-2", "-3")
  goodreadsId: "<digits>" | null,
  title: string, subtitle: string | null, series: {name: string, index: string | null} | null,
  authors: string[] (≥ 1, whitespace collapsed, primary first),
  shelf: "read" | "currently-reading" | "did-not-finish" | "to-read" | null,   // null only for fav- entries
  rating: number,            // his rating; 0 = unrated; may be a quarter step (4.25)
  avgRating: number | null,  // Goodreads world average, 2 dp
  pages: integer | null,     // null when 0, missing or implausible (< 40) unless Open Library's median (≥ 40) fills it
  published: integer | null, // year; negative = BCE (-385 is Plato); 0 -> null
  dateAdded: "YYYY-MM-DD" | null,  // literal Goodreads user_date_added (earliest across merged editions)
  readAt: "YYYY-MM-DD" | null,     // literal Goodreads user_read_at (latest across merged editions)
  isbn13: string | null, olWork: "OL123W" | null,
  reviewHtml: string | null, // sanitised (allowlist below); null when it duplicates the favourite note
  goodreadsUrl: "https://www.goodreads.com/book/show/<id>" | null,
  cover: {
    stem: string | null,                       // content-hash stem; null for placeholders
    src: "covers/<stem>-200.webp" | null,      // relative to the site root
    src2x: "covers/<stem>-400.webp" | null,
    w: integer, h: integer,                    // pixel size of the 400-wide file (placeholder: 400 x 600)
    square: boolean,                           // audiobook-style square art
    source: "override" | "substack" | "goodreads" | "openlibrary" | "placeholder",
    colors: {bg, spine, accent, ink, bgInk}    // "#rrggbb" lowercase, raw from the cover (not harmonised);
                                               // ink = text colour on spine, bgInk = text colour on bg
  },
  favourite: {
    tier: 1 | 2, rank: integer | null /*tier 1 only*/, order: integer /*1-based across the whole post*/,
    position: integer /*1-based within its tier*/, groupId: string /*shared by books from one <li>*/,  // order and position are per <li>, so both Elon Musk biographies share them
    score: "11/10" | "10/10" | null, bylineHtml: string, noteHtml: string     // both sanitised
  } | null,
  mergedIds: string[]   // the other Goodreads ids merged into this book, numeric order
}

Stats = {
  read: {count, rated, mean, worldMean /*2 dp, or null*/, hist: {"5": n, "4": n, "3": n, "2": n, "1": n} /*floor of rating; unrated excluded*/,
         pages: {total, known}, oldest: {id, year} | null /*Goodreads years only*/, longest: {id, pages} | null,
         topAuthors: [{name, count}] /*count ≥ 2, top 5*/, crush: {id, delta} | null /*largest rating − avgRating > 0*/,
         harsh: {id, delta} | null /*most negative*/, dated /*books with readAt*/},
  toRead: {count, pages: {total, known}, lastAdded: {id, date} | null},
  dnf: {count}, reading: {count},
  favourites: {ranked, more, elevens, offGoodreads}
}
```

Read stats use `shelf === "read"` books only (never `fav-` entries). There are deliberately no year or read-timeline fields: only 9 of 169 read books have a read date.

**Sanitised HTML** (`noteHtml`, `bylineHtml`, `reviewHtml`) contains only `a[href^="https:"|"mailto:"]` (with `rel="noopener"`), `em`, `strong`, `br`, and, in block mode (`noteHtml`, `reviewHtml`), `p` and `blockquote`. `buildCatalog` guarantees this, so templates may insert these fields raw. Everything else is escaped.

## Visitor shelf

- Committed `data/wall.json` (written by sync, no timestamps): `{"items": [WallItem]}` sorted by `date` desc then `id` desc, at most 200.
- `WallItem = {id: "<issue number>", title, author, olWork: "OL…W" | null, coverId: integer | null, year: integer | null, name, note, date: "YYYY-MM-DD"}`. All strings are plain text (never HTML), `author`/`name`/`note` may be empty strings. Limits: title 200, author 120, name 40, note 280. **Never an email.**
- Worker `GET {workerUrl}/wall` -> `200 {updatedAt: ISO, items: WallItem[]}` with `Cache-Control: public, max-age=300`.
- Worker `POST {workerUrl}/recommend`, `Content-Type: application/json`, body
  `{title, author, olWork, coverId, year, note, name, email, website /*honeypot, must be empty*/, t /*ms since the form appeared*/, turnstileToken}`.
  Responses: `200 {ok: true}`; `400 {ok: false, error: "invalid", fields: [..]}`; `403 {ok: false, error: "turnstile"}`; `429 {ok: false, error: "rate_limited", retryAfter: seconds}`; `502 {ok: false, error: "upstream"}`; `500 {ok: false, error: "server"}`.
  A filled honeypot, `t < 3000`, or the same title from the same visitor within 10 minutes gets a fake `200 {ok: true}`. A missing/wrong Content-Type, malformed JSON or a body over 8 KB is `400 {error: "invalid", fields: ["body"]}` (show a general error). Unknown paths `404 {error: "not_found"}`, wrong methods `405 {error: "method"}`. `WallItem.date` is the issue's creation day in America/Chicago.
- CORS: the Worker echoes an allowed `Origin` (`https://mhmanek.github.io`, `http://localhost:8080`), `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Max-Age: 86400`, `Vary: Origin`. `GET /health` -> `{ok: true}`.
- Covers for visitor recs are Open Library thumbnails hotlinked by the browser: `https://covers.openlibrary.org/b/id/{coverId}-M.jpg`.

## match.json (site build output, used by the recommend form)

`[{i: slug, s: shelf | null, r: rating, f: "1:3" | "2:" | null /*tier:rank*/, ol: olWork | null, t: shortTitle(title), a: surnames(authors)}]`, using `src/shared/normalize.js`. `findInIndex()` in `src/shared/match.js` searches it.

## config.json

Shape and validation live in `lib/config.mjs` (`loadConfig(root, env)`). Key fields: `site {title, url, base, repo, email, substack, timezone}`, `goodreads {userId, ownerName, shelves, perPage, maxPages, sort}`, `substack {api[], postUrl}`, `margins {userId | null}`, `visitorShelf {workerUrl | null, turnstileSiteKey | null}`, `sync {...}`. Dev overrides: `LIBRARY_WORKER_URL`, `LIBRARY_TURNSTILE_SITEKEY`. The site renders the recommend form only when both `workerUrl` and `turnstileSiteKey` are set (dev may use the Turnstile test key `1x00000000000000000000AA`); otherwise it shows the mailto postcard.
