// A small, dependency-free HTML toolkit for the three places his own words arrive as HTML: Goodreads reviews,
// the Substack favourites post and its bylines. parseFragment builds a forgiving tree (Substack and Goodreads
// both emit well-formed-ish markup); sanitize renders it back through a strict allowlist (docs/CONTRACT.md,
// "Sanitised HTML") so templates can insert noteHtml, bylineHtml and reviewHtml raw.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', ensp: ' ', emsp: ' ',
  thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…',
  prime: '′', Prime: '″', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', middot: '·',
  bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×',
  divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', iexcl: '¡', iquest: '¿', cent: '¢',
  pound: '£', euro: '€', yen: '¥', sect: '§', para: '¶', szlig: 'ß', aelig: 'æ',
  AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ',
  oelig: 'œ', OElig: 'Œ', larr: '←', rarr: '→', hyphen: '‐', minus: '−', dagger: '†',
};
const MARKS = {acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', ring: '̊', cedil: '̧', caron: '̌'};

function named(name) {
  if (Object.hasOwn(NAMED, name)) return NAMED[name];
  // Accented letters (&eacute; &Uuml; …) are composed instead of listed one by one.
  const m = /^([A-Za-z])(acute|grave|circ|tilde|uml|ring|cedil|caron)$/.exec(name);
  if (m) { const c = (m[1] + MARKS[m[2]]).normalize('NFC'); if (c.length === 1) return c; }
  return null;
}

// Numeric entities plus the common named ones. Unknown names pass through untouched (and are escaped on output).
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (whole, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
    }
    return named(e) ?? whole;
  });
}

// "javascript:" never survives into output, even as text, so lib/schema.mjs's blunt check can stay blunt.
export const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/javascript:/gi, m => m.slice(0, -1) + '&#58;');
const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/javascript:/gi, m => m.slice(0, -1) + '%3A');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const LIST = new Set(['ul', 'ol']);

// Reads one tag starting at s[lt] === '<'. Attribute values may contain '>' inside quotes.
function readTag(s, lt) {
  let i = lt + 1, closing = false;
  if (s[i] === '/') { closing = true; i++; }
  const nameRe = /[a-zA-Z][\w:-]*/y;
  nameRe.lastIndex = i;
  const nm = nameRe.exec(s);
  if (!nm) return null;
  i = nameRe.lastIndex;
  const attrs = Object.create(null);
  const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
  let selfClose = false;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '>') return {end: i + 1, closing, name: nm[0].toLowerCase(), attrs, selfClose};
    if (s[i] === '/') { i++; selfClose = s[i] === '>'; continue; }
    attrRe.lastIndex = i;
    const a = attrRe.exec(s);
    if (!a) { i++; continue; }
    const key = a[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    i = attrRe.lastIndex;
  }
  return null;
}

// Forgiving tree builder: void elements, unclosed tags, stray closers (ignored), an open element closed by an
// ancestor's closer, <p> implicitly closed by a block, <li> by the next <li>. Nodes: {type:'element', tag, attrs,
// children} and {type:'text', text}; text is entity-decoded.
export function parseFragment(html) {
  const s = String(html ?? '');
  const root = {type: 'element', tag: '#root', attrs: Object.create(null), children: []};
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const addText = raw => {
    if (!raw) return;
    const text = decodeEntities(raw), kids = top().children, last = kids[kids.length - 1];
    if (last?.type === 'text') last.text += text; else kids.push({type: 'text', text});
  };
  const closeTo = idx => { stack.length = idx; };
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { addText(s.slice(i)); break; }
    addText(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const end = s.indexOf('-->', lt + 4); i = end < 0 ? s.length : end + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const end = s.indexOf('>', lt); i = end < 0 ? s.length : end + 1; continue; }
    const tag = readTag(s, lt);
    if (!tag) { addText('<'); i = lt + 1; continue; }
    i = tag.end;
    if (tag.closing) {
      if (tag.name === 'br') { top().children.push({type: 'element', tag: 'br', attrs: Object.create(null), children: []}); continue; }
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag.name) { closeTo(k); break; }
      continue;
    }
    if (BLOCK.has(tag.name)) {
      const p = stack.findLastIndex(n => n.tag === 'p');
      if (p > 0 && stack.slice(p + 1).every(n => !BLOCK.has(n.tag))) closeTo(p);
    }
    if (tag.name === 'li') {
      const li = stack.findLastIndex(n => n.tag === 'li'), list = stack.findLastIndex(n => LIST.has(n.tag));
      if (li > 0 && li > list) closeTo(li);
    }
    const node = {type: 'element', tag: tag.name, attrs: tag.attrs, children: []};
    top().children.push(node);
    if (RAW.has(tag.name)) {
      const endRe = new RegExp(`</${tag.name}\\s*>`, 'ig');
      endRe.lastIndex = i;
      const m = endRe.exec(s);
      const text = s.slice(i, m ? m.index : s.length);
      if (text) node.children.push({type: 'text', text: tag.name === 'script' || tag.name === 'style' ? text : decodeEntities(text)});
      i = m ? endRe.lastIndex : s.length;
      continue;
    }
    if (!VOID.has(tag.name) && !tag.selfClose) stack.push(node);
  }
  return root;
}

