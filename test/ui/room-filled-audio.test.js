import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomFilled } from '../../public/js/audio.js';
const room = (n, code='ABCD') => ({mode:'coop',code,seats:[...Array(n)].map((_,i)=>({playerId:String(i)}))});
test('room-full cue fires only on filling or entering another full room',()=>{
 assert.equal(roomFilled(room(4),room(3)),true);
 assert.equal(roomFilled(room(4),room(4)),false);
 assert.equal(roomFilled(room(3),room(4)),false);
 assert.equal(roomFilled(room(4,'EFGH'),room(4)),true);
 assert.equal(roomFilled({...room(4),mode:'solo'},null),false);
 assert.equal(roomFilled(null,room(4)),false);
});
