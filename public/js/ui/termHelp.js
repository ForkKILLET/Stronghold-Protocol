// One shared terminology card, outside scroll panes. Opening it never sends a game intent.
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, closeTooltip, useModalFocus } from './components.js';
import { createStore, useStore } from '../store.js';
import { data, useData } from '../data.js';
import { parseRichText, rtClassName } from './richText.js';
import { t } from '../../../shared/i18n.js';

const state = createStore({ anchor: null, ids: [], pinned: false });
let pending, restoringFocus = false;
const cancelTimer = () => clearTimeout(pending);
export function closeTermHelp(restore = false) {
  cancelTimer(); const s = state.get();
  state.set({ anchor: null, ids: [], pinned: false });
  if (restore && s.pinned && s.anchor?.isConnected) {
    requestAnimationFrame(() => {
      if (state.get().anchor || !s.anchor.isConnected) return;
      restoringFocus = true; s.anchor.focus({ preventScroll: true }); restoringFocus = false;
    });
  }
}
function show(id, anchor, pinned) {
  cancelTimer();
  if (!data.lookup('terms', id)) return;
  const s = state.get();
  if (s.pinned && !pinned) return;
  closeTooltip();
  if (anchor.closest('.term-help') && s.anchor) {
    if (s.ids.at(-1) !== id) state.set({ ids: [...s.ids, id].slice(-16), pinned: true });
  } else state.set({ anchor, ids: [id], pinned });
}
function preview(id, anchor) {
  cancelTimer(); if (restoringFocus || state.get().pinned || anchor.closest('.term-help')) return;
  pending = setTimeout(() => { if (anchor.isConnected) show(id, anchor, false); }, 160);
}
function leave() {
  cancelTimer(); if (!state.get().pinned) pending = setTimeout(() => closeTermHelp(), 200);
}

export function termHelpPosition(anchor, box, viewport) {
  const gap = 10, margin = 12;
  let top = anchor.bottom + gap;
  if (top + box.height > viewport.height - margin) top = anchor.top - box.height - gap;
  return {
    left: Math.round(Math.max(margin, Math.min(viewport.width - box.width - margin, anchor.left + (anchor.width - box.width) / 2))),
    top: Math.round(Math.max(margin, Math.min(viewport.height - box.height - margin, top))),
  };
}

function TermMark({ id, class: cls, children }) {
  useData('terms');
  const ref = useRef(null), [nested, setNested] = useState(false);
  const active = useStore(s => !!s.anchor && s.anchor === ref.current, Object.is, state);
  const term = data.lookup('terms', id);
  // A native card button keeps its keyboard action; do not nest another button/tab stop inside it.
  useLayoutEffect(() => { setNested(!!ref.current?.parentElement?.closest('button,a,[role="button"]')); }, [!!term]);
  if (!term) return html`<span class=${cls}>${children}</span>`;
  const pin = e => { e.preventDefault(); e.stopPropagation(); show(id, e.currentTarget, true); };
  return html`<span ref=${ref} class=${`${cls} rt-term`} role=${nested ? undefined : 'button'} tabIndex=${nested ? undefined : 0}
    aria-haspopup=${nested ? undefined : 'dialog'} aria-expanded=${nested ? undefined : active}
    aria-describedby=${active ? 'term-help-body' : undefined}
    onPointerEnter=${e => { if (e.pointerType !== 'touch') preview(id, e.currentTarget); }} onPointerLeave=${leave}
    onFocusIn=${e => preview(id, e.currentTarget)} onFocusOut=${e => { if (!e.relatedTarget?.closest?.('.term-help')) leave(); }}
    onPointerDown=${e => e.stopPropagation()} onClick=${pin} onDblClick=${e => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') pin(e); }}>${children}</span>`;
}

