import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, clean, cap, validate, isBot, settings, turnstileOk, neutralise, issueTitle, issueBody, parseBlock,
  wallItem, mapWall, dayIn, corsHeaders, ipKey, titleKey, throttle, recordAttempt, HOUR, DAY,
} from '../src/lib.js';
import {validateWall} from '../../lib/schema.mjs';

const good = {title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', olWork: 'OL2010879W', coverId: '8231856', year: '1979',
  note: 'The strange loop.', name: 'Priya', email: 'priya@example.org', website: '', t: 9000, turnstileToken: 'tok'};

test('clean: one line, NFC, no controls or bidi tricks, ZWJ kept', () => {
  assert.equal(clean('  a\n\tb  '), 'a b');
  assert.equal(clean('é'), 'é');
  assert.equal(clean('evil‮txt.exe​­'), 'eviltxt.exe');
  assert.equal(clean('\u0000x\u0007y\u009f'), 'xy');
  assert.equal(clean('क्‍ष'), 'क्‍ष');
  assert.equal(clean('\ud800lone'), '�lone');
  assert.equal(clean(null), '');
  assert.equal(clean(42), '42');
  assert.equal(clean({}), null);
  assert.equal(clean(['x']), null);
});

test('cap: never splits a surrogate pair and stays within max', () => {
  assert.equal(cap('short', 10), 'short');
  const s = '📚'.repeat(10);
  const c = cap(s, 7);
  assert.ok(c.length <= 7);
  assert.equal(c, '📚📚📚…');
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(c));
});

test('validate: accepts a full rec and coerces hidden-field strings', () => {
  const {ok, fields, rec} = validate(good);
  assert.ok(ok, fields.join());
  assert.deepEqual(rec, {title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', note: 'The strange loop.', name: 'Priya',
    olWork: 'OL2010879W', coverId: 8231856, year: 1979, email: 'priya@example.org'});
});

test('validate: minimal rec is just a title', () => {
  const {ok, rec} = validate({title: 'Dune'});
  assert.ok(ok);
  assert.deepEqual(rec, {title: 'Dune', author: '', note: '', name: '', olWork: null, coverId: null, year: null, email: null});
  assert.equal(validate({title: 'Republic', year: -385}).rec.year, -385);
  assert.equal(validate({title: 'X', year: 0}).rec.year, null);
  assert.equal(validate({title: 'X', olWork: '/works/OL45883W'}).rec.olWork, 'OL45883W');
});

test('validate: names every bad field', () => {
  const r = validate({title: '  ', author: 'a'.repeat(121), note: 'n'.repeat(281), name: {x: 1}, olWork: 'OL1M', coverId: -3, year: 99999, email: 'nope'});
  assert.equal(r.ok, false);
  assert.deepEqual(r.fields.sort(), ['author', 'coverId', 'email', 'name', 'note', 'olWork', 'title', 'year']);
  assert.deepEqual(validate({title: 't'.repeat(LIMITS.title)}).fields, []);
  assert.deepEqual(validate({title: 't'.repeat(LIMITS.title + 1)}).fields, ['title']);
  assert.deepEqual(validate({title: 'x', coverId: 1.5}).fields, ['coverId']);
  assert.deepEqual(validate({title: 'x', coverId: '12abc'}).fields, ['coverId']);
});

test('validate: link spam', () => {
  assert.deepEqual(validate({title: 'Buy now https://spam.example'}).fields, ['title']);
  assert.deepEqual(validate({title: 'ok', name: 'www.casino.example'}).fields, ['name']);
  assert.deepEqual(validate({title: 'ok', author: 'a', name: 'b', note: 'see https://a.example and https://b.example'}).fields, []);
  assert.deepEqual(validate({title: 'ok', note: 'http://a.x http://b.x http://c.x'}).fields, ['note']);
  // Repeated calls must not be affected by regex lastIndex state.
  for (let i = 0; i < 3; i++) assert.deepEqual(validate({title: 'ok', name: 'http://x.example'}).fields, ['name']);
});

test('isBot: honeypot and the 3 s timer', () => {
  assert.equal(isBot(good), false);
  assert.equal(isBot({...good, website: 'http://spam'}), true);
  assert.equal(isBot({...good, website: '   '}), false);
  assert.equal(isBot({...good, website: 1}), true);
  assert.equal(isBot({...good, t: 2999}), true);
  assert.equal(isBot({...good, t: '3000'}), false);
  assert.equal(isBot({...good, t: undefined}), true);
  assert.equal(isBot({...good, t: 'soon'}), true);
});