export function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.tag === 'br') return '\n';
  return node.children.map(textContent).join('');
}

// Plain text of an HTML string, whitespace collapsed (used to compare reviews with favourite notes).
const blockText = n => (n.type === 'text' ? n.text : n.tag === 'br' ? ' ' : BLOCK.has(n.tag) ? ` ${n.children.map(blockText).join('')} ` : n.children.map(blockText).join(''));
export const htmlToText = html => blockText(parseFragment(html)).replace(/\s+/g, ' ').trim();

const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'picture',
  'head', 'title', 'textarea', 'select', 'button', 'form', 'input', 'img', 'video', 'audio', 'canvas', 'map', 'xmp',
  'noembed', 'noframes', 'frameset', 'frame', 'applet', 'meta', 'link', 'base']);
const RENAME = {em: 'em', i: 'em', strong: 'strong', b: 'strong'};

// Only https: and mailto: links survive (CONTRACT). Whitespace and control characters cannot smuggle a scheme in,
// because the check runs on the trimmed value and anything else is unwrapped to its text.
function safeHref(raw) {
  const h = String(raw ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').replace(/ /g, '%20');
  const m = /^(https:\/\/|mailto:)/i.exec(h);
  return m ? m[1].toLowerCase() + h.slice(m[1].length) : null;
}

function render(node, ctx) {
  if (node.type === 'text') return escapeHtml(node.text.replace(/[ \t\n\r\f]+/g, ' '));
  if (DROP.has(node.tag)) return '';
  if (node.tag === 'br') return '<br>';
  const inner = (c = ctx) => node.children.map(n => render(n, c)).join('');
  const tag = RENAME[node.tag];
  if (tag) {
    const body = inner();
    return body.replace(/<br>/g, '').trim() ? `<${tag}>${body}</${tag}>` : body; // "edited<em> </em>by" keeps just its space
  }
  if (node.tag === 'a') {
    const href = safeHref(node.attrs.href);
    if (!href || ctx.inLink) return inner();
    const body = inner({...ctx, inLink: true});
    return body.trim() ? `<a href="${escapeAttr(href)}" rel="noopener">${body}</a>` : '';
  }
  if (ctx.block && !ctx.inP && (node.tag === 'p' || node.tag === 'blockquote')) {
    return `<${node.tag}>${inner(node.tag === 'p' ? {...ctx, inP: true} : ctx)}</${node.tag}>`;
  }
  return BLOCK.has(node.tag) ? ` ${inner()} ` : inner(); // unwrapped blocks still separate words
}

function tidy(html, block) {
  let out = html.replace(/[ \t\n\r\f]+/g, ' ');
  if (block) {
    for (let k = 0; k < 3; k++) {
      out = out.replace(/ ?(<\/?(?:p|blockquote)>) ?/g, '$1')
        .replace(/<p>(?:<br> ?| )+/g, '<p>').replace(/(?: ?<br>| )+<\/p>/g, '</p>')
        .replace(/<p><\/p>|<blockquote><\/blockquote>/g, '');
    }
  }
  return out.replace(/ ?<br> ?/g, '<br>').replace(/^(?:<br>| )+|(?:<br>| )+$/g, '');
}

// Allowlist renderer: a[href^=https:|mailto:] (rel="noopener"), em, strong, br, and with {block:true} also p and
// blockquote. i/b become em/strong, other tags are unwrapped, dangerous ones are dropped with their contents.
export function sanitize(input, {block = false} = {}) {
  const nodes = typeof input === 'string' || input == null ? parseFragment(input).children
    : Array.isArray(input) ? input : input.tag === '#root' ? input.children : [input];
  return tidy(nodes.map(n => render(n, {block, inLink: false, inP: false})).join(''), block);
}
