import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateC2S} from '../shared/protocol.js';
import {makeMatch} from './match/harness.js';
import {snapshotMatch,restoreMatch} from '../server/match/snapshot.js';
import {createRngFromState} from '../server/sim/rng.js';
import {PHASE} from '../shared/constants.js';
import {phaseTotalSeconds} from '../public/js/ui/gameLogic/phases.js';
test('room speed is bounded and optional for old clients',()=>{
 for(const battleSpeed of [undefined,null,1,2,3,4]) assert.equal(validateC2S({t:'room.create',mode:'coop',difficulty:'NORMAL',battleSpeed}),null);
 for(const battleSpeed of [0,5,1.5,'4',NaN,Infinity]) assert.ok(validateC2S({t:'room.create',mode:'coop',difficulty:'NORMAL',battleSpeed}));
});
test('speed travels with checkpoints and leaves game-second combat budgets unchanged',()=>{
 const a=makeMatch({humans:2,fake:true,combatSpeed:4});const b=makeMatch({humans:2,fake:true});
 try {a.start();a.drive(()=>a.m.phase===PHASE.PREP,{ready:false});
 const doc=snapshotMatch(a.m);assert.ok(restoreMatch(b.m,doc,{createRngFromState}));
 assert.equal(b.m.gameSpeed,4);assert.equal(b.m.publicView().battleSpeed,4);
 assert.equal(b.m.gd.combatTimeLimit(1),a.m.gd.combatTimeLimit(1));
 const cfg={combatTimeScale:2,modes:{x:{rounds:{14:{levelMaxPlayTime:120}}}}};
 assert.equal(phaseTotalSeconds({phase:PHASE.FINAL_ASSAULT,round:14,modeId:'x',battleSpeed:4},cfg),60);
 }finally{a.m.dispose();b.m.dispose();}
});
