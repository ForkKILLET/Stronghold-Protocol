// Pure identity/selection helpers. Subtitles follow the actual file, including audio fallback and random picks.
export const CAPTION_MODES = Object.freeze(['ui', 'dual', 'voice']);
export const CAPTION_LANGS = Object.freeze(['zh', 'zh-TW', 'en', 'ja', 'ko']);

export function captionLocale(lang) {
  if (/^zh-(?:TW|HK|Hant)(?:-|$)/i.test(lang)) return 'zh-TW';
  const base = String(lang || '').split('-')[0];
  return CAPTION_LANGS.includes(base) ? base : null;
}

export function voiceCaptionIdentity(url, nativeType) {
  let path;
  try { path = decodeURIComponent(new URL(url, 'https://assets.invalid').pathname); } catch { return null; }
  const m = /\/assets\/audio\/voice\/(cn|jp|en|kr|native)\/(char_[a-z0-9_#.-]+)\/(cn_\d+)\.mp3$/i.exec(path);
  if (!m) return null; // Plugins must not borrow unrelated official text for their own sound files.
  const lang = { cn: 'zh', jp: 'ja', en: 'en', kr: 'ko', native: { CN_TOPOLECT: 'zh', ITA: 'it', GER: 'de', RUS: 'ru', FRE: 'fr', SPA: 'es' }[nativeType] }[m[1].toLowerCase()];
  return { key: `${m[2]}/${m[3]}`.toLowerCase(), lang: lang || null };
}

export function selectVoiceCaptions({ mode = 'ui', uiLang, voiceLang, uiText, voiceText }) {
  const ui = uiText ? { lang: uiLang, text: uiText } : null;
  const voice = voiceText ? { lang: voiceLang, text: voiceText } : null;
  if (mode === 'voice') return voice ? [voice] : [];
  if (mode !== 'dual') return ui ? [ui] : [];
  if (!voice) return ui ? [ui] : [];
  if (!ui || ui.text === voice.text || ui.lang?.split('-')[0] === voice.lang?.split('-')[0]) return [ui || voice];
  return [voice, ui];
}

// The ready-row anchor survives combat: captions never follow the shop, effects list or detail card.
export function voiceCaptionHudPosition(viewport, box, anchor, obstacles) {
  const margin = 12, gap = 12;
  const minLeft = margin + (viewport.safeLeft || 0);
  const right = Math.min(anchor.left - gap, viewport.width - margin - (viewport.safeRight || 0));
  const width = Math.min(Math.max(280, Math.min(400, viewport.width * .22)), right - minLeft);
  if (width < 240) return null;
  const height = box.heightAtWidth ? box.heightAtWidth(width) : box.height;
  const left = right - width;
  const crosses = r => r.width > 0 && r.height > 0 && r.right + gap > left && r.left - gap < right;
  const top = Math.max(margin + (viewport.safeTop || 0), anchor.top);
  if (top + height > viewport.height - margin - (viewport.safeBottom || 0)) return null;
  if (obstacles.some(r => crosses(r) && r.bottom + 8 > top && r.top - 8 < top + height)) return null;
  return { left, top, width };
}

// Use the widest low HUD gap, preferring the right on ties. Measure wrapping before placing the strip.
export function voiceCaptionPosition(viewport, box, obstacles) {
  const gap = 8, margin = 12;
  const minLeft = margin + (viewport.safeLeft || 0), maxRight = viewport.width - margin - (viewport.safeRight || 0);
  const maxWidth = Math.min(box.width || 520, maxRight - minLeft);
  if (maxWidth <= 0) return null;
  const minWidth = Math.min(box.minWidth || 280, maxWidth);
  const heights = new Map();
  const heightAt = width => {
    if (!heights.has(width)) heights.set(width, box.heightAtWidth ? box.heightAtWidth(width) : box.height);
    return heights.get(width);
  };
  // The narrowest strip is also the tallest. Reserve that height when finding a safe horizontal interval.
  const maxHeight = heightAt(minWidth);
  const near = obstacles.filter(r => r.width > 0 && r.height > 0 && r.bottom > viewport.height * .55 && r.top < viewport.height);
  const maxBottom = viewport.height - margin - (viewport.safeBottom || 0);
  const bottoms = [...new Set([maxBottom, ...near.map(r => r.top - gap)])].filter(y => y <= maxBottom).sort((a, b) => b - a);
  for (const bottom of bottoms) {
    const blocks = near.filter(r => r.bottom + gap > bottom - maxHeight && r.top - gap < bottom)
      .map(r => ({ left: Math.max(minLeft, r.left - gap), right: Math.min(maxRight, r.right + gap) }))
      .filter(r => r.left < r.right).sort((a, b) => a.left - b.left);
    const spaces = [];
    let start = minLeft;
    for (const block of blocks) {
      if (block.left > start) spaces.push({ left: start, right: block.left });
      start = Math.max(start, block.right);
    }
    if (start < maxRight) spaces.push({ left: start, right: maxRight });
    const candidates = [];
    for (const space of spaces) {
      const width = Math.min(maxWidth, space.right - space.left);
      if (width < minWidth) continue;
      const height = heightAt(width);
      if (bottom - height >= viewport.height * .55) candidates.push({ left: space.right - width, top: bottom - height, width });
    }
    if (candidates.length) return candidates.sort((a, b) => b.width - a.width || b.left - a.left)[0];
  }
  return null;
}
