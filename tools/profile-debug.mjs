// Private development snapshots. This tool is never imported by the production server.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes, createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openUserStore} from '../server/users/store.js';
import {normalizeDoctorId} from '../shared/publicProfiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'stronghold-profile-debug';
const privateJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode:0o600, flag:'wx'});

// Self-contained so SSH can execute this exact reader even on an older release. The caller opens SQLite read-only.
export function readProfileSnapshot(db, publicId) {
  if (!/^[0-9A-HJKMNP-TV-Z]{4}$/.test(publicId)) throw new Error('Invalid doctor ID');
  db.exec('BEGIN');
  try {
    const schemas = {
      accounts:db.prepare('PRAGMA user_version').get().user_version,
      replays:db.prepare('SELECT version FROM replay_schema WHERE id=1').get().version,
      publicProfiles:db.prepare('SELECT version FROM public_profile_schema WHERE id=1').get().version,
      combat:db.prepare("SELECT 1 FROM sqlite_master WHERE name='combat_schema'").get()?db.prepare('SELECT version FROM combat_schema WHERE id=1').get().version:0,
    };
    if (schemas.accounts !== 1 || schemas.replays !== 1 || schemas.publicProfiles !== 2 || ![0,1].includes(schemas.combat)) throw new Error('Unsupported profile schemas');
    const profile = db.prepare('SELECT user_id,public_id,visibility FROM public_profiles WHERE public_id=?').get(publicId);
    if (!profile) throw new Error('Doctor not found');
    const id = profile.user_id;
    return {
      format:'stronghold-profile-debug', version:1, exportedAt:new Date().toISOString(), schemas,
      user:db.prepare('SELECT id,name,avatar_id,created_at FROM users WHERE id=?').get(id), profile,
      games:db.prepare('SELECT g.rowid AS position,g.id,g.ended_at,g.mode,g.difficulty,g.source FROM games g JOIN results r ON r.game_id=g.id WHERE r.user_id=? ORDER BY g.rowid').all(id),
      results:db.prepare('SELECT game_id,user_id,player_id,victory,rounds,payload FROM results WHERE user_id=?').all(id),
      replays:db.prepare('SELECT r.game_id,r.body FROM replays r JOIN user_replays u ON u.game_id=r.game_id WHERE u.user_id=?').all(id)
        .map(row => ({game_id:row.game_id, body:Buffer.from(row.body).toString('base64')})),
      userReplays:db.prepare('SELECT user_id,game_id,pinned FROM user_replays WHERE user_id=?').all(id),
      publicReplays:db.prepare('SELECT user_id,game_id FROM public_replays WHERE user_id=?').all(id),
      combatMatches:schemas.combat?db.prepare('SELECT game_id,user_id,manifest FROM combat_matches WHERE user_id=?').all(id):[],
      combatRecords:schemas.combat?db.prepare('SELECT game_id,user_id,battle_id,seconds,complete,bytes,body FROM combat_records WHERE user_id=?').all(id)
        .map(row=>({...row,body:Buffer.from(row.body).toString('base64')})):[],
    };
  } finally { db.exec('ROLLBACK'); }
}

export async function pullProfileSnapshot({ssh, publicId, container='stronghold-protocol'}) {
  if (!normalizeDoctorId(publicId) || normalizeDoctorId(publicId) !== publicId) throw new Error('Invalid doctor ID');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@:-]*$/.test(ssh || '')) throw new Error('Invalid SSH destination');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) throw new Error('Invalid container name');
  const source = `import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.env.SP_USER_DB,{readOnly:true});
try{process.stdout.write(JSON.stringify((${readProfileSnapshot.toString()})(db,${JSON.stringify(publicId)})));}finally{db.close();}`;
  const child = spawn('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=15','--',ssh,
    `docker exec -i ${container} node --input-type=module`], {stdio:['pipe','pipe','pipe']});
  const chunks = []; let size = 0;
  // Bound memory independently of the remote quotas. Do not print the payload or remote diagnostics containing data.
  child.stdout.on('data', chunk => {size += chunk.length; if (size > 256*1024*1024) child.kill(); else chunks.push(chunk);});
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 120_000); timer.unref();
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Profile export failed (SSH, missing account, schema or transfer limit); no local data replaced')));
      child.stdin.on('error', () => {});
      child.stdin.end(source);
    });
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid profile export response'); }
  } finally { clearTimeout(timer); }
}

