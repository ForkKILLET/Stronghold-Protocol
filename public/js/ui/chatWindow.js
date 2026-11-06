// Modeless chat lives outside animated / clipped screen columns, below modal menus.
import { render } from '../../vendor/preact.module.js';
import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

export const CHAT_POSITION_PREF = 'communication.position';
const clamp = (n, low, high) => Math.max(low, Math.min(Math.max(low, high), n));

/** Store proportions of the available travel, so a smaller viewport cannot lose the window. */
export function validChatPosition(value) {
  return value && typeof value.x === 'number' && typeof value.y === 'number'
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1
    ? { x: value.x, y: value.y } : null;
}

export function chatWindowPosition(saved, area, size, anchor) {
  const xMax = Math.max(0, area.width - size.width), yMax = Math.max(0, area.height - size.height);
  const p = validChatPosition(saved);
  return {
    x: area.x + (p ? p.x * xMax : clamp(anchor.left - area.x, 0, xMax)),
    y: area.y + (p ? p.y * yMax : clamp(anchor.top - size.height - 8 - area.y, 0, yMax)),
  };
}

/** A separate Preact root uses the same vendored UI instance, without reparenting managed DOM. */
export function ChatWindow(props) {
  const host = useRef(null);
  useLayoutEffect(() => {
    const layer = document.createElement('div');
    layer.className = 'echat-layer';
    document.body.append(layer);
    host.current = layer;
    return () => { render(null, layer); layer.remove(); host.current = null; };
  }, []);
  useLayoutEffect(() => { render(html`<${WindowContent} ...${props} layer=${host.current} />`, host.current); });
  return null;
}

function WindowContent({ layer, trigger, panelRef, tabs, pinControl, onClose, children }) {
  const panel = useRef(null), handle = useRef(null), close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const box = panel.current, grip = handle.current, viewport = window.visualViewport;
    let saved = validChatPosition(loadPref(CHAT_POSITION_PREF, null)), dragging = null, frame = 0;
    const area = () => {
      const css = getComputedStyle(layer), inset = side => parseFloat(css.getPropertyValue(`padding-${side}`)) || 8;
      const left = inset('left'), top = inset('top');
      return { x: (viewport?.offsetLeft || 0) + left, y: (viewport?.offsetTop || 0) + top,
        width: Math.max(0, (viewport?.width || innerWidth) - left - inset('right')),
        height: Math.max(0, (viewport?.height || innerHeight) - top - inset('bottom')) };
    };
    const place = () => {
      frame = 0;
      if (!box.getClientRects().length) return; // a menu temporarily hides the modeless window
      const bounds = area();
      box.style.width = `${Math.min(288, bounds.width)}px`;
      box.style.maxHeight = `${bounds.height}px`;
      const rect = box.getBoundingClientRect(), anchor = trigger.current?.getBoundingClientRect() || { left: bounds.x, top: bounds.y + bounds.height };
      const point = chatWindowPosition(saved, bounds, rect, anchor);
      box.style.left = `${point.x}px`; box.style.top = `${point.y}px`; box.style.visibility = 'visible';
      // A held preparation screen is read-only even though this window has its own DOM root.
      layer.inert = !!trigger.current?.closest('[inert]');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const move = (x, y) => {
      const bounds = area(), rect = box.getBoundingClientRect();
      const dx = Math.max(0, bounds.width - rect.width), dy = Math.max(0, bounds.height - rect.height);
      saved = { x: dx ? clamp(x - bounds.x, 0, dx) / dx : 0, y: dy ? clamp(y - bounds.y, 0, dy) / dy : 0 };
      place();
    };
    const reset = e => { e.preventDefault(); e.stopPropagation(); saved = null; savePref(CHAT_POSITION_PREF, null); place(); };
    const down = e => {
      if (e.button !== 0 || e.isPrimary === false) return;
      // Keep native click / double-click and focus. CSS touch-action/user-select
      // already prevent scrolling and selection during the drag.
      e.stopPropagation();
      const rect = box.getBoundingClientRect();
      dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, previous: saved, moved: false };
      grip.setPointerCapture(e.pointerId); box.classList.add('is-dragging');
    };
    const pointerMove = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.preventDefault(); e.stopPropagation();
      const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
      if (!dragging.moved && Math.hypot(dx, dy) < 3) return;
      dragging.moved = true; move(dragging.left + dx, dragging.top + dy);
    };
    const finish = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      const current = dragging; dragging = null; box.classList.remove('is-dragging');
      if (e.type === 'pointercancel' || e.type === 'lostpointercapture') { saved = current.previous; place(); }
      else if (current.moved) savePref(CHAT_POSITION_PREF, saved);
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
    };
    const keys = e => {
      if (e.key === 'Home') { reset(e); return; }
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!delta) return;
      e.preventDefault(); e.stopPropagation();
      const rect = box.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      move(rect.left + delta[0] * step, rect.top + delta[1] * step); savePref(CHAT_POSITION_PREF, saved);
    };
    const observer = new ResizeObserver(schedule); observer.observe(box);
    const screen = trigger.current?.closest('.screen');
    const held = new MutationObserver(schedule);
    if (screen) held.observe(screen, { attributes: true, attributeFilter: ['inert'] });
    for (const event of ['resize', 'scroll']) { window.addEventListener(event, schedule); viewport?.addEventListener(event, schedule); }
    const events = { pointerdown: down, pointermove: pointerMove, pointerup: finish, pointercancel: finish, lostpointercapture: finish, keydown: keys, dblclick: reset };
    for (const [event, listener] of Object.entries(events)) grip.addEventListener(event, listener);
    place();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); held.disconnect();
      for (const event of ['resize', 'scroll']) { window.removeEventListener(event, schedule); viewport?.removeEventListener(event, schedule); }
      for (const [event, listener] of Object.entries(events)) grip.removeEventListener(event, listener);
    };
  }, [layer]);
  return html`<div class="ewheel__dialog has-chat echat-window" role="dialog" aria-label=${t('交流')} aria-modal="false"
    ref=${node => { panel.current = node; panelRef.current = node; }}
    onKeyDown=${e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); } }}>
    <nav class="echat__tabs" aria-label=${t('交流内容')}>
      ${tabs}
      <button type="button" class="echat__drag" ref=${handle} aria-label=${t('移动交流框')}
        title=${t('拖动交流框；方向键移动，双击或 Home 恢复默认位置')}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="5" cy="3" r="1.25" /><circle cx="11" cy="3" r="1.25" />
          <circle cx="5" cy="8" r="1.25" /><circle cx="11" cy="8" r="1.25" />
          <circle cx="5" cy="13" r="1.25" /><circle cx="11" cy="13" r="1.25" />
        </svg></button>
      ${pinControl}
      <button type="button" class="echat__close" aria-label=${t('关闭交流框')} title=${t('关闭交流框')} onClick=${() => close.current()}><${Icon} name="close" /></button>
    </nav>
    ${children}
  </div>`;
}
