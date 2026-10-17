// A button-based language list can follow the UI scale without an editable native
// select's 16px focus-zoom floor. Other native inputs retain their existing guards.
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';

let nextId = 0;

export function LanguageMenuView({ items, label, open, active, id, class: cls = '', hostRef, triggerRef, listRef, onNavigate, onDismiss, onPick }) {
  const selected = items.find(item => item.on) || items[0];
  const keyDown = (event) => {
    if (event.isComposing) return;
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onDismiss(true); return;
    }
    if (open && event.key === 'Tab') { onDismiss(true); return; }
    if (!items.length) return;
    let index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      index = open ? (active + direction + items.length) % items.length : Math.max(0, items.findIndex(item => item.on));
    } else if (open && event.key === 'Home') index = 0;
    else if (open && event.key === 'End') index = items.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation(); onNavigate(index);
  };
  return html`<div ref=${hostRef} class=${`set-seg lang-toggle set-lang-picker${cls ? ` ${cls}` : ''}`} data-testid="lang-toggle"
      onKeyDown=${keyDown} onBlur=${event => {
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onDismiss(false);
      }}>
    <button ref=${triggerRef} type="button" class="set-lang__trigger" aria-label=${`${label}: ${selected?.label || ''}`} aria-haspopup="listbox"
      aria-expanded=${open ? 'true' : 'false'} aria-controls=${open ? id : undefined}
      onClick=${() => open ? onDismiss(false) : onNavigate(Math.max(0, items.findIndex(item => item.on)))}>
      <span lang=${selected?.htmlLang}>${selected?.label}</span><${Icon} name="chevronRight" />
    </button>
    ${open ? html`<div ref=${listRef} id=${id} class="set-lang__list" role="listbox" aria-label=${label}>
      ${items.map((item, index) => html`<button key=${item.code} type="button" class=${`set-lang__option${item.on ? ' is-on' : ''}`}
        role="option" aria-selected=${item.on ? 'true' : 'false'} tabindex=${index === active ? 0 : -1}
        lang=${item.htmlLang} title=${item.title || undefined} onClick=${() => onPick(item.code)}>${item.label}</button>`)}
    </div>` : null}
  </div>`;
}

export function LanguageMenu({ items, label, onSelect, class: cls }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const host = useRef(null), trigger = useRef(null), list = useRef(null);
  const id = useRef(null);
  if (!id.current) id.current = `language-menu-${++nextId}`;
  const dismiss = (restoreFocus) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const option = list.current?.querySelectorAll('[role="option"]')[active];
    option?.focus();
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (!open) return undefined;
    const doc = host.current?.ownerDocument;
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    doc?.addEventListener('pointerdown', outside);
    return () => doc?.removeEventListener('pointerdown', outside);
  }, [open]);
  return html`<${LanguageMenuView} items=${items} label=${label} class=${cls} open=${open} active=${active} id=${id.current}
    hostRef=${host} triggerRef=${trigger} listRef=${list} onNavigate=${index => { setActive(index); setOpen(true); }}
    onDismiss=${dismiss} onPick=${code => { dismiss(true); onSelect(code); }} />`;
}
