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
