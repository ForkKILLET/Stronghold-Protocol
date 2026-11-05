// All gameplay portraits follow the operator's owner and the viewer's skin switch.
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { chessPortraitUrl } from './assetUrls.js';
import { useStore } from '../store.js';
import { skinsStore } from './skins.js';
import { settingsStore } from './settingsStore.js';
import { portraitSkin } from '../../../shared/skins.js';
export { portraitSkin } from '../../../shared/skins.js';

export function OperatorPortrait({ m, chess, ownerId, skin, fallback = null, ...props }) {
  const id = chess?.baseId || chess?.chessId;
  const key = chess?.isDiy ? id : chess?.charId || id;
  const other = useStore(s => s.otherSkins !== false, undefined, settingsStore);
  const enabled = useStore((s) => s.skinsEnabled, undefined, settingsStore);
  const local = useStore((s) => s.entries[key] || s.entries[id] || null, undefined, skinsStore);
  // Subscribe to this portrait's resolved choice, so unrelated snapshots do not redraw every roster image.
  const selected = useStore((state) => portraitSkin(chess, {
    state, entries: { [key]: local }, settings: { skinsEnabled: enabled, otherSkins: other }, ownerId, skin,
  }));
  const base = chessPortraitUrl(m, chess);
  const src = chessPortraitUrl(m, chess, { skin: selected });
  return html`<${Img} ...${props} src=${src} fallback=${src !== base
    ? html`<${Img} ...${props} src=${base} fallback=${fallback} />` : fallback} />`;
}