export async function importProfileSnapshot(snapshot, directory) {
  if (snapshot?.format !== FORMAT || snapshot.version !== 1 || snapshot.schemas?.accounts !== 1 ||
      snapshot.schemas.replays !== 1 || snapshot.schemas.publicProfiles !== 2 || ![undefined,0,1].includes(snapshot.schemas.combat)) throw new Error('Unsupported profile snapshot');
  const id = snapshot.user?.id, publicId = snapshot.profile?.public_id;
  if (!id || !normalizeDoctorId(publicId) || snapshot.profile.user_id !== id ||
      !['results','userReplays','publicReplays'].every(key => Array.isArray(snapshot[key]) && snapshot[key].every(row => row.user_id === id)) ||
      !Array.isArray(snapshot.games) || !Array.isArray(snapshot.replays)) throw new Error('Invalid snapshot ownership');
  const games = new Set(snapshot.games.map(row => row.id));
  if (games.size !== snapshot.results.length || snapshot.results.some(row => !games.has(row.game_id))) throw new Error('Invalid snapshot history');
  for(const key of ['combatMatches','combatRecords']) if(snapshot[key] && (!Array.isArray(snapshot[key]) || snapshot[key].some(row=>row.user_id!==id))) throw new Error('Invalid snapshot ownership');
  const replayLimit = Math.max(10, snapshot.userReplays.length, snapshot.userReplays.filter(row=>row.pinned).length + 1);
  if (replayLimit > 100) throw new Error('Snapshot exceeds replay quota');
  fs.mkdirSync(path.dirname(directory), {recursive:true, mode:0o700});
  fs.mkdirSync(directory, {mode:0o700}); // Never replace an open or existing local database.
  const file = path.join(directory, 'users.sqlite');
  let db;
  try {
    const empty = await openUserStore(file, {backups:null}); await empty.close();
    db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    const u = snapshot.user, p = snapshot.profile;
    db.prepare('INSERT INTO users(id,name,avatar_id,created_at) VALUES(?,?,?,?)').run(id,u.name,u.avatar_id,u.created_at);
    db.prepare('INSERT INTO public_profiles(user_id,public_id,visibility) VALUES(?,?,?)').run(id,publicId,p.visibility);
    for (const g of snapshot.games) db.prepare('INSERT INTO games(rowid,id,ended_at,mode,difficulty,source) VALUES(?,?,?,?,?,?)')
      .run(g.position,g.id,g.ended_at,g.mode,g.difficulty,g.source);
    for (const r of snapshot.results) db.prepare('INSERT INTO results(game_id,user_id,player_id,victory,rounds,payload) VALUES(?,?,?,?,?,?)')
      .run(r.game_id,id,r.player_id,r.victory,r.rounds,r.payload);
    const retained = new Set(snapshot.userReplays.map(row => row.game_id));
    if (retained.size !== snapshot.replays.length || snapshot.replays.some(row => !retained.has(row.game_id))) throw new Error('Invalid snapshot replays');
    for (const r of snapshot.replays) db.prepare('INSERT INTO replays(game_id,body) VALUES(?,?)').run(r.game_id,Buffer.from(r.body,'base64'));
    for (const r of snapshot.userReplays) db.prepare('INSERT INTO user_replays(user_id,game_id,pinned) VALUES(?,?,?)').run(id,r.game_id,r.pinned);
    for (const r of snapshot.publicReplays) db.prepare('INSERT INTO public_replays(user_id,game_id) VALUES(?,?)').run(id,r.game_id);
    for (const r of snapshot.combatMatches || []) db.prepare('INSERT INTO combat_matches(game_id,user_id,manifest) VALUES(?,?,?)').run(r.game_id,id,r.manifest);
    for (const r of snapshot.combatRecords || []) db.prepare('INSERT INTO combat_records(game_id,user_id,battle_id,seconds,complete,bytes,body) VALUES(?,?,?,?,?,?,?)')
      .run(r.game_id,id,r.battle_id,r.seconds,r.complete,r.bytes,Buffer.from(r.body,'base64'));
    // Production credential/recovery tables are never exported. Only a new, local credential is created.
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO credentials(hash,user_id) VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),id);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid snapshot relations');
    db.exec('COMMIT'); db.close(); db = null;
    const metadata = {format:FORMAT,version:1,publicId,exportedAt:snapshot.exportedAt,records:snapshot.results.length,
      replays:snapshot.replays.length,pinned:snapshot.userReplays.filter(row=>row.pinned).length,replayLimit};
    privateJson(path.join(directory, 'session.json'), {token});
    privateJson(path.join(directory, 'snapshot.json'), metadata);
    return metadata;
  } catch (error) {
    db?.close(); fs.rmSync(directory, {recursive:true, force:true}); throw error;
  }
}

