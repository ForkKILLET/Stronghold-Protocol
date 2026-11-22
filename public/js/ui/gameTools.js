import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { CombatMetricsPanel } from './combatMetrics.js';
import { CardCounterPanel } from './cardCounter.js';
import { useCornerPanel } from './cornerPanel.js';
import { GAME_TOOLS, pinnedTools } from './gameToolsModel.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

function ToolsMenu({ pinned, onPin, onOpen, onClose, tools }) {
  const panel = useRef(null), close = useRef(null);
  useCornerPanel(panel, close, onClose);
  useEffect(() => {
    const outside = e => {
      if (!panel.current?.contains(e.target) && !e.target.closest?.('.gm__tools')) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return html`<section ref=${panel} class="combat-metrics game-tools__menu brackets" id="game-tools-menu" role="dialog" aria-label=${t('小工具')}
      onKeyDown=${e => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="combat-metrics__head"><h2>${t('小工具')}</h2>
      <button ref=${close} class="combat-metrics__close" type="button" aria-label=${t('关闭小工具')} onClick=${onClose}><${Icon} name="close" /></button>
    </header>
    <div class="game-tools__list">${tools.map(tool => html`<div key=${tool.id} class="game-tools__row">
      <button class="game-tools__open" type="button" onClick=${() => onOpen(tool.id)}><${Icon} name=${tool.icon} />
        <span><b>${t(tool.label)}</b><small>${t(tool.description)}</small></span></button>
      <button class="game-tools__pin" type="button" aria-label=${(pinned.includes(tool.id) ? t('取消固定') : t('固定到工具栏'))}
          title=${(pinned.includes(tool.id) ? t('取消固定') : t('固定到工具栏'))} aria-pressed=${pinned.includes(tool.id)}
          onClick=${() => onPin(tool.id)}><${Icon} name="pin" /></button>
    </div>`)}</div>
    <p class="game-tools__note">${t('常用工具可固定在外面')}</p>
  </section>`;
}

/** One menu for pinned tools; the quiet Boss chart can coexist with a detailed tool. */
export function GameTools({ myId, pub, connected = true, onOpen, boss, spectator = false }) {
  const [pinned, setPinned] = useState(() => pinnedTools(loadPref('gameTools', null)));
  const [active, setActive] = useState(null);
  const [menu, setMenu] = useState(false);
  const tools = GAME_TOOLS.filter(tool => !spectator || tool.id === 'boss');
  const isOpen = id => id === 'boss' ? !!boss?.open : active === id;
  const close = () => setActive(null);
  const open = id => {
    setMenu(false);
    if (id === 'boss') boss?.toggle();
    else setActive(current => current === id ? null : id);
    if (active !== id) onOpen?.();
  };
  const pin = id => setPinned(current => {
    const next = pinnedTools({ v: 1, pinned: current.includes(id) ? current.filter(x => x !== id) : [...current, id] });
    savePref('gameTools', { v: 1, pinned: next });
    return next;
  });
  return html`${active === 'metrics' ? html`<${CombatMetricsPanel} myId=${myId} onClose=${close} />` : null}
    ${active === 'cards' ? html`<${CardCounterPanel} myId=${myId} pub=${pub} connected=${connected} onClose=${close} />` : null}
    ${menu ? html`<${ToolsMenu} pinned=${pinned} onPin=${pin} onOpen=${open} tools=${tools} onClose=${() => setMenu(false)} />` : null}
    ${tools.filter(tool => pinned.includes(tool.id)).map(tool => html`<button key=${tool.id} type="button"
      class=${`gm__gear gm__${tool.id}`} aria-label=${t(tool.label)} title=${t(tool.label)}
      aria-expanded=${isOpen(tool.id)} aria-controls=${tool.id === 'metrics' ? 'combat-metrics-panel' : tool.id === 'boss' ? 'leader-rank-panel' : 'card-counter-panel'}
      onKeyDown=${e => { if (e.key === ' ') e.stopPropagation(); }} onClick=${() => open(tool.id)}><${Icon} name=${tool.icon} /></button>`)}
    <button type="button" class="gm__gear gm__tools" aria-label=${t('小工具')} title=${t('小工具')} aria-expanded=${menu} aria-controls="game-tools-menu"
      onKeyDown=${e => { if (e.key === ' ') e.stopPropagation(); }} onClick=${() => { setMenu(!menu); setActive(null); if (!menu) onOpen?.(); }}><${Icon} name="tools" /></button>`;
}
