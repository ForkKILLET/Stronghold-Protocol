// Popup-only Markdown. Marked supplies tokens, never HTML: each accepted token becomes a fixed Preact element.
// Raw HTML is text, URLs are allowlisted, no attributes/styles/events can be supplied by announcement content.
import { lexer } from '../../vendor/marked.module.js';
import { h } from '../../vendor/preact.module.js';
import { POPUP_MAX_TEXT, validAnnouncementUrl } from '../../../shared/announcements.js';

const MAX_DEPTH = 24;
const MAX_NODES = 4096;

/** HTTP(S) without credentials, or a same-origin root path; no protocol-relative/data/javascript/blob URL. */
export function popupContentUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return validAnnouncementUrl(value) ? value : null;
}

// Text tokens retain Markdown entity spellings; decode text only, never inject it as markup.
function textValue(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    const key = entity.toLowerCase();
    if (!key.startsWith('#')) return named[key] || raw;
    const cp = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
  });
}

/** Pure VNode renderer for tests and the lazy popup body. Unsupported syntax degrades to escaped text. */
export function renderAnnouncementMarkdown(source) {
  const text = typeof source === 'string' ? source : '';
  if ([...text].length > POPUP_MAX_TEXT) return h('p', { class: 'announcement-content__plain' }, text.slice(0, POPUP_MAX_TEXT));
  let count = 0;
  const render = (tokens, depth = 0) => {
    if (depth > MAX_DEPTH) throw new Error('Markdown nesting limit');
    return (tokens || []).map(token => {
      if (++count > MAX_NODES) throw new Error('Markdown node limit');
      const children = () => render(token.tokens, depth + 1);
      switch (token.type) {
        case 'space': return null;
        case 'text': return token.tokens ? children() : textValue(token.text);
        case 'escape': return textValue(token.text);
        case 'html': return token.raw || token.text || '';
        case 'paragraph': return h('p', null, children());
        case 'heading': return h(`h${Math.max(1, Math.min(6, token.depth))}`, null, children());
        case 'strong': return h('strong', null, children());
        case 'em': return h('em', null, children());
        case 'del': return h('del', null, children());
        case 'codespan': return h('code', null, textValue(token.text));
        case 'code': return h('pre', null, h('code', null, token.text));
        case 'hr': return h('hr', null);
        case 'br': return h('br', null);
        case 'blockquote': return h('blockquote', null, children());
        case 'link': {
          const href = popupContentUrl(textValue(token.href));
          return href ? h('a', { href, title: token.title || undefined, target: '_blank', rel: 'noopener noreferrer' }, children()) : children();
        }
        case 'image': {
          const src = popupContentUrl(textValue(token.href));
          const alt = textValue(token.text);
          return src ? h('img', { src, alt, title: token.title || undefined, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' }) : alt;
        }
        case 'list': return h(token.ordered ? 'ol' : 'ul', token.ordered ? { start: token.start } : null,
          (token.items || []).map(item => {
            if (++count > MAX_NODES) throw new Error('Markdown node limit');
            return h('li', item.task ? { class: 'announcement-markdown__task' } : null,
              item.task ? h('input', { type: 'checkbox', disabled: true, checked: !!item.checked }) : null,
              render(item.tokens, depth + 1));
          }));
        case 'table': {
          const cells = (row, tag) => row.map((cell, i) => {
            if (++count > MAX_NODES) throw new Error('Markdown node limit');
            const align = ['left', 'center', 'right'].includes(token.align?.[i]) ? token.align[i] : 'left';
            return h(tag, { class: `announcement-markdown__cell--${align}` }, render(cell.tokens, depth + 1));
          });
          return h('div', { class: 'announcement-markdown__table', tabIndex: 0 },
            h('table', null, h('thead', null, h('tr', null, cells(token.header, 'th'))),
              h('tbody', null, token.rows.map(row => h('tr', null, cells(row, 'td'))))));
        }
        default: return token.raw || token.text || '';
      }
    });
  };
  try {
    return h('div', { class: 'announcement-markdown' }, render(lexer(text, { gfm: true, breaks: true })));
  } catch {
    return h('p', { class: 'announcement-content__plain' }, text);
  }
}
