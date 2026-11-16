import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

for (const [matchWorkers, version] of [[0, null], [1, null], [0, 'act3autochess@V3_1']]) {
  test(`the selected stock query reaches only its requester over real WebSockets (Workers=${matchWorkers}, version=${version || 'default'})`, async () => {
    const srv = await startServer({ port: 0, quiet: true, workers: 0, matchWorkers, userFile: '', serverConfigFile: false, assetIndex: false, versions: { enabled: 'all' } });
    const clients = [];
    try {
      for (const name of ['Tracker', 'Teammate']) {
        const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
        clients.push(c); c.id = (await c.hello(name)).playerId;
      }
      const [a, b] = clients;
      assert.equal((await a.request({ t: 'room.create', mode: 'coop', ...(version ? { version } : {}) })).t, 'ok');
      const room = await a.waitFor('room.state');
      await b.request({ t: 'room.join', code: room.code });
      if (version) {
        for (const c of clients) assert.equal((await c.request({ t: 'room.contentReady', cs: room.content.cs })).t, 'ok');
      }
      assert.equal((await b.request({ t: 'room.ready', ready: true })).t, 'ok');
      assert.equal((await a.request({ t: 'room.start' }, 10000)).t, 'ok');
      const pub = await a.waitFor('m.public');
      assert.equal((await a.request({ t: 'g.pause', on: true })).t, 'ok');
      const chessId = version ? 'chess_char_6_19_a' : 'chess_char_6_11_a';
      assert.equal((await a.request({ t: 'g.cardCounter', chessId, seq: 1 }, 10000)).t, 'ok');
      const stock = await a.waitFor('m.cardCounter');
      assert.equal(stock.chessId, chessId);
      assert.equal(stock.matchKey, pub.combatHistoryKey);
      assert.equal(stock.playerId, a.id);
      assert.equal(stock.holders.length, 2);
      assert.equal(stock.held, 0);
      assert.equal(stock.odds.slot, 0, 'level one cannot naturally roll a tier six');
      assert.equal(b.inbox.some(m => m.t === 'm.cardCounter'), false);
    } finally {
      await Promise.all(clients.map(c => c.close()));
      await srv.close();
    }
  });
}
