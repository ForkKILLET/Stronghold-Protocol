// Theme ZIP decoding uses the same bounded reader and CRC verification as resource imports.
import { ZipReader, Uint8ArrayWriter } from '../../vendor/zip.module.js';
import { ResourceZipReader } from '../resources/zipReader.js';
import { THEME_LIMITS } from '../../../shared/uiTheme.js';

export async function openZip(bytes) {
  let reader;
  try {
    reader = new ZipReader(new ResourceZipReader(new Blob([bytes])), { useWebWorkers: false, checkSignature: true });
    const entries = await reader.getEntries();
    if (entries.filter(e => !e.directory).length > THEME_LIMITS.files) throw new Error('too many theme entries');
    return { ok: true, entries: entries.filter(e => !e.directory).map(entry => ({
      name: entry.filename, encrypted: entry.encrypted, method: entry.compressionMethod,
      uncompSize: entry.uncompressedSize, entry,
    })), close: () => reader.close(), read: async row => {
      if (!(row.uncompSize > 0) || row.uncompSize > THEME_LIMITS.pack) return { ok: false };
      try { return { ok: true, bytes: await row.entry.getData(new Uint8ArrayWriter(), { checkSignature: true }) }; }
      catch { return { ok: false }; }
    } };
  } catch { await reader?.close().catch(() => {}); return { ok: false }; }
}

export function normalizePackPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  let path = name.replace(/\\/g, '/');
  if (path.endsWith('/')) return null;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('/')) path = path.slice(1);
  if (!path) return null;
  const segs = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    segs.push(seg);
  }
  return segs.length ? segs.join('/') : null;
}
