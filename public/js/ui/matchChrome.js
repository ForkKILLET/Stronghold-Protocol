import { DraftPause } from './draftPause.js';
// Chrome shared by every in-match screen: the step header of the pre-game screens (exit + ping +
// difficulty | "1/2 确认本局信息" | countdown) and the exit flow (confirm with 暂离 / 放弃, AI 托管 overlay).
//
// 暂离 (co-op): turns on AI 托管 (g.autoplay on) so the seat keeps playing; the overlay's 返回模拟 turns it
// off. 放弃模拟: g.leave (room.leave when no match remains), back to the lobby.

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, DifficultyTag, Countdown, MicroLabel, PingPill } from './components.js';
import { UnofficialMark, VersionTag } from './pluginTag.js';
import { actions } from './gameActions.js';
import { toastError } from './toasts.js';
import { net } from '../net.js';
import { store, useStore, emptyMatch, createStore, isSpectating } from '../store.js';
import { GIcon } from './gameComponents.js';
import { recordQuit } from './stats.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';
import { TestMark } from './testConsole.js';
import { ladderName } from './hud.js';

/**
 * Exit dialog lines. 放弃模拟 ends the run on the server as 'abandoned' and returns to the
 * lobby straight away — no settlement screen follows, so the solo text must not promise one.
 */
export const EXIT_TEXT = Object.freeze({
  soloRest: N_('独立模拟的休整期没有时间限制，你可以随时继续。'),
  soloQuit: N_('放弃模拟将立即结束本局并返回大厅，本局进度不会保留，也不会进行结算。'),
});

/** Local "暂离 / AI 托管" flag (the server keeps no per-client autoplay view). */
export const awayStore = createStore({ away: false });

/**
 * Whether a store change ends the match the 暂离 flag belongs to: its state was cleared (result → 返回同盟, 放弃模拟, a
 * new match starting, the room closing, a new server session) or its settlement arrived. The next match must never
 * open under the previous one's "AI 托管中" overlay (the server starts every match with autoplay off).
 * @param {any} s store state
 * @param {any} prev previous store state
 */
export const awayEnds = (s, prev) => (!!prev?.match?.public && !s?.match?.public) || (!!s?.match?.result && !prev?.match?.result);
store.subscribe((s, prev) => { if (awayStore.get().away && awayEnds(s, prev)) awayStore.set({ away: false }); });

/**
 * Leave the match for good (g.leave, room.leave if it has already ended), then drop local room/match state. The server sends a leaver no
 * settlement, so the page records the match itself before it is cleared (本机统计, ui/stats.js recordQuit: a 中途退出
 * entry of the history; it counts only when a round had been cleared) — once the leave went through.
 * @returns {Promise<void>}
 */
export async function quitMatch() {
  const before = store.get();
  let left = false;
  try {
    try { await net.request('g.leave', {}); left = true; } catch (err) {
      if (err?.code === 'NOT_IN_ROOM') left = true;
      else if (err?.code !== 'WRONG_PHASE') throw err;
    }
    // g.leave already removes the member and clears session.roomCode. Only a room without a running match
    // (WRONG_PHASE) needs room.leave; a redundant request cannot revoke an acknowledged departure.
    if (!left) {
      try { await net.request('room.leave', {}); } catch (err) { if (err?.code !== 'NOT_IN_ROOM') throw err; }
      left = true;
    }
  } catch (err) {
    toastError(err);
  } finally {
    // (a settlement that arrived while the leave was in flight is the match's record already)
    if (left && !store.get().match.result) {
      try { recordQuit(before); } catch (err) { console.warn('[stats] quit record failed', err); }
    }
    // A failed request does not establish that the server released the seat. Keep the latest view for retry/reconnect.
    if (left) store.set({ room: null, match: emptyMatch() });
  }
}

/**
 * Exit confirmation modal.
 * @param {{ open: boolean, onClose: Function, solo: boolean, onAway?: Function }} props
 */
