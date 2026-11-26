import { useEffect, useId, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** Native non-modal popovers share light dismiss, Escape and keyboard focus without a battlefield veil. */
export function RoomVoteControl({ title, hint = title, icon, badge = 0, pressed = false, busy = false, visible = true,
  testId, resetKey, children, onOpenChange }) {
  const id = `room-vote-${useId()}`;
  const anchor = useRef(null), panel = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { panel.current?.hidePopover(); setOpen(false); onOpenChange?.(false); }, [resetKey, visible]);
  useLayoutEffect(() => {
    const el = panel.current, button = anchor.current;
    if (!open || !el || !button) return undefined;
    const measure = () => {
      const r = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const top = Math.min(r.bottom + 8, y + height - 100);
      el.style.maxHeight = `${Math.max(80, y + height - top - 12)}px`;
      el.style.left = `${Math.max(x + 12, Math.min(r.right - el.getBoundingClientRect().width, x + width - el.getBoundingClientRect().width - 12))}px`;
      el.style.top = `${Math.max(y + 12, top)}px`;
      el.dataset.positioned = 'true';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button); observer.observe(el);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [open]);
  if (!visible) return null;
  return html`<span class="room-vote-control">
    <button ref=${anchor} type="button" class=${`pausebtn tapx room-vote-entry${pressed ? ' is-on' : ''}`}
      aria-label=${badge > 0 ? `${title} (${badge})` : title} title=${hint} aria-haspopup="dialog" aria-expanded=${open} aria-controls=${id} aria-pressed=${pressed}
      disabled=${busy} popovertarget=${id} data-testid=${testId}
      onKeyDown=${e => { if (e.key === ' ' || e.key === 'Escape' && open) e.stopPropagation(); }}>
      <${Icon} name=${icon} class="pausebtn__glyph" />
      ${badge > 0 ? html`<span class="room-vote-entry__badge">${badge}</span>` : null}
    </button>
    <section ref=${panel} id=${id} class="room-vote-panel" popover="auto" role="dialog" aria-label=${title}
      onToggle=${e => {
        const next = e.newState === 'open';
        if (!next) delete e.currentTarget.dataset.positioned;
        setOpen(next); onOpenChange?.(next);
      }} onKeyDown=${e => e.stopPropagation()}>
      <header class="room-vote-panel__head"><h2>${title}</h2>
        <button type="button" class="tapx" aria-label=${t('关闭投票')} onClick=${() => panel.current?.hidePopover()}><${Icon} name="close" /></button>
      </header>
      <div class="room-vote-panel__body">${children}</div>
    </section>
  </span>`;
}

export function VoteCard({ title, yes = [], no = [], eligible = [], required, players = [], myId, note, children }) {
  const approved = eligible.filter(id => yes.includes(id)).length;
  return html`<section class="room-vote-card">
    ${title ? html`<h3>${title}</h3>` : null}
    <div class="room-vote-card__progress"><span>${t('同意进度')}</span><b class="num">${approved}/${required}</b></div>
    <progress value=${approved} max=${required} aria-label=${t('同意进度')} />
    ${note ? html`<p class="room-vote-card__note">${note}</p>` : null}
    <ul class="room-vote-card__voters">${eligible.map(id => html`<li key=${id}>
      <span>${players.find(p => p.playerId === id)?.name || id}${id === myId ? ` · ${t('我')}` : ''}</span>
      <b class=${yes.includes(id) ? 'is-yes' : no.includes(id) ? 'is-no' : ''}>${yes.includes(id) ? t('已同意') : no.includes(id) ? t('已拒绝') : t('待表态')}</b>
    </li>`)}</ul>
    <div class="room-vote-card__actions">${children}</div>
  </section>`;
}

export function PauseVoteButton({ paused, requested = paused, mode = 'vote', votes = 0, required = 1, busy = false, shortcut = '', onToggle }) {
  const pub = useStore(s => s.match.public), myId = useStore(s => s.me.playerId);
  if (mode === 'veto' || required <= 1 || paused) {
    const label = paused ? mode === 'veto' && !requested ? t('拒绝暂停') : t('继续作战') : requested ? t('撤回暂停请求') : t('请求暂停');
    return html`<button type="button" class=${`pausebtn tapx room-vote-entry${requested ? ' is-on' : ''}`} aria-label=${label}
      title=${shortcut ? `${label} (${shortcut})` : label} aria-pressed=${requested} disabled=${busy} data-testid="pause"
      onKeyDown=${e => { if (e.key === ' ') e.stopPropagation(); }} onClick=${onToggle}>
      <${Icon} name=${paused ? 'play' : 'pause'} class="pausebtn__glyph" />
    </button>`;
  }
  return html`<${RoomVoteControl} title=${t('暂停投票')} icon="pause" badge=${votes > 0 ? 1 : 0} pressed=${requested}
    hint=${`${t('暂停投票')} (${shortcut})`} testId="pause" resetKey=${`${pub?.phase}:${pub?.round}`}>
    <${VoteCard} title=${votes ? t('请求暂停') : t('暂无投票')} yes=${pub?.pauseRequests || []}
      eligible=${pub?.pauseRequired || []} required=${required} players=${pub?.players || []} myId=${myId}
      note=${t('投票通过：所有在线且未淘汰的玩家同意后暂停。')}>
      <${Button} variant=${requested ? 'default' : 'primary'} disabled=${busy} onClick=${onToggle}>
        ${requested ? t('撤回暂停请求') : t('请求暂停')}
      <//>
    <//>
  <//>`;
}
