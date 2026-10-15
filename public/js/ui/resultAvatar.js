// Settlement art shares the lobby's local choices and each teammate's published room metadata.
import { html } from './components.js';
import { PlayerAvatar, Img } from './gameComponents.js';
import { useMyCard } from './playerCard.js';
import { cardAvatarUrl, cardOperators, cardPortraitUrl } from './seatArt.js';
import { cardPortraitOperatorId } from '../../../shared/playerCard.js';
import { OperatorPortrait } from './operatorPortrait.js';
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
export function ResultPortrait({ player, self = false, fallbackSrc = null, fallbackChess = null, fallbackClass = '', fallback = null, class: cls = '' }) {
  const card = useResultCard(player, self);
  const chosen = card?.charId ? cardOperators(data.list('chess')).find((c) => c.charId === cardPortraitOperatorId(card.charId)) : null;
  const src = chosen ? cardPortraitUrl(card.charId, data.get('assets'), chosen) : null;
  const lineup = fallbackChess ? html`<${OperatorPortrait} m=${data.get('assets')} chess=${fallbackChess}
    ownerId=${player?.playerId ?? null} skin=${player?.isBot ? null : undefined} class=${`${cls} ${fallbackClass}`.trim()} fallback=${fallback} />` : fallback;
  const base = chosen ? cardPortraitUrl(chosen.charId, data.get('assets'), chosen) : null;
  return html`<${Img} src=${src || (fallbackChess ? null : fallbackSrc)} class=${`${cls} ${src ? 'is-portrait' : fallbackClass}`.trim()}
    fallback=${src && src !== base ? html`<${Img} src=${base} class=${`${cls} is-portrait`.trim()} fallback=${lineup} />` : lineup} />`;
}
