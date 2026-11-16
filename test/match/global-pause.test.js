import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMatch} from './harness.js';
import {PHASE, ERR} from '../../shared/constants.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { wireOptions } from '../../server/match/host/proxy.js';
const vote = (h,id,on=true) => h.m.handle(id,{t:'g.pause',on});
test('veto pause starts on one request and any eligible teammate can reject it', () => {
 const h=makeMatch({mode:'coop',humans:3,bots:1,pauseMode:'veto',fake:true,instant:false}).start();
 try {
  assert.ok(h.drive(()=>h.m.phase===PHASE.PREP,{ready:false}));
  const deadline=h.m.deadline, at=h.sched.now();
  assert.deepEqual(vote(h,'p_0'),{ok:true});assert.equal(h.m.paused,true);
  assert.equal(h.m.publicView().pauseMode,'veto');
  h.sched.advance(60000);assert.equal(h.m.phase,PHASE.PREP);
  assert.deepEqual(vote(h,'p_1',false),{ok:true},'a non-requester can veto');
  assert.equal(h.m.paused,false);assert.equal(h.m.deadline,deadline+60000);
  assert.equal(h.m.pauseRequests.size,0,'rejection closes this request');
  assert.deepEqual(vote(h,'p_2'),{ok:true});assert.equal(h.m.paused,true);
  assert.deepEqual(vote(h,'p_2',false),{ok:true},'the requester can also resume');
  assert.equal(h.m.paused,false);assert.equal(h.m._pausedAt,0);
  assert.equal(h.m.pausedMs,60000);assert.ok(h.sched.now()>=at);
 } finally {h.m.dispose();}
});
test('veto mode does not grant AI, spectators or eliminated players pause or rejection rights', () => {
 const h=makeMatch({mode:'coop',humans:2,bots:1,spectators:['viewer'],pauseMode:'veto',fake:true,instant:false}).start();
 try {
  assert.ok(h.drive(()=>h.m.phase===PHASE.PREP,{ready:false}));
  vote(h,'p_0');assert.equal(h.m.paused,true);
  for(const id of ['ai_0','viewer']) assert.ok(vote(h,id,false).error,id);
  h.ps('p_1').alive=false;assert.ok(vote(h,'p_1',false).error);
  assert.equal(h.m.paused,true);
  h.m.onDisconnect('p_0');assert.equal(h.m.paused,false);assert.equal(h.m.pauseRequests.size,0);
 } finally {h.m.dispose();}
});
test('pause policy crosses Worker options and checkpoints, while legacy checkpoints retain voting', () => {
 assert.equal(wireOptions({pauseMode:'veto'}).pauseMode,'veto');
 const a=makeMatch({mode:'coop',humans:2,pauseMode:'veto',fake:true}).start();
 const b=makeMatch({mode:'coop',humans:2,fake:true});
 try {
  a.toPrep(1);const doc=snapshotMatch(a.m);assert.ok(doc);assert.equal(doc.pauseMode,'veto');
  assert.equal(restoreMatch(b.m,doc,{createRngFromState}),true);assert.equal(b.m.pauseMode,'veto');
  delete doc.pauseMode;
  assert.equal(restoreMatch(b.m,doc,{createRngFromState}),true);assert.equal(b.m.pauseMode,'vote');
 } finally {a.m.dispose();b.m.dispose();}
});
test('unanimous co-op pause freezes preparation and inputs; withdrawing resumes the remaining deadline exactly', () => {
 const h = makeMatch({mode:'coop',humans:2,bots:1,seed:5190,fake:true,instant:false}).start();
 assert.ok(h.drive(()=>h.m.phase===PHASE.PREP,{ready:false}));
 const m=h.m; const deadline=m.deadline;
 h.sched.advance(2000); const at=h.sched.now();
 assert.deepEqual(vote(h,'p_0'),{ok:true}); assert.equal(m.paused,false);
 assert.deepEqual(vote(h,'p_1'),{ok:true}); assert.equal(m.paused,true);
 assert.deepEqual(m.publicView().pauseRequired,['p_0','p_1']);
 assert.equal(m.publicView().pausedAt,at);
 assert.equal(m.handle('p_0',{t:'g.ready',ready:true}).error,ERR.WRONG_PHASE);
 h.sched.advance(600000); assert.equal(m.phase,PHASE.PREP);
 assert.deepEqual(vote(h,'p_0',false),{ok:true}); assert.equal(m.paused,false);
 assert.equal(m.deadline,deadline+600000);
 h.sched.advance(deadline-at-1); assert.equal(m.phase,PHASE.PREP);
 h.sched.advance(1); assert.notEqual(m.phase,PHASE.PREP);
 assert.equal(m.errorCount,0); m.dispose();
});
test('strategy draft timer and new/cancelled callbacks remain frozen and resume once', () => {
 const h=makeMatch({mode:'coop',humans:2,seed:5191,fake:true,instant:false}).start();
 assert.ok(h.drive(()=>h.m.phase===PHASE.BAND_DRAFT));
 const m=h.m, turn=m.draftTurn(), deadline=m.deadline, at=h.sched.now();
 vote(h,'p_0'); vote(h,'p_1');
 let runs=0; m.later(100,()=>runs++); const cancelled=m.later(50,()=>runs+=100);m.cancel(cancelled);
 h.sched.advance(600000);assert.equal(m.draftTurn(),turn);assert.equal(runs,0);
 vote(h,'p_1',false);assert.equal(m.draft.turnDeadline,deadline+600000);
 h.sched.advance(100); assert.equal(runs,1);
 h.sched.advance(deadline-at-100); assert.notEqual(m.draftTurn(),turn);
 assert.equal(runs,1); assert.equal(m.errorCount,0);m.dispose();
});
test('disconnect clears pending votes and releases a paused co-op game; eliminated players and spectators cannot vote', () => {
 const h=makeMatch({mode:'coop',humans:2,seed:5192,fake:true,instant:false}).start();
 vote(h,'p_0'); vote(h,'p_1'); assert.equal(h.m.paused,true);
 h.m.onDisconnect('p_1'); assert.equal(h.m.paused,false);assert.deepEqual(h.m.publicView().pauseRequests,[]);
 h.m.onReconnect('p_1');h.ps('p_1').alive=false;
 assert.equal(vote(h,'p_1').error,ERR.WRONG_PHASE);
 assert.deepEqual(vote(h,'p_0'),{ok:true});assert.equal(h.m.paused,true);
 h.m.dispose();assert.equal(h.m._timers.size,0);
});
test('worker completion cannot apply AI or battle results until the pause is withdrawn', async () => {
 const h=makeMatch({mode:'solo',humans:1,seed:5193,fake:true,instant:false}).start();
 let resolve, applied=0;const promise=new Promise(r=>resolve=r);
 h.m.workerPool={submit:()=>({promise,cancel(){}})};
 h.m._submitWorker('rehearsal',{}, {valid:()=>true,complete:()=>applied++,failed:()=>assert.fail()});
 vote(h,'p_0');resolve({});await promise;await Promise.resolve();
 h.sched.advance(10000);assert.equal(applied,0);
 vote(h,'p_0',false);h.sched.advance(1);assert.equal(applied,1);h.m.dispose();
});

test('host setup-reroll routes and votes cannot change the opening while globally paused', () => {
 const h=makeMatch({mode:'coop',humans:2,fake:true,instant:false}).start();
 const m=h.m;
 vote(h,'p_0');vote(h,'p_1');
 assert.equal(m.requestSetupReroll('p_0',0).error,ERR.WRONG_PHASE);
 assert.equal(m.setupVote,null);
 vote(h,'p_1',false);
 assert.deepEqual(m.requestSetupReroll('p_0',0),{ok:true});
 const id=m.setupVote.id;
 vote(h,'p_1');assert.equal(m.paused,true);
 assert.equal(m.cancelSetupReroll('p_0',id).error,ERR.WRONG_PHASE);
 assert.equal(m.voteSetupReroll(h.ps('p_1'),id,true).error,ERR.WRONG_PHASE);
 assert.equal(m.setupRevision,0);
 vote(h,'p_0',false);
 assert.deepEqual(m.voteSetupReroll(h.ps('p_1'),id,true),{ok:true});
 assert.equal(m.setupRevision,1);
 m.dispose();
});