export function ExitModal({ open, onClose, solo, onAway }) {
  const [busy, setBusy] = useState(null);
  // a spectator seat (community report #26) only leaves its seat: nothing of the match is given up
  const spectator = useStore((s) => isSpectating(s.room, s.me.playerId));
  const quit = async () => {
    setBusy('quit');
    await quitMatch();
    setBusy(null);
    onClose();
  };
  if (spectator) {
    return html`<${Modal} open=${open} onClose=${onClose} tone="red" title=${t('离开观战')} micro="LEAVE SPECTATING" width="6.8rem"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('取消')}<//>
        <${Button} variant="danger" icon="exit" loading=${busy === 'quit'} onClick=${quit}>${t('离开观战')}<//>`}>
      <div class="exitm"><p>${t('离开观战席并返回大厅，本局模拟不受影响；观战席空着时可以凭同盟密钥再次观战。')}</p></div>
    <//>`;
  }
  const away = async () => {
    setBusy('away');
    const ok = await actions.autoplay(true);
    setBusy(null);
    onClose();
    if (ok) { awayStore.set({ away: true }); onAway?.(); }
  };
  return html`<${Modal} open=${open} onClose=${onClose} tone="red" title=${t('离开模拟')} micro="LEAVE SIMULATION" width="6.8rem"
    actions=${html`
      <${Button} variant="secondary" onClick=${onClose}>${t('取消')}<//>
      ${!solo ? html`<${Button} variant="ice" icon="robot" loading=${busy === 'away'} onClick=${away}>${t('暂离（AI 托管）')}<//>` : null}
      <${Button} variant="danger" icon="exit" loading=${busy === 'quit'} onClick=${quit}>${t('放弃模拟')}<//>`}>
    <div class="exitm">
      ${solo
        ? html`<p>${t(EXIT_TEXT.soloRest)}</p><p class="t-lo">${t(EXIT_TEXT.soloQuit)}</p>`
        : html`<p>${tParts('{away}：由 AI 托管你的席位（自动部署、准备与选择），随时可以返回。', { away: html`<b class="t-ice">${t('暂离')}</b>` })}</p>
               <p>${tParts('{quit}：离开后无法返回本局，你的干员将回到共享卡池。', { quit: html`<b class="t-red">${t('放弃模拟')}</b>` })}</p>`}
    </div>
  <//>`;
}

/** Full-screen "AI 托管中" overlay with 返回模拟. */
export function AwayOverlay({ onBack = () => {} }) {
  const [busy, setBusy] = useState(false);
  return html`<div class="awayov" role="dialog" aria-label=${t('AI 托管中')}>
    <div class="awayov__box brackets">
      <${GIcon} name="robot" class="awayov__icon" />
      <${MicroLabel} tone="mint">${t('AUTOPILOT // AI 托管')}</${MicroLabel}>
      <h2>${t('AI 托管中')}</h2>
      <p class="t-lo">${t('AI 正在代为操作你的席位')}</p>
      <${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${async () => { setBusy(true); const ok = await actions.autoplay(false); setBusy(false); if (ok) { awayStore.set({ away: false }); onBack(); } }}>${t('返回模拟')}<//>
    </div>
  </div>`;
}

/**
 * Preparation uses the battle HUD's navigation and controls in one band. The middle
 * owns step / title; neither turn changes nor dialogs move the corners.
 * @param {{ step: number, of: number, title: string, micro: string, pub: any, total?: number|null, onExit: Function }} props
 */
export function StepHeader({ step, of, title, micro, pub, total, onExit }) {
  const conn = useStore(s => s.connection);
  const room = useStore(s => s.room);
  return html`<header class="stephead preparation-hud" aria-label=${title} data-testid="preparation-hud">
    <div class="gtop__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label=${t('离开')} title=${t('离开 / 暂离')} class="gtop__exit tapx" />
      <div class="gtop__meta">
        <${PingPill} ms=${conn.ping} online=${conn.status === 'online'} />
        ${pub?.difficulty ? html`<${DifficultyTag} difficulty=${pub.difficulty} name=${ladderName(pub)} size="sm" />` : null}
        ${pub?.test ? html`<${TestMark} class="gtop__test" />` : null}
        <div class="preparation-hud__rules"><${UnofficialMark} room=${room} compact=${true} /><${VersionTag} room=${room} compact=${true} /></div>
      </div>
    </div>
    <div class="stephead__middle">
      <div class="preparation-hud__heading gtop__frame" title=${micro}>
        <span class="stephead__progress num"><b>${step}</b><span>/${of}</span></span>
        <h1 class="stephead__name">${title}</h1>
      </div>
    </div>
    <div class="stephead__right">
      <${Countdown} deadline=${pub?.deadline} total=${total ?? undefined} size="md" />
      <${DraftPause} pub=${pub} standalone=${true} />
    </div>
  </header>`;
}

