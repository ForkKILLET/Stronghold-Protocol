import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoomOptionsPage} from '../../public/js/ui/roomOptions.js';
import {PrepTimePicker} from '../../public/js/ui/prepTime.js';
function* walk(v){if(Array.isArray(v)){for(const x of v)yield*walk(x);return;}if(!v||typeof v!=='object')return;yield v;yield*walk(v.props?.children);}
test('separate page uses the existing picker with the original draft and can return',()=>{
 let back=0;const change=()=>{};
 const nodes=[...walk(RoomOptionsPage({mode:'coop',prepChoice:'2',onPrepChange:change,onBack:()=>back++}))];
 const picker=nodes.find(n=>n.type===PrepTimePicker);assert.equal(picker.props.value,'2');assert.equal(picker.props.onChange,change);
 nodes.find(n=>n.props?.icon==='check').props.onClick();assert.equal(back,1);
 const invalid=[...walk(RoomOptionsPage({mode:'coop',prepChoice:'',onBack:()=>{}}))];assert.equal(invalid.find(n=>n.props?.icon==='check').props.disabled,true);
});

test('waiting-room save is distinct from cancellation and viewers cannot change values',()=>{
 let saved=0,back=0;
 const props={mode:'coop',difficulty:'HARD',prepChoice:'1.5',battleSpeed:3,onBack:()=>back++,onSave:()=>saved++};
 const editable=[...walk(RoomOptionsPage(props))];
 editable.find(n=>n.props?.icon==='check').props.onClick();assert.equal(saved,1);assert.equal(back,0);
 const viewer=[...walk(RoomOptionsPage({...props,readOnly:true}))];
 assert.equal(viewer.find(n=>n.type===PrepTimePicker).props.disabled,true);
 assert.ok(viewer.filter(n=>n.type==='button').every(n=>n.props.disabled));
 assert.equal(viewer.some(n=>n.props?.icon==='check'),false);
 viewer.find(n=>n.props?.icon==='chevronLeft').props.onClick();assert.equal(back,1);
});