export async function serveProfileSnapshot(directory, {port=3001, quiet=false}={}) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
  const {token} = JSON.parse(fs.readFileSync(path.join(directory,'session.json'),'utf8'));
  if (metadata.format !== FORMAT || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('Invalid debug session');
  const file = path.join(directory,'users.sqlite');
  // Check before starting the server: a stale secret must not silently create another anonymous identity.
  const check = await openUserStore(file, {backups:null,replays:{perUser:metadata.replayLimit}});
  let valid;
  try { valid = (await check.call('authenticate',{token}))?.publicId === metadata.publicId; }
  finally { await check.close(); }
  if (!valid) throw new Error('Debug identity does not match this snapshot');
  const {startServer} = await import('../server/index.js');
  const server = await startServer({host:'127.0.0.1',port,quiet,userFile:file,clientBuild:false,
    store:null,resume:false,serverConfigFile:null,adminToken:null,nameModeration:null,studio:false,
    announcementsFile:null,serverMessageFile:null,workers:0,roomWorkers:0,matchWorkers:0,
    assetsCdn:'',dataCdn:'',resourcePackRoutes:[],trustProxy:false,replayLimit:metadata.replayLimit});
  // Fixed identity on this loopback-only development instance, including WS. Never mounted in normal dev/production.
  for (const event of ['request','upgrade']) {
    const listeners = server.server.listeners(event);
    server.server.removeAllListeners(event);
    server.server.on(event, (req, ...args) => {
      if (![`127.0.0.1:${server.port}`,`localhost:${server.port}`].includes(req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') {
        if (event === 'request') {args[0].writeHead(403); args[0].end('Local debug access only');}
        else args[0].destroy();
        return;
      }
      req.headers.cookie = `sp_user=${token}`;
      for (const listener of listeners) listener.call(server.server,req,...args);
    });
  }
  return server;
}

async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  if (command === '--help' || args.includes('--help') || !command) {
    console.log('profile-debug.mjs pull --id <ID> --ssh <host> [--container <name>] [--root <directory>]\nprofile-debug.mjs serve --id <ID> [--port 3001] [--root <directory>]'); return;
  }
  for (let i=0;i<args.length;i+=2) {
    if (!['--id','--ssh','--container','--root','--port'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Invalid option (see --help)');
    options[args[i].slice(2)] = args[i+1];
  }
  const publicId = normalizeDoctorId(options.id);
  if (!publicId) throw new Error('--id requires a four-character doctor ID');
  const root = path.resolve(options.root || path.join(ROOT,'.state','profile-debug')), account = path.join(root,publicId);
  if (command === 'pull') {
    const snapshot = await pullProfileSnapshot({ssh:options.ssh,publicId,container:options.container});
    const name = new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomBytes(3).toString('hex');
    const metadata = await importProfileSnapshot(snapshot,path.join(account,name));
    const pointer = path.join(account,`.latest-${randomBytes(4).toString('hex')}.json`);
    privateJson(pointer,{directory:name}); fs.renameSync(pointer,path.join(account,'latest.json'));
    console.log(`Imported ${publicId}: ${metadata.records} records, ${metadata.replays} replays (${metadata.pinned} pinned).\nLocal database: ${path.join(account,name,'users.sqlite')}\nStart: npm run dev:profile -- --id ${publicId}`);
  } else if (command === 'serve') {
    const {directory} = JSON.parse(fs.readFileSync(path.join(account,'latest.json'),'utf8'));
    if (typeof directory !== 'string' || path.basename(directory) !== directory || directory === '.' || directory === '..') throw new Error('Invalid snapshot path');
    const port = options.port === undefined ? 3001 : Number(options.port);
    if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid port');
    const server = await serveProfileSnapshot(path.join(account,directory),{port});
    console.log(`\nLocal debug profile ${publicId}: ${server.url}\nOnly this local snapshot is modified. Refresh with profile:pull to create a new snapshot.`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {server.close().then(()=>process.exit(0),()=>process.exit(1));});
  } else throw new Error('Use pull or serve (see --help)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(`[profile-debug] ${error instanceof SyntaxError ? 'Invalid local snapshot JSON' : error.message}`);process.exitCode=1;});
}
