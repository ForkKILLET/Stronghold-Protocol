/** Search labels and original file IDs without exposing source URLs as selectable values. */
export function filterProfileAvatars(avatars,group='all',query='') {
  const needle=String(query).trim().toLocaleLowerCase();
  return Object.entries(avatars||{}).filter(([id,a])=>(group==='all'||a.group===group)
    && (!needle||(a.name+' '+id).toLocaleLowerCase().includes(needle))).map(([id,a])=>({id,...a}));
}
