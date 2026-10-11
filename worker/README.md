# library-recs Worker

A Cloudflare Worker (Workers Free, no card) behind the site's recommend form and Visitor shelf.

| Route | What it does |
|---|---|
| `POST /recommend` | Honeypot and 3 s timer (both get a fake `200`), then field validation, Turnstile `siteverify` (hostname and `remoteip` checked, with an `idempotency_key`), a per-IP throttle of 5 an hour and 20 a day, and duplicate suppression (same title from the same visitor within 10 min). Then it files an issue in the private `mhmanek/library-inbox` with the label `recommendation`. |
| `GET /wall` | The approved recommendations as `{updatedAt, items}`, never with emails. Cached in KV and refreshed from GitHub at most every 15 minutes (≤ 96 KV writes a day of the free 1,000). Serves the stale copy if GitHub fails. `Cache-Control: public, max-age=300`. |
| `GET /health` | `{ok: true}` |
| `OPTIONS` | CORS preflight. Only the origins in `ALLOWED_ORIGINS` are echoed. |

Response shapes and limits are in `docs/CONTRACT.md` ("Visitor shelf"). The pure logic is in `src/lib.js` and the fetch handler in `src/index.js`. There is no build step: wrangler bundles `src/index.js`, including `../src/shared/normalize.js`.

## Test

```sh
cd worker
npm ci
npm test                      # node:test: validation, sanitising, issue/wall mapping, CORS, throttle, full handler on fakes
```

End to end under `wrangler dev` (local mode, no Cloudflare login), against a mock GitHub:

```sh
cp .dev.vars.example .dev.vars              # Turnstile always-pass secret, GITHUB_API -> the mock
node scripts/mock-github.mjs &              # http://127.0.0.1:8788
npx wrangler dev --local --port 8787 --persist-to .wrangler/e2e-state &
node scripts/e2e.mjs                        # health, CORS, issue filed, honeypot, 400, 6th -> 429, /wall without email
```

For the 403 path, set `TURNSTILE_SECRET=2x0000000000000000000000000000000AA` in `.dev.vars`, restart `wrangler dev`, and run `node scripts/e2e.mjs --expect-fail`. Delete `.wrangler/e2e-state` (and restart the mock) for a clean throttle. The test secrets report hostname `example.com`, so `.dev.vars` allows it; production (`wrangler.toml`) does not, so a test-key pass can never be accepted there.

## Deploy (once)

Prerequisites: a Cloudflare account with a workers.dev subdomain, a Turnstile widget (hostname `mhmanek.github.io`, mode Managed), the private repo `mhmanek/library-inbox` with its labels, and a fine-grained PAT (Issues: Read and write on library-inbox only, no expiry).

```sh
cd worker
npx wrangler login
npx wrangler kv namespace create RECS       # prints an id
#   paste it into wrangler.toml: [[kv_namespaces]] id = "..."
npx wrangler deploy                         # prints https://library-recs.<subdomain>.workers.dev
```

Secrets go in the dashboard (Workers → library-recs → Settings → Variables and Secrets → add as **Secret**), which keeps them out of the terminal and the repo:

- `GITHUB_TOKEN`: the fine-grained PAT
- `TURNSTILE_SECRET`: the Turnstile widget's secret key

(Or `npx wrangler secret put GITHUB_TOKEN` and `npx wrangler secret put TURNSTILE_SECRET`, which prompt for the value.)

Then set `visitorShelf.workerUrl` (no trailing slash) and `visitorShelf.turnstileSiteKey` in the root `config.json` and push.

## Smoke test after deploy

```sh
W=https://library-recs.<subdomain>.workers.dev
curl -s $W/health                                                  # {"ok":true}
curl -s -i $W/wall | grep -iE '^(HTTP|cache-control)'              # 200, public, max-age=300
curl -s -i -X OPTIONS $W/recommend -H 'Origin: https://mhmanek.github.io' | grep -i access-control-allow-origin
curl -s -X POST $W/recommend -H 'Content-Type: application/json' \
  -d '{"title":"Smoke test","t":9000,"website":"","turnstileToken":"x"}'          # {"ok":false,"error":"turnstile"}: the real secret rejects fake tokens
curl -s -X POST $W/recommend -H 'Content-Type: application/json' \
  -d '{"title":"Smoke test","t":9000,"website":"bot"}'                           # {"ok":true}: honeypot, nothing filed
```

The real path (a token from the live widget) can only be checked from the site. Send one recommendation, confirm the issue and bot comment arrive in library-inbox, add `approved`, check `$W/wall` within 15 minutes, and then close the test issue.

## Notes

- `GITHUB_API` is overridable only so tests and `wrangler dev` can point at a mock. Leave it as `https://api.github.com` in production.
- Every GitHub call sends `User-Agent: mhmanek-library-recs/1.0`; GitHub rejects REST calls without one.
- Upstream failures (GitHub or siteverify) are a `502 {error: "upstream"}`, and the form then shows its mailto fallback. Some school and office networks block `*.workers.dev` entirely, and the fallback covers that too.
- KV is eventually consistent. Two submissions within the same second from different Cloudflare locations could both slip past the throttle. Turnstile is the real gate; the throttle only caps volume.
- Logs (enabled in `[observability]`) carry statuses and error names only: never tokens, request bodies, IPs or stacks.
