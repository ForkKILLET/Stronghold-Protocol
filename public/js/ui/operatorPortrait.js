// All gameplay portraits follow the operator's owner and the viewer's skin switch.
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { chessPortraitUrl } from './assetUrls.js';
import { useStore } from '../store.js';
import { skinsStore } from './skins.js';
import { settingsStore } from './settings.js';
import { visibleSkin } from '../../../shared/skins.js';

export function portraitSkin(chess, { state, entries, settings, ownerId, skin } = {}) {
  if (!chess || chess.isDiy || chess.isHidden || chess.standInFor) return null;
  if (skin !== undefined) return visibleSkin(skin, settings);
  const id = chess.baseId || chess.chessId;
  const owner = ownerId === undefined ? state?.me?.playerId : ownerId;
  const player = state?.match?.public?.players?.find((p) => p.playerId === owner);
  if (player?.isBot) return null;
  // An explicit foreign owner must never inherit this browser's selection.
  const selected = player ? player.skins?.[id]
    : ownerId === undefined || (owner != null && owner === state?.me?.playerId) ? entries?.[id] : null;
  return visibleSkin(selected, settings);
}

export function OperatorPortrait({ m, chess, ownerId, skin, fallback = null, ...props }) {
  const id = chess?.baseId || chess?.chessId;
  const enabled = useStore((s) => s.skinsEnabled, undefined, settingsStore);
  const local = useStore((s) => s.entries[id] || null, undefined, skinsStore);
  // Subscribe to this portrait's resolved choice, so unrelated snapshots do not redraw every roster image.
  const selected = useStore((state) => portraitSkin(chess, {
    state, entries: { [id]: local }, settings: { skinsEnabled: enabled }, ownerId, skin,
  }));
  const base = chessPortraitUrl(m, chess);
  const src = chessPortraitUrl(m, chess, { skin: selected });
  return html`<${Img} ...${props} src=${src} fallback=${src !== base
    ? html`<${Img} ...${props} src=${base} fallback=${fallback} />` : fallback} />`;
}
