# Malhar's Library

My favourite books, at **https://mhmanek.github.io/library/**. It rebuilds itself: once a day a GitHub Action reads my Goodreads shelves and the favourites post on my Substack, [Mr Philomath](https://www.malharmanek.com/p/books), commits whatever changed and redeploys the site. Visitors can recommend a book; it reaches me privately and goes on the Visitor shelf only once I approve it.

## What I do day to day

- **Log books on Goodreads.** The site doesn't show my shelves, but it still reads all four: they give the favourites their ratings, dates and Goodreads links, and let the recommend form and the visitor postcards say whether I've read a book already. Margins has no export or API (and its Terms forbid scraping), so Goodreads is the source; Margins can re-import from Goodreads whenever I like.
- **Edit the Substack post** to change the Favourites: the ranked list above the line is the podium and plates, the list below it is "And more". My blurbs and links come through as written.
- **Approve recommendations.** Each one arrives as an issue in the private repo `mhmanek/library-inbox` and GitHub emails me. Label it `approved` to shelve it (it appears within about 15 minutes), `spam` to bin it.

Updates are not instant: GitHub's schedules often start hours late. To refresh now: **Actions → Sync and deploy → Run workflow**, or `gh workflow run sync.yml -R mhmanek/library`.

## How it works

```
Goodreads RSS (4 shelves) ─┐
Substack favourites JSON  ─┼─► .github/workflows/sync.yml (daily, on push, on demand)
Worker GET /wall          ─┘    sync → commit data/ + covers/ if changed → build → deploy Pages
Open Library (new books only)

Recommend form ─► Cloudflare Worker (worker/, Turnstile + throttle) ─► issue in mhmanek/library-inbox
```

- `scripts/sync.mjs` is the only code that touches the network. Each source is validated and keeps its last good copy if it fails; the committed files in `data/` are deterministic, so a commit means a real change.
- `scripts/build.mjs` turns `data/`, `covers/` and `src/` into `site/` offline. The page is plain HTML and CSS that works without JavaScript; the scripts add the library card, the recommend form and the live Visitor shelf.
- `docs/CONTRACT.md` is the data contract between the parts. `worker/README.md` covers the recommendation Worker.

## Commands

PowerShell uses `npm.cmd`; Git Bash uses `npm`.

| Command | Does |
|---|---|
| `npm.cmd test` | All tests (no network) |
| `node scripts/sync.mjs --dry-run` | Fetch and validate everything, report what would change, write nothing |
| `node scripts/sync.mjs` | Real sync (`--allow-drop` if I removed many books on purpose, `--refresh` to retry failed covers and Open Library misses) |
| `npm.cmd run dev` | Local site at http://localhost:8080/library/ with a mock Worker |
| `node scripts/explain.mjs "black swan"` | Why a book looks as it does: merges, favourite match, cover choice |
| `node scripts/lookup.mjs "Title" "Author"` | Open Library ISBN and cover candidates |

Hand-edited files: `data/manual/favourites-map.json` (pins Substack titles to Goodreads ids, and lists favourites not on Goodreads) and `data/manual/overrides.json` (`covers`, `sameWork`, `differentWork`, `hide`). Everything else in `data/` is written by the sync.

## When something goes wrong

The site always keeps the last good data and says in its footer if a source is stale. The run fails, and GitHub emails me, only after a source has been failing for a while (Goodreads 12 h, visitor shelf 24 h, Substack 72 h), then at most weekly.

| Error code in the run summary | Meaning and fix |
|---|---|
| `http-403`, `not-rss`, `network` | Goodreads refused or broke. Usually transient; if it lasts, check the profile and shelves are still public. |
| `channel-title`, `shelf-mismatch` | Goodreads changed its feed format; the parser needs a look. |
| `drop` | A shelf shrank by more than 20%. If I meant it, run the workflow with `allow_drop` ticked. |
| `favourites-structure` | The Substack post no longer parses (for example the line between the two lists is gone). |
| `wall-*` | The Worker is down or misconfigured; the baked-in Visitor shelf still shows. |

**Scheduled runs stop after 60 days without repository activity** (a GitHub rule for public repos). Everyday changes on Goodreads produce real data commits that keep it alive. If GitHub ever emails that the workflow was disabled: `gh workflow enable sync.yml -R mhmanek/library`.

## Custom domain (later)

To move to `books.malharmanek.com`: Settings → Pages → Custom domain, then a CNAME record `books → mhmanek.github.io` at the DNS host (clutch.co.in), then Enforce HTTPS. All page URLs are relative, so no code changes; add the hostname to the Turnstile widget and to `ALLOWED_ORIGINS` and `TURNSTILE_HOSTNAMES` in `worker/wrangler.toml`.

Covers are shown small, for identification, from Goodreads and Open Library; ask and I'll take one down.
