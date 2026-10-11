// html`` escapes every interpolation unless it is a Raw (another html`` result, or raw() around
// allowlist-sanitised notes and internal SVG). Arrays are joined, null/undefined/false render nothing.
export class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export const raw = s => (s instanceof Raw ? s : new Raw(s ?? ''));

const MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => MAP[c]);

const render = v => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
};

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

// Attribute helper: attrs({id: 'x', hidden: true, 'data-n': 0, skip: null}) -> ' id="x" hidden data-n="0"'
export const attrs = obj => raw(Object.entries(obj).map(([k, v]) => (v === null || v === undefined || v === false ? '' : v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join(''));