test('settings and turnstileOk', () => {
  const cfg = settings({ALLOWED_ORIGINS: 'https://mhmanek.github.io, http://localhost:8080', TURNSTILE_HOSTNAMES: 'MHMANEK.github.io,localhost',
    INBOX_REPO: 'mhmanek/library-inbox', GITHUB_API: 'http://127.0.0.1:8788/'});
  assert.deepEqual(cfg.origins, ['https://mhmanek.github.io', 'http://localhost:8080']);
  assert.equal(cfg.api, 'http://127.0.0.1:8788');
  assert.equal(settings({INBOX_REPO: '../evil'}).repo, null);
  assert.equal(settings({INBOX_REPO: 'mhmanek/..'}).repo, null);
  assert.equal(settings({INBOX_REPO: 'mhmanek/library-inbox/issues'}).repo, null);
  assert.equal(settings({INBOX_REPO: 'mhmanek/.github'}).repo, 'mhmanek/.github');
  assert.equal(settings({}).api, 'https://api.github.com');
  assert.ok(turnstileOk({success: true, hostname: 'mhmanek.github.io', action: 'recommend'}, cfg.hostnames));
  assert.ok(turnstileOk({success: true, hostname: 'localhost', action: ''}, cfg.hostnames));
  assert.ok(!turnstileOk({success: true, hostname: 'example.com'}, cfg.hostnames), 'test keys never pass in production');
  assert.ok(!turnstileOk({success: true, hostname: 'mhmanek.github.io', action: 'login'}, cfg.hostnames));
  assert.ok(!turnstileOk({success: 'true', hostname: 'localhost'}, cfg.hostnames));
  assert.ok(!turnstileOk(null, cfg.hostnames));
});

test('issue title: neutralised, one line, capped', () => {
  assert.equal(issueTitle({title: 'C# in Depth', author: '@torvalds fixes #1'}), '📚 C＃ in Depth — ＠torvalds fixes ＃1');
  assert.equal(issueTitle({title: 'Dune', author: ''}), '📚 Dune');
  assert.equal(issueTitle({title: 'a\nb‮', author: 'c'}), '📚 a b — c');
  const long = issueTitle({title: 'x'.repeat(200), author: 'y'.repeat(120)});
  assert.ok(long.length <= LIMITS.issueTitle && long.endsWith('…'));
  assert.equal(neutralise('@a #b'), '＠a ＃b');
});

