import {randomInt} from 'node:crypto';
import {DOCTOR_ID_ALPHABET, DOCTOR_ID_LENGTH, PRIVATE_PROFILE, normalizeDoctorId, validVisibility} from '../../shared/publicProfiles.js';

export const PUBLIC_PROFILE_SCHEMA_VERSION = 2;
const capacity = DOCTOR_ID_ALPHABET.length ** DOCTOR_ID_LENGTH;
export function installPublicProfiles(db, {randomStart = () => randomInt(capacity)} = {}) {
  const q = sql => db.prepare(sql);
  function allocate() {
    const start = randomStart();
    // Probe distinct slots after a random start: repeated collisions cannot loop forever.
    for (let offset = 0; offset < capacity; offset++) {
      let value = (start + offset) % capacity, publicId = '';
      for (let i = 0; i < DOCTOR_ID_LENGTH; i++) {
        publicId = DOCTOR_ID_ALPHABET[value % DOCTOR_ID_ALPHABET.length] + publicId;
        value = Math.floor(value / DOCTOR_ID_ALPHABET.length);
      }
      if (!q('SELECT 1 FROM public_profiles WHERE public_id=?').get(publicId)) return publicId;
    }
    throw new Error('Public doctor ID space exhausted');
  }
  function ensure(id) {
    if (!q('SELECT 1 FROM public_profiles WHERE user_id=?').get(id)) {
      q('INSERT INTO public_profiles(user_id,public_id,visibility) VALUES(?,?,?)').run(id, allocate(), JSON.stringify(PRIVATE_PROFILE));
    }
    const row = q('SELECT public_id AS publicId,visibility FROM public_profiles WHERE user_id=?').get(id);
    if (normalizeDoctorId(row.publicId) !== row.publicId) throw new Error('Invalid stored public doctor ID');
    return {publicId: row.publicId, visibility: JSON.parse(row.visibility)};
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS public_profile_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
    INSERT OR IGNORE INTO public_profile_schema(id,version) VALUES(1,${PUBLIC_PROFILE_SCHEMA_VERSION});
    CREATE TABLE IF NOT EXISTS public_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),public_id TEXT NOT NULL UNIQUE,visibility TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public_replays(user_id TEXT NOT NULL,game_id TEXT NOT NULL,
      PRIMARY KEY(user_id,game_id),FOREIGN KEY(user_id,game_id) REFERENCES user_replays(user_id,game_id) ON DELETE CASCADE);`);
    const version = q('SELECT version FROM public_profile_schema WHERE id=1').get().version;
    if (version !== 1 && version !== PUBLIC_PROFILE_SCHEMA_VERSION) throw new Error('Unsupported public profile schema');
    if (version === 1) {
      for (const row of q('SELECT user_id,public_id FROM public_profiles').all()) {
        if (normalizeDoctorId(row.public_id) !== row.public_id) {
          q('UPDATE public_profiles SET public_id=? WHERE user_id=?').run(allocate(), row.user_id);
        }
      }
    }
    for (const {id} of q('SELECT id FROM users').all()) ensure(id);
    q('UPDATE public_profile_schema SET version=? WHERE id=1').run(PUBLIC_PROFILE_SCHEMA_VERSION);
    db.exec('COMMIT');
  }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  return {
    ensure,
    find(publicId) {
      const row = q('SELECT u.id,u.name,u.avatar_id AS avatarId,p.public_id AS publicId,p.visibility FROM users u JOIN public_profiles p ON p.user_id=u.id WHERE p.public_id=?').get(publicId);
      return row ? {...row, visibility: JSON.parse(row.visibility)} : null;
    },
    update(id, patch) {
      if (!validVisibility(patch)) return {error: 'VISIBILITY'};
      const current = ensure(id), visibility = {...current.visibility, ...patch};
      q('UPDATE public_profiles SET visibility=? WHERE user_id=?').run(JSON.stringify(visibility), id);
      return {...current, visibility};
    },
    share(id, matchId, shared) {
      if (!q('SELECT 1 FROM user_replays WHERE user_id=? AND game_id=?').get(id, matchId)) return {error: 'REPLAY_NOT_FOUND'};
      if (shared) q('INSERT OR IGNORE INTO public_replays(user_id,game_id) VALUES(?,?)').run(id, matchId);
      else q('DELETE FROM public_replays WHERE user_id=? AND game_id=?').run(id, matchId);
      return {ok: true};
    },
    shared(id, matchId) { return !!q('SELECT 1 FROM public_replays WHERE user_id=? AND game_id=?').get(id, matchId); },
  };
}
