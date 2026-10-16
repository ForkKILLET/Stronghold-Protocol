// Static board descriptions are asset metadata, separate from game data, language packs and executable code.
export function isBoardResourceJson(url) {
  let pathname;
  try { pathname = new URL(String(url), 'https://resources.invalid').pathname; } catch { return false; }
  if (pathname.startsWith('/build/')) return false;
  return /\/assets\/local\/map\/(?:fx\/(?:materials|prefab)|autochess\/(?:materials|tiles))\.json$/.test(pathname)
    || /\/assets\/local\/fx\/(?:(?:index|textures)|prefabs\/[A-Za-z0-9_.-]+|mesh\/[A-Za-z0-9_.-]+)\.json$/.test(pathname)
    || /\/assets\/local\/scene\/(?:act1autochess_m0[1-7]|act2autochess_m0[1-4])\/scene\.json$/.test(pathname);
}

/** Match the renderer's encodeURI paths without changing CDN hosts or double-encoding existing escapes. */
export function canonicalResourceUrl(url) {
  const value = String(url);
  if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return value.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  try {
    const parsed = new URL(value, 'https://resources.invalid');
    parsed.pathname = parsed.pathname.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    return value.startsWith('/') && !value.startsWith('//') ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
  } catch { return value; }
}
