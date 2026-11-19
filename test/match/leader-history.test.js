// Finalized charts survive pool replacement, settlement replay and a safe Hidden Core preparation checkpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeMatch } from './harness.js';
import { DELAYS } from '../../server/match/match/common.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';

const act3 = getVersionData('act3autochess@V3_1');
function setup() {
  const h = makeMatch({ humans:4, difficulty:'HARD', modeId:'mode_multi_hard', data:act3,
    clientCombat:true, fake:true, instant:false, clients:false }).start();
  h.toPrep(1,{band:'band_amiya'});
  const m=h.m;
  m.round=14;m.bossId='boss_1';m.hiddenBossId='boss_9';m.hiddenLayerSum=1e9;
  m._planBossWaves();m.startFinalAssault(false);
  return h;
}
function report(h, uid, dmg) {
  h.sched.advance(4000);
  const f=h.m.fields[0],pid=f.players[0];
  assert.deepEqual(h.m.handle(f.authority,{t:'b.progress',battleId:f.battleId,gt:4,killed:0,total:0,
    bossDmg:dmg,by:{[pid]:dmg},ops:[{pid,uid,chess:'op_a',tier:5,dmg}]}),{ok:true});
  return pid;
}

test('settlement keeps distinct final/hidden charts with each original pool denominator and reconnect payload',()=>{
  const h=setup(),m=h.m;
  try {
    const pid=report(h,1,4000),max=m.bossPool.maxHp;
    const before=m.publicView().leaderTop;
    m.bossPool.hp=0;
    m._finishFinal(false,()=>({perPlayer:{},synthetic:true}));
    assert.deepEqual(m.leaderHistory[0].rows,before);
    assert.equal(m.leaderHistory[0].maxHp,max);
    h.sched.advance(m.scaled(DELAYS.SETTLE));
    h.toPrep(15);
    assert.equal(m.phase,'PREP');assert.equal(m.hiddenReached,true);
    assert.equal(m.bossPool,null);
    const checkpoint=snapshotMatch(m);
    assert.equal(checkpoint.leaderHistory.length,1,'first chart is part of the safe checkpoint');
    m.startFinalAssault(true);
    const hiddenPid=report(h,7,250);
    const hiddenMax=m.bossPool.maxHp;
    m.finish({victory:true,hiddenCleared:false});
    const charts=m.lastResultMsg.leaderHistory;
    assert.deepEqual(charts.map(x=>x.kind),['boss','hidden']);
    assert.deepEqual(charts.map(x=>x.maxHp),[max,hiddenMax]);
    assert.deepEqual(charts.map(x=>x.rows[0].uid),[1,7]);
    assert.equal(charts[0].playerRows.find(r=>r.pid===pid).dmg,4000);
    assert.equal(charts[1].playerRows.find(r=>r.pid===hiddenPid).dmg,250);
    assert.equal(charts[0].players[0].name,m.order[0].name);
    m.onReconnect(pid);
    assert.deepEqual(h.lastTo(pid,'m.result').leaderHistory,charts);
    m.leaderHistory[0].rows[0].dmg=123;
    assert.equal(charts[0].rows[0].dmg,4000,'settlement owns its immutable-in-practice copy');
    assert.deepEqual(h.ended?.leaderHistory,charts);
  } finally {m.dispose();}
});

test('an interrupted/failed Boss round still saves its credited damage; no Boss round has no chart',()=>{
  const h=setup(),m=h.m;
  try {
    report(h,3,1200);
    m.finish({victory:false,reason:'abandoned'});
    assert.equal(m.lastResultMsg.leaderHistory.length,1);
    assert.equal(m.lastResultMsg.leaderHistory[0].rows[0].dmg,1200);
  } finally {m.dispose();}
  const a=makeMatch({humans:1,fake:true}).start();
  try {a.m.finish({victory:false});assert.equal(a.m.lastResultMsg.leaderHistory,undefined);}
  finally {a.m.dispose();}
});

test('a safe checkpoint restores finalized charts and older checkpoints retain an empty history',()=>{
  const a=makeMatch({humans:2,fake:true}).start(),b=makeMatch({humans:2,fake:true});
  try {
    a.toPrep(1);
    a.m.leaderHistory=[{kind:'boss',bossId:'boss_1',maxHp:100,rows:[],playerRows:[],players:[]}];
    const doc=snapshotMatch(a.m);
    assert.ok(restoreMatch(b.m,doc,{createRngFromState}));
    assert.deepEqual(b.m.leaderHistory,a.m.leaderHistory);
    delete doc.leaderHistory;
    const c=makeMatch({humans:2,fake:true});
    try {assert.ok(restoreMatch(c.m,doc,{createRngFromState}));assert.deepEqual(c.m.leaderHistory,[]);}
    finally {c.m.dispose();}
  } finally {a.m.dispose();b.m.dispose();}
});
