// Shared presentation-only search. Never change a roster, its eligibility or gameplay data.
import { SEARCH_READINGS, OPERATOR_SEARCH_NAMES } from './searchReadings.js';

const cache = new Map();
const CACHE_LIMIT = 1024;

/** Latin tones and ü/v are interchangeable; keep kana voicing and other non-Latin spelling intact. */
export function normalizeOperatorSearch(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().normalize('NFD')
    .replace(/u\u0308/g, 'v').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC');
}
const compact = text => text.replace(/[\s'’·•.\-]+/gu, '');

function indexOf(text) {
  const normalized = normalizeOperatorSearch(text);
  if (cache.has(normalized)) return cache.get(normalized);
  const tokens = [...compact(normalized)].map(char => {
    const readings = Object.hasOwn(SEARCH_READINGS, char) ? SEARCH_READINGS[char] : [];
    return { full: [char, ...readings], initials: [...new Set([char, ...readings.map(value => value[0])])] };
  });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(normalized, tokens);
  return tokens;
}

/** KMP over alternatives: bounded by text/query size, without expanding combinations of polyphonic syllables. */
function matchesTokens(tokens, needle, fallback, mode) {
  let states = new Set([0]);
  for (const token of tokens) {
    const next = new Set();
    for (const part of token[mode]) for (let state of states) {
      for (const char of part) {
        while (state && needle[state] !== char) state = fallback[state - 1];
        if (needle[state] === char) state++;
        if (state === needle.length) return true;
      }
      next.add(state);
    }
    states = next;
  }
  return false;
}

/** Compile once per query, then pass each row's existing search fields and optional stable operator id.
 * Mandarin readings are permissive search aliases, not a canonical pronunciation or nickname database.
 * @param {string} [query]
 * @returns {(fields: unknown[], charId?: string) => boolean}
 */
export function operatorSearch(query = '') {
  const literal = normalizeOperatorSearch(query).trim();
  if (!literal) return () => true;
  const needle = compact(literal);
  const fallback = new Array(needle.length).fill(0);
  for (let i = 1, prefix = 0; i < needle.length; i++) {
    while (prefix && needle[i] !== needle[prefix]) prefix = fallback[prefix - 1];
    if (needle[i] === needle[prefix]) prefix++;
    fallback[i] = prefix;
  }
  return (fields, charId) => {
    const names = Object.hasOwn(OPERATOR_SEARCH_NAMES, charId) ? OPERATOR_SEARCH_NAMES[charId] : [];
    const texts = [...fields, ...names].filter(value => typeof value === 'string' && value.length);
    if (normalizeOperatorSearch(texts.join(' ')).includes(literal)) return true;
    if (!needle) return false; // punctuation-only input must not become a match-all query
    return texts.some(text => {
      const tokens = indexOf(text);
      return matchesTokens(tokens, needle, fallback, 'full') || matchesTokens(tokens, needle, fallback, 'initials');
    });
  };
}
