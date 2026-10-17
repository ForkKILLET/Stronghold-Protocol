// The repository changelog is the single source for the fork's public update history.
import { readFile } from 'node:fs/promises';

export const CHANGELOG_SOURCE = 'https://github.com/ForkKILLET/Stronghold-Protocol/blob/main/CHANGELOG.md';
const REPOSITORY_ROOT = new URL('./', CHANGELOG_SOURCE);

// Popup Markdown only accepts root-relative or HTTP(S) URLs. Repository links need their original base.
function repositoryLinks(text) {
  return text.replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g, (all, before, url, after) => {
    if (/^(?:[a-z][a-z\d+.-]*:|[/#])/i.test(url)) return all;
    return before + new URL(url, REPOSITORY_ROOT).href + after;
  });
}

/** Keep fork/deployment sections, never upstream releases or headings inside fenced code. */
export function parseForkChangelog(source) {
  const entries = [];
  let current = null, fence = null;
  const finish = () => {
    if (current) {
      const text = repositoryLinks(current.lines.join('\n').trim());
      if (text) entries.push({ date: current.date, title: current.title, text });
    }
    current = null;
  };
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      current?.lines.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; current?.lines.push(line); continue; }
    if (/^## /.test(line)) {
      finish();
      const heading = /^## (?:Fork|本部署) — (\d{4}-\d{2}-\d{2})(?:[：:]\s*(.+))?\s*$/.exec(line);
      if (heading) current = { date: heading[1], title: heading[2]?.trim() || '', lines: [] };
    } else current?.lines.push(line);
  }
  finish();
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** Lazy, coalesced reads: no polling or changelog payload on the game's startup/WebSocket path. */
export function createChangelogReader({ file = new URL('../CHANGELOG.md', import.meta.url), now = Date.now, maxAgeMs = 2000 } = {}) {
  let pending = null, loading = false, readAt = -Infinity;
  return () => {
    if (!pending || (!loading && now() - readAt >= maxAgeMs)) {
      readAt = now();
      loading = true;
      pending = readFile(file, 'utf8').then(source => ({ source: CHANGELOG_SOURCE, entries: parseForkChangelog(source) }))
        .finally(() => { loading = false; });
    }
    return pending;
  };
}
