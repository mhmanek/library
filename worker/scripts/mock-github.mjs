// Local stand-in for api.github.com so `wrangler dev` never touches the real inbox.
//   node scripts/mock-github.mjs [--port 8788] [--token dev-token-not-real]
// GET /_mock/issues dumps everything it received (emails included: it is a local mock).
import http from 'node:http';
import {fakeGitHub} from './fakes.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const port = Number(arg('port', 8788));
const gh = fakeGitHub({repo: arg('repo', 'mhmanek/library-inbox'), token: arg('token', 'dev-token-not-real')});

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.url === '/_mock/issues') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({issues: gh.issues, requests: gh.requests.length}));
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body});
  const response = await gh.handle(request);
  if (req.method === 'POST' && response.status === 201) console.log(`mock-github: issue #${gh.issues.length} ${gh.issues.at(-1).title}`);
  else console.log(`mock-github: ${req.method} ${req.url} -> ${response.status}`);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(port, '127.0.0.1', () => console.log(`mock-github listening on http://127.0.0.1:${port}`));