/** Shared by normal descriptions and the card itself; related terms reuse the current card. */
export function TermMarkup({ segments }) {
  return segments.map((s, i) => s.br ? html`<br key=${i} />`
    : s.term ? html`<${TermMark} key=${i} id=${s.termId} class=${s.cls.map(c => rtClassName(c)).join(' ')}>${s.text}<//>`
      : s.cls.length ? html`<span key=${i} class=${s.cls.map(c => rtClassName(c)).join(' ')}>${s.text}</span>` : s.text);
}

export function TermHelpHost() {
  const s = useStore(v => v, Object.is, state), ref = useRef(null);
  useModalFocus(!!s.anchor && s.pinned, () => closeTermHelp(true), ref, { restoreFocus: false });
  useData(...(s.anchor ? ['terms'] : []));
  const [, reposition] = useReducer(n => n + 1, 0), [position, setPosition] = useState(null);
  const id = s.ids.at(-1), term = id ? data.lookup('terms', id) : null;
  const segments = useMemo(() => parseRichText(term?.descRaw), [term?.descRaw]);
  useEffect(() => {
    if (!s.anchor) return;
    const inside = target => target && (ref.current?.contains(target) || s.anchor.contains(target));
    const outside = e => { if (!inside(e.target)) closeTermHelp(); };
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeTermHelp(true); } };
    const scroll = e => { if (!ref.current?.contains(e.target)) s.pinned ? reposition() : closeTermHelp(); };
    const observer = new MutationObserver(() => { if (!s.anchor.isConnected) closeTermHelp(); });
    observer.observe(document.body, { childList: true, subtree: true });
    const sizes = new ResizeObserver(reposition);
    sizes.observe(s.anchor); if (ref.current) sizes.observe(ref.current);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', reposition);
    return () => {
      observer.disconnect(); sizes.disconnect(); document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true); document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', reposition);
    };
  }, [s.anchor, s.pinned]);
  useLayoutEffect(() => {
    if (!s.anchor || !ref.current || !term) { if (position) setPosition(null); return; }
    const pos = termHelpPosition(s.anchor.getBoundingClientRect(), ref.current.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    if (!position || position.left !== pos.left || position.top !== pos.top) setPosition(pos);
  });
  useLayoutEffect(() => {
    if (s.pinned && ref.current) { ref.current.scrollTop = 0; ref.current.focus({ preventScroll: true }); }
  }, [s.pinned, id]);
  useEffect(() => { if (s.anchor && !term) closeTermHelp(); }, [s.anchor, term]);
  if (!s.anchor || !term) return null;
  return html`<section id="term-help" ref=${ref} class="term-help" role=${s.pinned ? 'dialog' : 'tooltip'}
    aria-labelledby="term-help-title" aria-modal=${s.pinned ? 'true' : undefined} tabIndex="-1" data-pinned=${s.pinned}
    style=${position ? `left:${position.left}px;top:${position.top}px` : 'left:-9999px;top:-9999px'}
    onPointerEnter=${cancelTimer} onPointerLeave=${leave} onPointerDown=${e => e.stopPropagation()}
    onClick=${e => e.stopPropagation()} onDblClick=${e => e.stopPropagation()} onKeyDown=${e => e.stopPropagation()}>
    <header class="term-help__head">
      ${s.ids.length > 1 ? html`<button type="button" class="term-help__button" title=${t('返回')} aria-label=${t('返回')}
        onClick=${() => state.set({ ids: s.ids.slice(0, -1) })}><${Icon} name="chevronLeft" /></button>` : null}
      <h3 id="term-help-title">${term.name}</h3><span class="term-help__micro">TERM</span>
      <button type="button" class="term-help__button" aria-label=${t('关闭')} title=${t('关闭')} onClick=${() => closeTermHelp(true)}><${Icon} name="close" /></button>
    </header>
    <div class="term-help__body" id="term-help-body"><${TermMarkup} segments=${segments} /></div>
    ${!s.pinned ? html`<p class="term-help__hint">${t('点击术语可固定说明')}</p>` : null}
  </section>`;
}
