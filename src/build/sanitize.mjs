// Defence in depth on top of the pipeline's sanitiser: rebuilds a fragment from an allowlist so that even a
// bad books.json can't inject markup. a[href^=https:|mailto:] (rel=noopener), em, strong, br, and in block
// mode p and blockquote. i/b are mapped to em/strong. Script-like elements lose their content too.
const INLINE = new Set(['a', 'em', 'strong', 'br']);
const BLOCK = new Set(['p', 'blockquote']);
const ALIAS = {i: 'em', b: 'strong', cite: 'em'};
const DROP = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'svg', 'math', 'select']);
const ENTITY = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;

const escText = s => s.replace(/&/g, (amp, i) => (ENTITY.test(s.slice(i)) ? '&' : '&amp;')).replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => s.replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = s => s.replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

function safeHref(attrs) {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  if (!m) return null;
  const href = decode((m[1] ?? m[2] ?? m[3]).trim());
  if (/[\u0000- \u007f]/.test(href)) return null;
  return /^(https:\/\/|mailto:)/i.test(href) ? href : null;
}

export function safeFragment(input, {block = false} = {}) {
  const s = String(input ?? '');
  const re = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
  const stack = [];
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += escText(s.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue; // comment
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    const tag = ALIAS[raw] ?? raw;
    if (DROP.has(raw)) {
      if (!closing) {
        const end = s.toLowerCase().indexOf(`</${raw}`, last);
        last = end < 0 ? s.length : (s.indexOf('>', end) + 1 || s.length);
        re.lastIndex = last;
      }
      continue;
    }
    const ok = INLINE.has(tag) || (block && BLOCK.has(tag));
    if (closing) {
      const at = Math.max(stack.lastIndexOf(tag), stack.lastIndexOf(`-${tag}`));
      if (at < 0) continue;
      while (stack.length > at) { const t = stack.pop(); if (!t.startsWith('-')) out += `</${t}>`; }
      continue;
    }
    if (!ok) continue;
    if (tag === 'br') { out += '<br>'; continue; }
    // A new paragraph implicitly ends the open one, as an HTML parser would.
    if (tag === 'p' && stack.includes('p')) while (stack.length) { const t = stack.pop(); if (!t.startsWith('-')) out += `</${t}>`; if (t === 'p') break; }
    if (tag === 'a') {
      const href = safeHref(m[3]);
      if (!href) { stack.push('-a'); continue; }
      out += `<a href="${escAttr(href)}" rel="noopener">`;
    } else out += `<${tag}>`;
    stack.push(tag);
  }
  out += escText(s.slice(last));
  while (stack.length) { const t = stack.pop(); if (!t.startsWith('-')) out += `</${t}>`; }
  return out;
}
