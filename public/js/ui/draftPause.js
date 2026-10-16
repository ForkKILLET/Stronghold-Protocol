// Pre-game pause ownership stays with the same participant/vote protocol as combat.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { PauseButton } from './hud.js';
import { PausedOverlay } from '../screens/game/overlays.js';
import { actions } from './gameActions.js';
import { shortcutFor } from './gameLogic.js';
import { shortcutsStore } from './settings.js';

/** The briefing and strategy draft use the same pause control as the combat HUD. */
export function DraftPause({ pub, standalone }) {
  const myId = useStore(s => s.me.playerId);
  const [busy, setBusy] = useState(false);
  const participant = pub.players?.find(p => p.playerId === myId);
  const requested = !!pub.pauseRequests?.includes(myId);
  const toggle = async () => { if (busy) return; setBusy(true); try { await actions.pause(!requested); } finally { setBusy(false); } };
  useEffect(() => {
    const onKey = e => {
      if (!standalone || e.repeat || !participant?.alive || shortcutFor(e, shortcutsStore.get()) !== 'pause'
        || document.querySelector('.modal, .guide, .st, .lo')) return;
      e.preventDefault(); toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requested, busy, participant?.alive, standalone]);
  return html`
    ${participant?.alive ? html`<div class="draft-pause"><${PauseButton} paused=${pub.paused} requested=${requested}
      votes=${pub.pauseRequests?.length || 0} required=${pub.pauseRequired?.length || 1} busy=${busy} onToggle=${toggle} /></div>` : null}
    ${standalone && pub.paused ? html`<${PausedOverlay} canResume=${!!participant?.alive} busy=${busy} onResume=${toggle} />` : null}`;
}
