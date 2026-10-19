#!/usr/bin/env node
// Extract only the official terminology; never regenerate gameplay data or fetch at runtime.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordOverlay } from '../shared/i18nData.js';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function extractTerms(table) {
  const source = table?.termDescriptionDict;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('Missing termDescriptionDict');
  return Object.fromEntries(Object.keys(source).sort().map(id => {
    const r = source[id];
    if (!/^[\w.-]{1,48}$/.test(id) || r?.termId !== id || typeof r.termName !== 'string' || !r.termName.trim()
      || typeof r.description !== 'string' || !r.description.trim() || r.description.length > 8192) throw Error('Invalid term: ' + id);
    return [id, { id, name: r.termName, descRaw: r.description }];
  }));
}

export async function buildTerms({ cache = join(ROOT, '.cache/terms'), out = join(ROOT, 'data'), offline = false } = {}) {
  const sources = JSON.parse(await readFile(join(ROOT, 'tools/term-sources.json'), 'utf8'));
  const tables = new Map();
  await mkdir(cache, { recursive: true });
  for (const source of sources) {
    const file = join(cache, source.lang + '.json');
    let bytes;
    try { bytes = await readFile(file); } catch (error) {
      if (error.code !== 'ENOENT' || offline) throw error;
      const r = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error('Terms HTTP ' + r.status);
      bytes = Buffer.from(await r.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw Error('Term source checksum: ' + source.lang);
    tables.set(source.lang, extractTerms(JSON.parse(bytes)));
    await writeFile(file, bytes);
  }
  const terms = tables.get('zh');
  const outputs = new Map([[join(out, 'terms.json'), terms]]);
  for (const [lang, translated] of tables) if (lang !== 'zh') {
    const file = join(out, 'i18n', lang + '.json');
    const overlay = JSON.parse(await readFile(file, 'utf8'));
    overlay.files.terms = Object.fromEntries(Object.entries(terms).filter(([id]) => translated[id]).map(([id, term]) => [id, buildRecordOverlay(
      ['name', 'descRaw'].map(key => ({ path: [key], zh: term[key], en: translated[id][key] })))]));
    outputs.set(file, overlay);
  }
  for (const [file, value] of outputs) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    await writeFile(tmp, JSON.stringify(value)); await rename(tmp, file);
  }
  return { terms: Object.keys(terms).length, languages: [...tables.keys()] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--offline')) throw Error('Usage: node tools/build-terms.mjs [--offline]');
  console.log(JSON.stringify(await buildTerms({ offline: args.includes('--offline') })));
}
