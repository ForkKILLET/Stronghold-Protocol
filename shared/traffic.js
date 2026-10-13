// HTTP traffic categories shared by the server counters and browser diagnostics.
// Plain asset/media paths remain unchanged; this module does not rewrite URLs.
export const TRAFFIC_CATEGORIES = Object.freeze(['assets', 'audio', 'code', 'data', 'other']);

/**
 * @param {string} path a URL path without its query
 * @returns {'assets'|'audio'|'code'|'data'|'other'}
 */
export function trafficCategory(path) {
  const p = String(path ?? '');
  if (p.startsWith('/media/') || p.startsWith('/assets/audio/')) return 'audio';
  if (p.startsWith('/assets/') || p.startsWith('/fonts/') || p.startsWith('/icons/')) return 'assets';
  if (p.startsWith('/packs/')) return /\.json$/i.test(p) ? 'data' : 'assets';
  if (p.startsWith('/data/') || p.startsWith('/i18n/') || /\.json$/i.test(p)) return 'data';
  if (p === '/' || p.endsWith('/') || /\.(?:m?js|css|html?|map|webmanifest)$/i.test(p)
    || p.startsWith('/vendor/') || p.startsWith('/sim/') || p.startsWith('/shared/')) return 'code';
  return 'other';
}
