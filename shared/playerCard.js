// Room display metadata only. Never accept URLs, identity, stats or gameplay settings.
export const isCardOperatorId = (v) => typeof v === 'string' && (v === '' || (v.length <= 80 && /^char_[a-zA-Z0-9_]+$/.test(v)));

/**
 * Old or damaged saves degrade to defaults; unknown fields are not forwarded.
 * @param {any} v
 * @param {(id: string) => boolean} [isOperator]
 */
export function cleanPlayerCard(v, isOperator = () => true) {
  const id = (s) => isCardOperatorId(s) && s && isOperator(s) ? s : '';
  return Object.freeze({ charId: id(v?.charId), avatar: id(v?.avatar) });
}
