import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mergeLocalChars } from '../plugins/artReferences.js';
import { rewriteAssetPaths } from '../../shared/cdn.js';

parentPort.on('message', async ({ id, payload: { file, cdn, localFile, metadata } }) => {
  try {
    const raw = await fs.readFile(file, 'utf8');
    let doc = JSON.parse(raw);
    if (localFile) {
      try { doc = mergeLocalChars(doc, JSON.parse(await fs.readFile(localFile, 'utf8'))); } catch { /* optional local art */ }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(rewriteAssetPaths(doc, cdn)));
    const value = metadata ? { bytes, hash: createHash('sha256').update(bytes).digest('hex') } : bytes;
    parentPort.postMessage({ id, value }, [bytes.buffer]);
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
