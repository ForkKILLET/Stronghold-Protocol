// Shared tier marker and horizontal deck interaction for operator and candidate rosters.
import { useRef } from '../../vendor/hooks.module.js';
import { html, TierChip } from './components.js';

export function RosterTierMark({ tier, count }) {
  return html`<div class=${`lo-tmark tier--${tier}`} aria-hidden="true">
    <${TierChip} tier=${tier} size="md" class="lo-tmark__chip" />
    <span class="lo-tmark__cnt num">${count}</span>
  </div>`;
}

export function useRosterDeckScroll() {
  const drag = useRef(null), swallow = useRef(false);
  const end = e => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    e.currentTarget.classList.remove('is-dragging');
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 0);
  };
  return {
    onPointerDown: e => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target?.closest?.('select, input, textarea, .lo-op__quick--cult')) return;
      drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
    },
    onPointerMove: e => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(dx) < 6) return;
        d.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.classList.add('is-dragging');
      }
      e.currentTarget.scrollLeft = d.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: e => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
    onWheel: e => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.target?.closest?.('select, .lo-op__quick--cult')) return;
      e.currentTarget.scrollLeft += e.deltaY;
      e.preventDefault();
    },
  };
}
