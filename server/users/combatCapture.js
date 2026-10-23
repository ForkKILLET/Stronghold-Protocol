// Server-owned field manifest, independent of replay recording and its retention budget.
export function captureCombatSpec(match, spec) {
  if (!match.userMatchId) return;
  const archive = match.combatArchive ??= {v:1, fields:[]};
  const battleId = spec.battleId || `${match.round}:${spec.fieldId}`;
  if (archive.fields.some(f=>f.battleId===battleId)) return;
  if (archive.fields.length >= 512) {archive.truncated=true; return;}
  archive.fields.push({battleId,round:match.round,fieldId:spec.fieldId,cs:spec.cs || match.cs || null,
    players:(spec.players || []).map(p=>p.playerId),seconds:null});
}
export function captureCombatEnd(match, field, result) {
  const entry = match.combatArchive?.fields.findLast(f=>f.round===match.round && f.fieldId===field.fieldId);
  if (!entry || entry.seconds !== null) return;
  const seconds = result?.time ?? field.endGt ?? field.battle?.time;
  if (Number.isFinite(seconds) && seconds>=0) entry.seconds=seconds;
}
export function finishCombatCapture(match) {
  for (const field of match.fields) captureCombatEnd(match,field,field.result);
  return match.combatArchive || null;
}
