#!/usr/bin/env node
// Fixed original game tables; generate only subtitle text, never gameplay or art manifests.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_SLOTS } from './assets/audio.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function extractVoiceCaptions(table, characters) {
  if (!table?.charWords || typeof table.charWords !== 'object') throw Error('Missing charWords');
  const entries = new Map();
  for (const row of Object.values(table.charWords)) {
    if (!characters.has(row.charId) || !VOICE_SLOTS[row.placeType]) continue;
    if (!/^char_[a-z0-9_#.-]+$/i.test(row.wordKey) || !/^CN_\d+$/i.test(row.voiceId)) continue;
    if (typeof row.voiceText !== 'string' || !row.voiceText.trim()) continue;
    const key = `${row.wordKey}/${row.voiceId}`.toLowerCase();
    const text = row.voiceText.replace(/<[^>]*>/g, '').replace(/\r/g, '').trim();
    if (text.length > 8192 || entries.has(key) && entries.get(key) !== text) throw Error('Conflicting caption: ' + key);
    entries.set(key, text);
  }
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export async function buildVoiceCaptions({ cache = join(ROOT, '.cache/voice-captions'), out = join(ROOT, 'data/voice-captions'), offline = false } = {}) {
  const sources = JSON.parse(await readFile(join(ROOT, 'tools/voice-caption-sources.json'), 'utf8'));
  const chess = JSON.parse(await readFile(join(ROOT, 'data/chess.json'), 'utf8'));
  const backups = JSON.parse(await readFile(join(ROOT, 'data/backups.json'), 'utf8'));
  const assets = JSON.parse(await readFile(join(ROOT, 'data/assets.json'), 'utf8'));
  const characters = new Set([...Object.values(chess)].flatMap(r => [r.charId, r.backup?.charId]).filter(Boolean));
  for (const records of [backups.units, backups.diy?.operators, ...['voice', 'voiceJp', 'voiceEn', 'voiceKr', 'voiceNative'].map(k => assets.audio?.[k])]) {
    for (const id of Object.keys(records || {})) if (id.startsWith('char_')) characters.add(id);
  }
  await mkdir(cache, { recursive: true }); await mkdir(out, { recursive: true });
  const counts = {};
  for (const source of sources) {
    const file = join(cache, source.lang + '.json');
    let bytes;
    try { bytes = await readFile(file); } catch (error) {
      if (error.code !== 'ENOENT' || offline) throw error;
      const response = await fetch(source.url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw Error('Caption HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw Error('Caption source checksum: ' + source.lang);
    const lines = extractVoiceCaptions(JSON.parse(bytes), characters);
    await writeFile(file, bytes);
    await writeFile(join(out, source.lang + '.json'), JSON.stringify(lines));
    counts[source.lang] = Object.keys(lines).length;
  }
  return counts;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--offline')) throw Error('Usage: node tools/build-voice-captions.mjs [--offline]');
  console.log(JSON.stringify(await buildVoiceCaptions({ offline: args.includes('--offline') })));
}
