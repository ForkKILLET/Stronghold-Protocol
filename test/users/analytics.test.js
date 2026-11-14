import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installAnalytics} from '../../server/users/analytics.js';
import {openUserStore} from '../../server/users/store.js';
import {createDailyActivity} from '../../server/users/activity.js';
import {analyticsDay,analyticsDate,analyticsRange} from '../../shared/adminAnalytics.js';

const at=text=>Date.parse(text+'+08:00');
function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
    CREATE TABLE games(id TEXT PRIMARY KEY,ended_at INTEGER NOT NULL,mode TEXT);
    CREATE TABLE results(game_id TEXT REFERENCES games(id),user_id TEXT REFERENCES users(id),payload TEXT,PRIMARY KEY(game_id,user_id));`);
  let now=at('2026-11-14T09:00:00');
  const analytics=installAnalytics(db,{now:()=>now});
  for(const [id,created] of [['a','2026-11-12T00:00:00'],['b','2026-11-13T23:59:59.999'],['c','2026-11-14T00:00:00']])db.prepare('INSERT INTO users VALUES(?,?)').run(id,at(created));
  function game(id,ended,mode,users,roomMode) {
    db.prepare('INSERT INTO games VALUES(?,?,?)').run(id,at(ended),mode);
    for(const user of users)db.prepare('INSERT INTO results VALUES(?,?,?)').run(id,user,JSON.stringify({frame:{roomMode}}));
  }
  return {db,analytics,game,tick:value=>{now=at(value);}};
}

test('Beijing ranges validate real dates, leap days, inclusive end dates, future dates and the 366-day limit',()=>{
  const now=at('2026-11-15T00:00:00');
  assert.equal(analyticsDate(analyticsDay(now-1)),'2026-11-14');
  assert.equal(analyticsDate(analyticsDay(now)),'2026-11-15');
  const r=analyticsRange({from:'2026-11-14',to:'2026-11-14'},now);
  assert.equal(r.start,at('2026-11-14T00:00:00'));assert.equal(r.end,now);
  assert.equal(analyticsRange({},now).from,'2026-10-17');
  assert.doesNotThrow(()=>analyticsRange({from:'2024-02-29',to:'2024-02-29'},now));
  for(const [from,to] of [['2026-02-29','2026-03-01'],['2026-11-15','2026-11-14'],['2026-11-16','2026-11-16'],['2025-01-01','2026-11-15'],['2026-1-01','2026-11-15'],['2026-11-14',null]])
    assert.throws(()=>analyticsRange({from,to},now),e=>e.status===400);
});

test('historical settlements count games once, people distinctly and dates at the Beijing boundary; DAU is never fabricated',()=>{
  const f=fixture();try{
    f.game('g1','2026-11-13T23:59:59.999','mode_multi_normal',['a','b'],'coop');
    f.game('g2','2026-11-14T00:00:00','mode_single_funny',['a'],'solo');
    f.game('g3','2026-11-15T00:00:00','mode_multi_normal',['a','c'],'coop');
    f.tick('2026-11-15T10:00:00');
    const d14=analyticsDay(at('2026-11-14T12:00:00')),d15=d14+1;
    f.analytics.activity({entries:[{day:d14,id:'a',played:false},{day:d14,id:'a',played:true},{day:d14,id:'b',played:false},{day:d15,id:'a',played:true}]});
    f.analytics.activity({entries:[{day:d14,id:'a',played:false},{day:d14,id:'nonexistent',played:true}]});
    const report=f.analytics.report({from:'2026-11-13',to:'2026-11-15'});
    assert.deepEqual(report.days.map(d=>[d.date,d.dau,d.playingAccounts,d.settledGames,d.settledPlayers]),[
      ['2026-11-13',null,null,1,2],['2026-11-14',2,1,1,1],['2026-11-15',1,1,1,2],
    ]);
    assert.deepEqual(report.days.map(d=>d.newAccounts),[1,1,0]);
    assert.equal(report.days[1].partialActivity,true);
    assert.equal(report.totals.activeAccounts,2,'range unique accounts, not sum of daily counts');
    assert.equal(report.totals.playingAccounts,1);assert.equal(report.totals.settledPlayers,3);
    assert.equal(report.totals.settledGames,3);assert.equal(report.totals.coopGames,2);assert.equal(report.totals.soloGames,1);
    const historical=f.analytics.report({from:'2026-11-13',to:'2026-11-13'});
    assert.equal(historical.totals.activeAccounts,null);assert.equal(historical.totals.playingAccounts,null);
    assert.equal(historical.totals.settledGames,1);
    const text=JSON.stringify(report);assert.ok(!text.includes('user_id'));assert.ok(!text.includes('payload'));assert.ok(!text.includes('g1'));
  }finally{f.db.close();}
});

test('daily recorder deduplicates devices, upgrades lobby to participant, retries failure and retains a change arriving during a write',async()=>{
  const batches=[];let fail=true,release;
  const tracker=createDailyActivity({log:{warn(){}},users:{async call(method,args){
    assert.equal(method,'activity');batches.push(args.entries);
    if(fail){fail=false;throw Error('temporary');}
    if(release)await new Promise(resolve=>{release.resolve=resolve;});
  }}});
  const now=at('2026-11-14T23:59:59');
  tracker.record('a',now);tracker.record('a',now);tracker.record(null,now);tracker.record('b',now,true);
  await tracker.flush();assert.equal(batches.length,1);assert.equal(batches[0].length,2);
  await tracker.flush();assert.equal(batches.length,2);assert.deepEqual(batches[0],batches[1]);
  tracker.record('a',now,true);release={};const running=tracker.flush();
  while(!release.resolve)await new Promise(resolve=>setImmediate(resolve));
  tracker.record('c',now,false);tracker.record('c',now,true);
  const gate=release;release=null;gate.resolve();await running;
  assert.equal(batches.at(-1)[0].id,'c');assert.equal(batches.at(-1)[0].played,true);
  tracker.record('a',now+2000,true);await tracker.close();
  assert.equal(batches.at(-1)[0].day,analyticsDay(now)+1,'a connection crossing midnight counts the next day');
  const count=batches.length;tracker.record('a',now+4000);await tracker.flush();assert.equal(batches.length,count);
});

test('analytics schema, coverage and activity survive account Worker reopen and backup, without replacing account schema',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sp-analytics-')),file=path.join(dir,'users.sqlite');let store;
  try{
    store=await openUserStore(file,{backups:null});const user=await store.call('create');
    const range=analyticsRange(),day=range.last;
    await store.call('activity',{entries:[{id:user.user.id,day,played:true}]});
    const first=await store.call('adminAnalytics',{from:range.to,to:range.to});
    await store.close();store=await openUserStore(file,{backups:null});
    const second=await store.call('adminAnalytics',{from:range.to,to:range.to});
    assert.equal(second.coverage.activitySince,first.coverage.activitySince);
    assert.equal(second.days[0].dau,1);assert.equal(second.days[0].playingAccounts,1);
    assert.equal((await store.call('authenticate',{token:user.token})).id,user.user.id);
    await store.call('backup',{directory:path.join(dir,'backups')});
    const read=new DatabaseSync(file,{readOnly:true});assert.equal(read.prepare('PRAGMA user_version').get().user_version,1);read.close();
  }finally{await store?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
