// ISBN maths and the HTML toolkit (entities, tree parser, allowlist sanitizer).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanIsbn, isValidIsbn10, isValidIsbn13, isbn10to13, isbn13to10, isbnPair} from '../../lib/isbn.mjs';
import {decodeEntities, parseFragment, textContent, sanitize, htmlToText} from '../../lib/html.mjs';
import {unsafeHtml} from '../../lib/schema.mjs';

test('ISBN-10 and ISBN-13 checksums and conversions', () => {
  for (const [a, b] of [['0465026567', '9780465026562'], ['0441014151', '9780441014156'], ['0306406152', '9780306406157'], ['080442957X', '9780804429573']]) {
    assert.ok(isValidIsbn10(a), a);
    assert.ok(isValidIsbn13(b), b);
    assert.equal(isbn10to13(a), b);
    assert.equal(isbn13to10(b), a);
  }
  assert.equal(isbn13to10('9791034304559'), null, '979 has no ISBN-10');
  assert.equal(cleanIsbn(' 0-306-40615-2 '), '0306406152');
  assert.deepEqual(isbnPair('0-306-40615-2'), {isbn10: '0306406152', isbn13: '9780306406157'});
  assert.deepEqual(isbnPair('0306406153'), {isbn10: null, isbn13: null}, 'bad checksum is never guessed');
  assert.deepEqual(isbnPair(''), {isbn10: null, isbn13: null});
  assert.deepEqual(isbnPair('9780465026562'), {isbn10: '0465026567', isbn13: '9780465026562'});
  assert.equal(isValidIsbn13('9780465026563'), false);
  assert.equal(isbn10to13('080442957x'), '9780804429573', 'lowercase x is accepted');
});

test('decodeEntities: numeric, named, composed accents; unknown names pass through', () => {
  assert.equal(decodeEntities('Invent &amp; Wander'), 'Invent & Wander');
  assert.equal(decodeEntities('&#8217;&#x2019;&rsquo;'), '’’’');
  assert.equal(decodeEntities('G&ouml;del &Eacute;cole &ccedil;a'), 'Gödel École ça');
  assert.equal(decodeEntities('&bogus; &#0;'), '&bogus; �');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;', 'decodes once');
});

test('parseFragment copes with void elements, unclosed tags and stray closers', () => {
  const root = parseFragment('<p>a<br>b<img src=x></p></span><p>c<p>d<ul><li>1<li>2</ul>');
  const tags = root.children.map(n => n.tag);
  assert.deepEqual(tags, ['p', 'p', 'p', 'ul']);
  assert.equal(textContent(root.children[0]), 'a\nb');
  assert.equal(root.children[3].children.length, 2, 'li closes the previous li');
  const attrs = parseFragment('<img data-attrs="{&quot;src&quot;:&quot;https://x/y.jpg&quot;,&quot;w&quot;:1}" alt=\'a > b\'>').children[0].attrs;
  assert.equal(JSON.parse(attrs['data-attrs']).src, 'https://x/y.jpg');
  assert.equal(attrs.alt, 'a > b');
  assert.equal(textContent(parseFragment('<script>if (a < b) {}</script>ok')), 'if (a < b) {}ok', 'script is raw text');
});

test('sanitize: allowlist only, dangerous content dropped, links made safe', () => {
  const dirty = '<p onclick="x()">Hi <b>bold</b> <i>it</i> <script>alert(1)</script><style>p{}</style>' +
    '<a href="javascript:alert(1)">js</a> <a href=" HTTPS://Ok.org/a?b=1&amp;c=2 " target="_blank" rel="nofollow">ok</a> ' +
    '<a href="http://insecure.org">plain</a> <a href="mailto:m@x.org">mail</a> <span style="x">span</span>' +
    '<iframe src="https://evil"></iframe><svg><a href="https://x">svg</a></svg><br /><br/>end &lt;tag&gt; javascript: text</p>';
  const out = sanitize(dirty, {block: true});
  assert.equal(out, '<p>Hi <strong>bold</strong> <em>it</em> js <a href="https://Ok.org/a?b=1&amp;c=2" rel="noopener">ok</a> plain ' +
    '<a href="mailto:m@x.org" rel="noopener">mail</a> span<br><br>end &lt;tag&gt; javascript&#58; text</p>');
  assert.deepEqual(unsafeHtml(out), []);
  assert.equal(sanitize('<p>a</p><p>b</p>'), 'a b', 'inline mode unwraps paragraphs but keeps words apart');
  assert.equal(sanitize('<blockquote><p>q</p></blockquote>', {block: true}), '<blockquote><p>q</p></blockquote>');
  assert.equal(sanitize('edited<em> </em>by'), 'edited by', 'an empty em keeps only its space');
  assert.equal(sanitize('<a href="https://a.org"><a href="https://b.org">x</a></a>'), '<a href="https://a.org" rel="noopener">x</a>');
  assert.equal(sanitize('x<a href="https://a.org" title="&quot;><script>">y</a>'), 'x<a href="https://a.org" rel="noopener">y</a>');
  assert.equal(sanitize('<a href="https://a.org/&quot;onmouseover=&quot;x">z</a>'), '<a href="https://a.org/&quot;onmouseover=&quot;x" rel="noopener">z</a>');
  assert.deepEqual(unsafeHtml(sanitize('<a href="https://a.org/&quot;onmouseover=&quot;x">z</a>')), []);
  assert.equal(htmlToText('<p>a <em>b</em></p><p>c</p>'), 'a b c');
});

test('sanitize keeps his real Goodreads review intact (Alchemy)', () => {
  const review = 'The author is the vice-chairman of Ogilvy.<br /><br />My interview with him: <a target="_blank" href="https://malharmanek.substack.com/p/rorysutherland" rel="nofollow noopener">https://malharmanek.substack.com/p/ro...</a>';
  assert.equal(sanitize(review, {block: true}), 'The author is the vice-chairman of Ogilvy.<br><br>My interview with him: <a href="https://malharmanek.substack.com/p/rorysutherland" rel="noopener">https://malharmanek.substack.com/p/ro...</a>');
});
