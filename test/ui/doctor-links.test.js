import {test} from 'node:test';
import assert from 'node:assert/strict';
import {doctorLink,DoctorName,openPublicDoctor,publicDoctorStore} from '../../public/js/ui/doctorLinks.js';

test('shared doctor/replay URLs contain only the stable public identity and requested replay',()=>{
 const previous=globalThis.location;
 try{
  globalThis.location={origin:'https://genshin.oi.dog:7999',pathname:'/',search:'?room=UBHX&spectate=SECRET'};
  const url=new URL(doctorLink('7k9m','match-1'));
  assert.equal(url.origin,'https://genshin.oi.dog:7999');assert.equal(url.search,'?doctor=7K9M&replay=match-1');
  assert.equal(doctorLink('internal-uuid'), '');
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
test('AI and unbound seats have no doctor action; real player names open their own public identity',()=>{
 const previous=publicDoctorStore.get();
 try{
  assert.equal(DoctorName({player:{name:'Bot',isBot:true,publicId:'7K9M'}}).type,'span');
  assert.equal(DoctorName({player:{name:'Guest'}}).type,'span');
  const name=DoctorName({player:{name:'Doctor',publicId:'7K9M'}});assert.equal(name.type,'button');
  let stopped=false;name.props.onClick({stopPropagation(){stopped=true;}});
  assert.ok(stopped);assert.equal(publicDoctorStore.get().publicId,'7K9M');
  openPublicDoctor('bad');assert.equal(publicDoctorStore.get().publicId,'7K9M');
 }finally{publicDoctorStore.set(previous);}
});
