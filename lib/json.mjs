// Deterministic JSON for committed data files. Every bot-written file goes through stableStringify so that
// "commit only if changed" means a real change: fixed key order, sorted maps, one record per line, LF ending.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback);
    throw err;
  }
}

const sortKeys = value => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  }
  return value;
};

// Top-level object one key per line (keys in insertion order). Keys named in `records` hold arrays or maps
// printed one entry per line as compact JSON; maps are sorted by key (code-point order, no locale).
// Other values print compactly. Nested objects inside a record keep their insertion order unless
// `sortMaps` lists the record key, in which case each record's keys are sorted too.
export function stableStringify(value, {records = [], sortMaps = []} = {}) {
  const lines = ['{'];
  const keys = Object.keys(value);
  keys.forEach((key, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    const v = value[key];
    const k = JSON.stringify(key);
    if (records.includes(key) && Array.isArray(v)) {
      if (!v.length) { lines.push(`  ${k}: []${comma}`); return; }
      lines.push(`  ${k}: [`);
      v.forEach((item, j) => lines.push(`    ${JSON.stringify(sortMaps.includes(key) ? sortKeys(item) : item)}${j < v.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (records.includes(key) && v && typeof v === 'object') {
      const entries = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (!entries.length) { lines.push(`  ${k}: {}${comma}`); return; }
      lines.push(`  ${k}: {`);
      entries.forEach((ek, j) => {
        const item = sortMaps.includes(key) ? sortKeys(v[ek]) : v[ek];
        lines.push(`    ${JSON.stringify(ek)}: ${JSON.stringify(item)}${j < entries.length - 1 ? ',' : ''}`);
      });
      lines.push(`  }${comma}`);
    } else {
      lines.push(`  ${k}: ${JSON.stringify(v)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

// Writes only when the bytes differ. Returns true when the file was written.
export async function writeIfChanged(path, text) {
  try { if (await readFile(path, 'utf8') === text) return false; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, text);
  return true;
}

// Safe inside <script type="application/json">: no </script>, no HTML comment openers, no line separators.
export const jsonForScript = value => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
