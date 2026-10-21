// Caption text is independent of audio playback. Serve the browser's existing HTTP cache
// immediately (even no-cache responses), then conditionally refresh it in the background.
import { CAPTION_LANGS } from './voiceCaptions.js';

export function createVoiceCaptionTables({
  fetcher = (...args) => globalThis.fetch(...args),
  urlFor = lang => `/data/voice-captions/${lang}.json`,
  timeoutMs = 30000, retryMs = 1000, refreshRetryMs = 30000,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(),
} = {}) {
  const entries = new Map(), listeners = new Set();
  const publish = (entry, table) => {
    entry.table = table;
    for (const listener of listeners) { try { listener(); } catch { /* UI must not interrupt audio. */ } }
  };
  const read = async (lang, cache) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher(urlFor(lang), { cache: attempt ? 'no-cache' : cache, signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw Error('Caption HTTP ' + response.status);
        const table = await response.json();
        if (!table || typeof table !== 'object' || Array.isArray(table) || !Object.keys(table).length || !Object.values(table).every(v => typeof v === 'string')) throw Error('Invalid caption table');
        return table;
      } catch {
        if (!attempt) await delay(retryMs);
      }
    }
    return null;
  };
  const refresh = (lang, entry) => {
    if (entry.refreshing || entry.checked || now() < entry.retryAfter) return;
    entry.refreshing = read(lang, 'no-cache').then(table => {
      if (table) { entry.checked = true; publish(entry, table); }
      else entry.retryAfter = now() + refreshRetryMs;
    }).finally(() => { entry.refreshing = null; });
  };
  const load = lang => {
    if (!CAPTION_LANGS.includes(lang)) return Promise.resolve(null);
    let entry = entries.get(lang);
    if (!entry) {
      entry = { table: null, loading: null, refreshing: null, checked: false, retryAfter: 0 };
      entries.set(lang, entry);
    }
    if (entry.table) { refresh(lang, entry); return Promise.resolve(entry.table); }
    if (!entry.loading) entry.loading = read(lang, 'force-cache').then(table => {
      if (table) { publish(entry, table); refresh(lang, entry); }
      return table;
    }).finally(() => { entry.loading = null; });
    return entry.loading;
  };
  return {
    load,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
