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

// Keep tables reusable across accounts; substitute only the official name token at display time.
export function formatVoiceCaption(text, nickname) {
  return text.replaceAll('{@nickname}', () => nickname);
}

// Prefer the stable ready-row anchor; relocate around panels instead of hiding a playing caption.
export function voiceCaptionHudPosition(viewport, box, anchor, obstacles) {
  const margin = 12, gap = 12;
  const minLeft = margin + (viewport.safeLeft || 0);
  const right = Math.min(anchor.left - gap, viewport.width - margin - (viewport.safeRight || 0));
  const width = Math.min(Math.max(280, Math.min(400, viewport.width * .22)), right - minLeft);
  if (width < 240) return findCaptionSpace(viewport, box, obstacles);
  const height = box.heightAtWidth ? box.heightAtWidth(width) : box.height;
  const left = right - width;
  const crosses = r => r.width > 0 && r.height > 0 && r.right + gap > left && r.left - gap < right;
  const top = Math.max(margin + (viewport.safeTop || 0), anchor.top);
  if (top + height > viewport.height - margin - (viewport.safeBottom || 0)
    || obstacles.some(r => crosses(r) && r.bottom + 8 > top && r.top - 8 < top + height)) {
    return findCaptionSpace(viewport, { ...box, width }, obstacles, { left, top });
  }
  return { left, top, width };
}

// Use the widest low HUD gap, preferring the right on ties. Measure wrapping before placing the strip.
export function voiceCaptionPosition(viewport, box, obstacles) {
  const gap = 8, margin = 12;
  const minLeft = margin + (viewport.safeLeft || 0), maxRight = viewport.width - margin - (viewport.safeRight || 0);
  const maxWidth = Math.min(box.width || 520, maxRight - minLeft);
  if (maxWidth <= 0) return voiceCaptionDockPosition(viewport, box);
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
  return findCaptionSpace(viewport, box, obstacles);
}

// A dedicated lower strip is the last resort; callers reserve its height in the covering surface.
export function voiceCaptionDockPosition(viewport, box) {
  const left = 12 + (viewport.safeLeft || 0);
  const width = Math.max(1, Math.min(760, viewport.width - left - 12 - (viewport.safeRight || 0)));
  const height = box.heightAtWidth ? box.heightAtWidth(width) : box.height;
  return { left: (viewport.width + (viewport.safeLeft || 0) - (viewport.safeRight || 0) - width) / 2,
    top: Math.max(12 + (viewport.safeTop || 0), viewport.height - 12 - (viewport.safeBottom || 0) - height), width, dock: true };
}

// Search actual free rectangles over the whole viewport, measuring each candidate's wrapped height.
// Edge candidates suffice: a free rectangle can slide until it meets a viewport or obstacle edge.
function findCaptionSpace(viewport, box, obstacles, preferred) {
  const gap = 8, left = 12 + (viewport.safeLeft || 0), top = 12 + (viewport.safeTop || 0);
  const right = viewport.width - 12 - (viewport.safeRight || 0), bottom = viewport.height - 12 - (viewport.safeBottom || 0);
  const width = Math.min(box.width || 400, right - left), minWidth = Math.min(240, width);
  const rects = obstacles.filter(r => r.width > 0 && r.height > 0 && r.right > left && r.left < right && r.bottom > top && r.top < bottom);
  const heights = new Map();
  const measure = w => {
    if (!heights.has(w)) heights.set(w, box.heightAtWidth ? box.heightAtWidth(w) : box.height);
    return heights.get(w);
  };
  const target = preferred || { left: right - width, top: bottom - measure(width) };
  let best = null, score = Infinity;
  for (const w of new Set([width, minWidth])) {
    const h = measure(w);
    const ys = new Set([top, bottom - h, Math.max(top, Math.min(target.top, bottom - h)), ...rects.flatMap(r => [r.bottom + gap, r.top - gap - h])]);
    for (const y of ys) {
      if (y < top || y + h > bottom) continue;
      const blocks = rects.filter(r => r.bottom + gap > y && r.top - gap < y + h)
        .map(r => ({ left: Math.max(left, r.left - gap), right: Math.min(right, r.right + gap) })).sort((a, b) => a.left - b.left);
      let start = left;
      for (const block of [...blocks, { left: right, right }]) {
        const available = block.left - start;
        if (available >= w) {
          const x = Math.max(start, Math.min(target.left, block.left - w));
          const distance = Math.hypot(x - target.left, y - target.top) + (width - w) * 2;
          if (distance < score) { score = distance; best = { left: x, top: y, width: w }; }
        }
        start = Math.max(start, block.right);
      }
    }
  }
  return best || voiceCaptionDockPosition(viewport, box);
}
