import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installCombatSync,COMBAT_OUTBOX,syncArchivedCombat} from '../../public/js/battle/combatSync.js';
import {HISTORY_KEY,archivedCombatReader,mergeCombatReader} from '../../public/js/battle/combatHistory.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};};
const record=(id='b1',seconds=10,complete=true)=>({v:1,battleId:id,round:1,fieldId:'f1',cs:null,seconds,complete,
  owners:['p0'],rows:[{key:'a',ownerId:'p0',defId:'chess_a',name:'A',kind:'op',damage:100,healing:0,types:{phys:100,arts:0,true:0,elemental:0}}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function rig(storage=memory(),request=async()=>({ok:true})) {
  let userId='owner',state={match:{}},time=1000,follow,emit;
  const sync=installCombatSync({storage,request,win:null,runner:{on(t,fn){emit=fn;return ()=>{};}},
    profile:{get:()=>({enabled:true,user:{id:userId}})},store:{get:()=>state,subscribe(fn){follow=fn;return ()=>{};}},
    setInterval:()=>null,clearInterval:()=>{},now:()=>time});
  return {sync,storage,emit:v=>emit(v),setUser:v=>{userId=v;},advance:()=>{time+=61000;},end(matchId){state={match:{result:{matchId}}};follow(state);}};
}
test('own round snapshots wait for settlement, deduplicate and survive failed uploads/reloads',async()=>{
  const storage=memory(),calls=[];let offline=true;
  const request=async(path,body)=>{calls.push(body);if(offline)throw Object.assign(new Error(),{userCode:'COMBAT_NOT_FOUND'});return {ok:true};};
  let r=rig(storage,request);
  try {
    r.emit({matchId:'g1',record:record()});r.emit({matchId:'g1',record:record('b1',5,false)});
    await r.sync.flush();assert.equal(calls.length,0);assert.equal(r.sync.pending(),1);
    r.end('g1');await tick();assert.equal(calls.length,1);assert.equal(r.sync.pending(),1);
    assert.equal(JSON.parse(storage.getItem(COMBAT_OUTBOX)).entries[0].record.seconds,10);
    r.sync.close();offline=false;r=rig(storage,request);await tick();
    assert.equal(r.sync.pending(),0);assert.equal(calls.length,2);assert.equal(calls[1].record.seconds,10);
  } finally {r.sync.close();}
});
test('account changes do not submit the previous account queue; newer data arriving in flight is retained',async()=>{
  let release;const calls=[];
  const r=rig(memory(),async(path,body)=>{calls.push(body);await new Promise(resolve=>{release=resolve;});return {ok:true};});
  try {
    r.sync.enqueue({matchId:'g1',record:record('b1',5,false)},true);
    r.setUser('another');await r.sync.flush();assert.equal(calls.length,0);
    r.setUser('owner');const flushing=r.sync.flush();await tick();
    r.sync.enqueue({matchId:'g1',record:record('b1',10,true)},true);release();await flushing;
    assert.equal(r.sync.pending(),1,'acknowledging the previous snapshot cannot discard a replacement');
    const next=r.sync.flush();await tick();release();await next;assert.equal(r.sync.pending(),0);
    assert.equal(calls[1].record.complete,true);
  } finally {r.sync.close();}
});
test('legacy cache backfill requires the exact owned field, strips teammates and preserves partial status',async()=>{
  const calls=[],r=rig(memory(),async(path,body)=>{calls.push(body);return {ok:true};});
  try {
    const local={records:[{...record(),complete:undefined,rows:[...record().rows,{...record().rows[0],ownerId:'other'}]},record('invented')]};
    syncArchivedCombat({matchId:'g1',local,combat:{playerId:'p0',fields:[{battleId:'b1',fieldId:'f1',round:1,cs:null,seconds:10}]}});await tick();
    assert.equal(calls.length,1);assert.equal(calls[0].record.complete,false);assert.equal(calls[0].record.rows.length,1);
  } finally {r.sync.close();}
});
test('server data wins by field while local data fills missing fields without double counting',()=>{
  const storage=memory();storage.setItem(HISTORY_KEY,JSON.stringify({version:1,matchId:'g1',matchKey:'k',records:[['b1',record()],['b2',record('b2')]]}));
  const local=archivedCombatReader(storage,{matchId:'g1'}),remote={...record(),rows:[{...record().rows[0],damage:200,types:{phys:200,arts:0,true:0,elemental:0}}]};
  const reader=mergeCombatReader(local,{playerId:'p0',records:[remote],fields:[{round:1},{round:2}],coverage:{status:'partial',expected:2}});
  assert.equal(reader.combatMetrics({ownerId:'p0'}).damage,300);assert.equal(reader.source,'server');
  assert.equal(local.combatMetrics({ownerId:'p0'}).damage,200);
  assert.deepEqual(reader.combatRounds({ownerId:'p0'}),[1,2],'unrecorded expected rounds remain reachable');
});
