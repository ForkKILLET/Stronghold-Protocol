// Settlement avatars share the lobby's local choice and each teammate's published room metadata.
import { html } from './components.js';
import { PlayerAvatar } from './gameComponents.js';
import { useMyCard } from './playerCard.js';
import { cardAvatarUrl } from './seatArt.js';
import { useStore } from '../store.js';
import { data } from '../data.js';

export function ResultAvatar({ player, self = false, ...props }) {
  const mine = useMyCard();
  const roomCard = useStore((s) => s.room?.seats?.find((seat) => seat?.playerId === player?.playerId)?.card || null);
  const card = player?.isBot ? null : self ? mine : player?.card ?? roomCard;
  return html`<${PlayerAvatar} ...${props} player=${player} self=${self} avatar=${cardAvatarUrl(card?.avatar, data.get('assets'))} />`;
}
