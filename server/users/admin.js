// Account projections run in the SQLite Worker; never export internal IDs or credentials.
export function installAdminUsers(db) {
  const roster=`WITH activity AS (
    SELECT value AS payload,json_extract(value,'$.accountId') AS account_id FROM json_each(?)
  ), roster AS (
    SELECT p.public_id AS id,p.public_id AS publicId,u.name,u.avatar_id AS avatarId,
      u.created_at AS createdAt,1 AS persistent,a.payload AS activity
    FROM users u JOIN public_profiles p ON p.user_id=u.id LEFT JOIN activity a ON a.account_id=u.id
    UNION ALL
    SELECT json_extract(a.payload,'$.id'),NULL,json_extract(a.payload,'$.name'),NULL,NULL,0,a.payload
    FROM activity a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=a.account_id)
  ), players AS (
    SELECT *,coalesce(json_extract(activity,'$.connected'),0) AS connected FROM roster
  ) `;
  return {
    list({active=[],page=1,query='',status='all'}) {
      const input=JSON.stringify(active);
      const counts=db.prepare(roster+`SELECT sum(persistent) AS accounts,
        coalesce(sum(persistent AND connected),0) AS online,
        coalesce(sum(persistent AND NOT connected),0) AS offline,
        coalesce(sum(NOT persistent),0) AS temporary FROM players`).get(input);
      counts.accounts ||= 0;
      const filter=`WHERE (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(coalesce(publicId,'')),lower(?))>0)
        AND (?='all' OR (?='online' AND connected) OR (?='offline' AND NOT connected)
          OR (?='disconnected' AND activity IS NOT NULL AND NOT connected)
          OR (connected AND (?=coalesce(json_extract(activity,'$.state'),'lobby')
            OR EXISTS (SELECT 1 FROM json_each(json_extract(activity,'$.locations')) WHERE json_extract(value,'$.state')=?))))`;
      const params=[input,query,query,query,status,status,status,status,status,status];
      const {total}=db.prepare(roster+'SELECT count(*) AS total FROM players '+filter).get(...params);
      const pages=Math.max(1,Math.ceil(total/50));page=Math.min(page,pages);
      const rows=db.prepare(roster+'SELECT * FROM players '+filter+`
        ORDER BY connected DESC,coalesce(json_extract(activity,'$.lastSeen'),createdAt) DESC,id
        LIMIT 50 OFFSET ?`).all(...params,(page-1)*50);
      return {items:rows.map(({activity,connected,persistent,...row})=>{
        const {accountId:_accountId,...session}=activity?JSON.parse(activity):{};
        return {...session,...row,connected:!!connected,persistent:!!persistent,
          state:connected?session.state || 'lobby':activity?'disconnected':'offline'};
      }),counts,total,page,pages};
    },
  };
}
