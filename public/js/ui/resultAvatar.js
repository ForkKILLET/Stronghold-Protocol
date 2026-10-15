// Settlement art shares the lobby's local choices and each teammate's published room metadata.
import { html } from './components.js';
import { PlayerAvatar, Img } from './gameComponents.js';
import { useMyCard } from './playerCard.js';
import { cardAvatarUrl, cardOperators } from './seatArt.js';
import { chessPortraitUrl } from './assetUrls.js';
import { useStore } from '../store.js';
import { data } from '../data.js';

function useResultCard(player, self) {
  const mine = useMyCard();
  const roomCard = useStore((s) => s.room?.seats?.find((seat) => seat?.playerId === player?.playerId)?.card || null);
  return player?.isBot ? null : self ? mine : player?.card ?? roomCard;
}

export function ResultAvatar({ player, self = false, ...props }) {
  const card = useResultCard(player, self);
  return html`<${PlayerAvatar} ...${props} player=${player} self=${self} avatar=${cardAvatarUrl(card?.avatar, data.get('assets'))} />`;
}

/** A chosen room portrait takes precedence; old results and unselected cards keep their lineup ace. */
export function ResultPortrait({ player, self = false, fallbackSrc = null, fallbackClass = '', fallback = null, class: cls = '' }) {
  const card = useResultCard(player, self);
  const chosen = card?.charId ? cardOperators(data.list('chess')).find((c) => c.charId === card.charId) : null;
  const src = chosen ? chessPortraitUrl(data.get('assets'), chosen) : null;
  return html`<${Img} src=${src || fallbackSrc} class=${`${cls} ${src ? 'is-portrait' : fallbackClass}`.trim()} fallback=${fallback} />`;
}