test('issue body: explains moderation, fenced JSON round-trips, backticks cannot close the fence', () => {
  const rec = validate({...good, note: 'try ``` this\n```\n@everyone #1 <img src=x onerror=alert(1)>'}).rec;
  const body = issueBody(rec, '2026-10-11T12:00:00.000Z');
  assert.match(body, /add the `approved` label/);
  assert.match(body, /`spam`/);
  assert.equal(body.match(/```/g).length, 2, 'only the opening and closing fence');
  const data = parseBlock(body);
  assert.equal(data.note, rec.note);
  assert.equal(data.email, 'priya@example.org');
  assert.equal(data.submittedAt, '2026-10-11T12:00:00.000Z');
  assert.equal(data.v, 1);
  // Outside the fence the body is fixed text: no visitor field appears there.
  const outside = body.replace(/```json[\s\S]*```/, '');
  for (const v of [rec.title, rec.note, rec.name, rec.email]) assert.ok(!outside.includes(v));
});

test('parseBlock: tolerates CRLF edits, rejects junk', () => {
  assert.deepEqual(parseBlock('x\r\n```json\r\n{"title":"A"}\r\n```\r\n'), {title: 'A'});
  assert.equal(parseBlock('no block'), null);
  assert.equal(parseBlock('```json\n{broken\n```'), null);
  assert.equal(parseBlock('```json\n[1,2]\n```'), null);
  assert.equal(parseBlock(null), null);
});

const issue = (number, data, extra = {}) => ({number, labels: [{name: 'recommendation'}, {name: 'approved'}],
  created_at: '2026-10-03T15:00:00Z', body: issueBody(validate({title: 'T', ...data}).rec, '2026-10-03T15:00:00Z'), ...extra});

test('wallItem: explicit fields only, never email', () => {
  const item = wallItem(issue(17, good), 'America/Chicago');
  assert.deepEqual(item, {id: '17', title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', olWork: 'OL2010879W', coverId: 8231856,
    year: 1979, name: 'Priya', note: 'The strange loop.', date: '2026-10-03'});
  assert.ok(!JSON.stringify(item).includes('priya@example.org'));
  assert.ok(!('email' in item));
});

test('wallItem: skips unapproved, spam, PRs and malformed bodies; caps hand-edited fields', () => {
  assert.equal(wallItem(issue(1, good, {labels: [{name: 'recommendation'}]})), null);
  assert.equal(wallItem(issue(1, good, {labels: ['approved', 'spam']})), null);
  assert.equal(wallItem(issue(1, good, {pull_request: {}})), null);
  assert.equal(wallItem(issue(1, good, {body: 'hello'})), null);
  assert.equal(wallItem(issue(1, good, {created_at: 'yesterday'})), null);
  assert.equal(wallItem({...issue(1, good), number: '1'}), null);
  assert.equal(wallItem(issue(1, good, {body: '```json\n{"title": ""}\n```'})), null);
  assert.equal(wallItem(issue(1, good, {labels: null})), null);
  const edited = wallItem(issue(2, good, {labels: ['approved'],
    body: '```json\n' + JSON.stringify({title: 'x'.repeat(500), author: 7, name: 'n'.repeat(99), note: '<b>hi</b>\n\nthere', olWork: 'junk', coverId: 'NaN', year: 0, email: 'a@b.co'}) + '\n```'}));
  assert.equal(edited.title.length, LIMITS.title);
  assert.equal(edited.author, '');
  assert.equal(edited.name.length, LIMITS.name);
  assert.equal(edited.note, '<b>hi</b> there', 'plain text: the site escapes it');
  assert.equal(edited.olWork, null);
  assert.equal(edited.coverId, null);
  assert.equal(edited.year, null);
  assert.ok(!('email' in edited));
});

test('dayIn: calendar day in the configured zone', () => {
  assert.equal(dayIn('2026-10-04T03:00:00Z', 'America/Chicago'), '2026-10-03');
  assert.equal(dayIn('2026-10-04T03:00:00Z', 'UTC'), '2026-10-04');
  assert.equal(dayIn('2026-10-04T03:00:00Z', 'Not/AZone'), '2026-10-04');
});

test('mapWall: date desc then id desc, deduped, max 200, contract-valid', () => {
  const issues = [
    issue(3, {title: 'C'}, {created_at: '2026-10-01T12:00:00Z'}),
    issue(5, {title: 'E'}, {created_at: '2026-10-02T12:00:00Z'}),
    issue(9, {title: 'I'}, {created_at: '2026-10-01T13:00:00Z'}),
    issue(10, {title: 'J'}, {created_at: '2026-10-01T14:00:00Z'}),
    issue(5, {title: 'E again'}, {created_at: '2026-10-02T12:00:00Z'}),
    {number: 11, labels: ['approved'], body: 'broken', created_at: '2026-10-05T00:00:00Z'},
  ];
  const items = mapWall(issues, 'UTC');
  assert.deepEqual(items.map(i => i.id), ['5', '10', '9', '3']);
  assert.deepEqual(validateWall({items}), []);
  const many = Array.from({length: 250}, (_, i) => issue(i + 1, {...good, title: `B${i}`}));
  const capped = mapWall(many, 'UTC');
  assert.equal(capped.length, 200);
  assert.equal(capped[0].id, '250');
  assert.deepEqual(validateWall({items: capped}), []);
  assert.ok(!JSON.stringify(capped).includes('@example.org'));
});

test('corsHeaders: echoes only allowed origins, always varies', () => {
  const allowed = ['https://mhmanek.github.io', 'http://localhost:8080'];
  assert.deepEqual(corsHeaders('https://mhmanek.github.io', allowed), {
    'Vary': 'Origin', 'Access-Control-Allow-Origin': 'https://mhmanek.github.io', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'});
  assert.deepEqual(corsHeaders('https://evil.example', allowed), {'Vary': 'Origin'});
  assert.deepEqual(corsHeaders('https://mhmanek.github.io.evil.example', allowed), {'Vary': 'Origin'});
  assert.deepEqual(corsHeaders(null, allowed), {'Vary': 'Origin'});
});

test('ipKey: salted, stable, not the raw IP', async () => {
  const a = await ipKey('203.0.113.7', 's1');
  assert.equal(a, await ipKey('203.0.113.7', 's1'));
  assert.notEqual(a, await ipKey('203.0.113.7', 's2'));
  assert.notEqual(a, await ipKey('203.0.113.8', 's1'));
  assert.match(a, /^ip:[0-9a-f]{40}$/);
  assert.ok(!a.includes('203'));
  assert.equal(await titleKey('The Black Swan'), await titleKey('the  black swan!'));
});

test('throttle: 5 an hour, 20 a day, duplicates within 10 minutes', () => {
  const now = 1_800_000_000;
  let rec = null;
  for (let i = 0; i < 5; i++) {
    const v = throttle(rec, now + i, `k${i}`);
    assert.equal(v.retryAfter, undefined);
    rec = recordAttempt(v.record, now + i, `k${i}`, true);
  }
  const sixth = throttle(rec, now + 10, 'k6');
  assert.equal(sixth.retryAfter, HOUR - 10);
  assert.equal(throttle(rec, now + HOUR + 1, 'k6').retryAfter, undefined, 'the hour window slides');
  assert.equal(throttle(rec, now + 60, 'k0').retryAfter, HOUR - 60);

  assert.equal(throttle({t: [now], d: [['dup', now]]}, now + 599, 'dup').duplicate, true);
  assert.equal(throttle({t: [now], d: [['dup', now]]}, now + 601, 'dup').duplicate, false);
  assert.equal(throttle({t: [now], d: [['dup', now]]}, now + 5, 'other').duplicate, false);

  // 20 spread over the day: the daily cap bites even though the last hour is quiet.
  const day = {t: Array.from({length: 20}, (_, i) => now - DAY + 100 + i * 3000), d: []};
  const v = throttle(day, now, 'x');
  assert.equal(v.retryAfter, 100);
  // Junk in KV is ignored rather than trusted.
  assert.deepEqual(throttle({t: 'x', d: [1, [2]]}, now, 'k').record, {t: [], d: []});
  assert.deepEqual(throttle({t: [now + 50, NaN, now - DAY - 1]}, now, 'k').record.t, []);
});
