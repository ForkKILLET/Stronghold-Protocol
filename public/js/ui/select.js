// Shared non-native select. Keep focus on the trigger; the fixed popover escapes scrolling panels.
import { render } from '../../vendor/preact.module.js';
import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';

let nextId = 0;
export function selectPlacement(rect, viewport, count, contentHeight = count * 38 + 10) {
  const margin = 8, gap = 4;
  const below = viewport.height - rect.bottom - margin - gap;
  const above = rect.top - margin - gap;
  const height = Math.min(contentHeight, 280, Math.max(0, Math.max(below, above)));
  const up = below < height && above > below;
  const width = Math.min(Math.max(rect.width, 160), viewport.width - margin * 2);
  return { left: Math.max(margin, Math.min(rect.left, viewport.width - width - margin)),
    top: up ? rect.top - gap - height : rect.bottom + gap, width, height };
}

/** options: {value, label, disabled?, lang?, title?}[]; onChange receives a string, like HTMLSelectElement.value. */
export function Select({ value, options = [], onChange, disabled = false, label, class: cls = '', ...attrs }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef(null), popup = useRef(null), search = useRef({text: '', at: 0});
  const id = useRef(null), position = useRef(null);
  if (!id.current) id.current = `game-select-${++nextId}`;
  const selected = options.findIndex(o => String(o.value) === String(value));
  const close = () => setOpen(false);
  const choose = i => { if (!disabled && options[i] && !options[i].disabled) { close(); onChange?.(String(options[i].value)); } };
  const show = () => { if (!disabled) { setActive(selected >= 0 ? selected : Math.max(0, options.findIndex(o => !o.disabled))); setOpen(true); } };
  useLayoutEffect(() => {
    if (!open || disabled) return undefined;
    const host = document.createElement('div');
    host.className = 'game-select-popover'; popup.current = host; document.body.append(host);
    const place = () => {
      const p = selectPlacement(trigger.current.getBoundingClientRect(), {width: innerWidth, height: innerHeight}, options.length, host.querySelector('.game-select__list')?.scrollHeight + 10 || undefined);
      Object.assign(host.style, {left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.height}px`});
    };
    position.current = place; place();
    const outside = e => { if (!host.contains(e.target) && !trigger.current?.contains(e.target)) close(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const scroll = e => { if (!host.contains(e.target)) close(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true);
      render(null, host); host.remove(); popup.current = null; position.current = null;
    };
  }, [open, disabled]);
  useLayoutEffect(() => {
    const host = popup.current;
    if (!host) return;
    render(html`<div class="game-select__list" role="listbox" id=${id.current} aria-label=${label || attrs['aria-label']}>
      ${options.map((o, i) => html`<button type="button" key=${String(o.value)} role="option" id=${`${id.current}-${i}`} tabIndex="-1"
        aria-selected=${i === selected} aria-disabled=${!!o.disabled} class=${`game-select__option${i === active ? ' is-active' : ''}`}
        lang=${o.lang} title=${o.title} onPointerDown=${e => e.preventDefault()} onPointerMove=${() => setActive(i)} onClick=${() => choose(i)}>
        <span>${o.label}</span>${i === selected ? html`<${Icon} name="check" />` : null}
      </button>`)}
    </div>`, host);
    position.current?.();
    const item = host.querySelector(`#${id.current}-${active}`);
    if (item && (item.offsetTop < host.scrollTop || item.offsetTop + item.offsetHeight > host.scrollTop + host.clientHeight)) host.scrollTop = item.offsetTop - host.clientHeight / 2;
  }, [open, active, selected, options]);
  useLayoutEffect(() => { if (disabled) close(); }, [disabled]);
  const key = e => {
    if (disabled) return;
    const move = delta => {
      let i = active;
      for (let n = 0; n < options.length; n++) { i = (i + delta + options.length) % options.length; if (!options[i].disabled) { setActive(i); break; } }
    };
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      if (!open) { show(); if (e.key === 'Home') setActive(Math.max(0, options.findIndex(o => !o.disabled))); if (e.key === 'End') setActive(options.findLastIndex(o => !o.disabled)); }
      else if (e.key === 'Enter' || e.key === ' ') choose(active);
      else if (e.key === 'Home') setActive(Math.max(0, options.findIndex(o => !o.disabled)));
      else if (e.key === 'End') setActive(options.findLastIndex(o => !o.disabled));
      else move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      search.current.text = (Date.now() - search.current.at < 700 ? search.current.text : '') + e.key.toLocaleLowerCase();
      search.current.at = Date.now();
      const i = options.findIndex(o => !o.disabled && String(o.label).toLocaleLowerCase().startsWith(search.current.text));
      if (i >= 0) { if (!open) show(); setActive(i); }
    }
  };
  return html`<button ...${attrs} ref=${trigger} type="button" class=${`game-select ${cls}`} role="combobox" aria-label=${label || attrs['aria-label']}
    aria-expanded=${open && !disabled} aria-haspopup="listbox" aria-controls=${open ? id.current : undefined}
    aria-activedescendant=${open ? `${id.current}-${active}` : undefined} disabled=${disabled} onKeyDown=${key}
    onBlur=${close} onClick=${() => open ? close() : show()}>
    <span class="game-select__value">${options[selected]?.label ?? '—'}</span><${Icon} name="chevronRight" class="game-select__arrow" />
  </button>`;
}
