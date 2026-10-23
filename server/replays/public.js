// A derived public view, never another stored replay format or another copy of the archive.
export function publicReplay(replay, ownerId) {
  const result = Object.fromEntries(['v', 'duration', 'cs', 'vs', 'modded', 'modeId', 'difficulty', 'fields'].map(key => [key, replay[key]]));
  result.players = replay.players.map(({ playerId, name, seat, isBot }) => ({ playerId, name, seat, isBot }));
  result.perspectives = [ownerId];
  result.events = replay.events.filter(event => event.kind === 'pool'
    || (event.kind === 'view' && (event.key === 'public' || event.key === ownerId))
    || (event.kind === 'action' && event.playerId === ownerId));
  return result;
}
