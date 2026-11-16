import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

for (const matchWorkers of [0, 1]) {
  for (const pauseMode of ['vote', 'veto']) {
    test(`party ${pauseMode} pause reaches the real match (Workers=${matchWorkers})`, async () => {
      const srv = await startServer({ port: 0, quiet: true, workers: 0, matchWorkers, store: null });
      const clients = [];
      try {
        for (const name of ['Host', 'Guest']) {
          const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
          clients.push(c); c.id = (await c.hello(name)).playerId;
        }
        const [host, guest] = clients;
        assert.equal((await host.request({ t: 'room.create', mode: 'coop', pauseMode })).t, 'ok');
        const room = await host.waitFor('room.state');
        assert.equal(room.pauseMode, pauseMode);
        await guest.request({ t: 'room.join', code: room.code });
        await guest.request({ t: 'room.ready', ready: true });
        assert.equal((await host.request({ t: 'room.start' }, 10000)).t, 'ok');
        assert.equal((await host.waitFor('m.public')).pauseMode, pauseMode);
        host.inbox = host.inbox.filter(m => m.t !== 'm.public');
        assert.equal((await host.request({ t: 'g.pause', on: true })).t, 'ok');
        const requested = await host.waitFor('m.public', p => p.pauseRequests?.includes(host.id));
        assert.equal(requested.paused, pauseMode === 'veto');
        if (pauseMode === 'vote') {
          await guest.request({ t: 'g.pause', on: true });
          await host.waitFor('m.public', p => p.paused);
        }
        host.inbox = host.inbox.filter(m => m.t !== 'm.public');
        assert.equal((await guest.request({ t: 'g.pause', on: false })).t, 'ok');
        const resumed = await host.waitFor('m.public', p => !p.paused);
        if (pauseMode === 'veto') assert.deepEqual(resumed.pauseRequests, []);
      } finally {
        await Promise.all(clients.map(c => c.close()));
        await srv.close();
      }
    });
  }

  test(`public matchmaking overrides a party's default veto policy (Workers=${matchWorkers})`, async () => {
    const srv = await startServer({ port: 0, quiet: true, workers: 0, matchWorkers, store: null, matchmakingTickMs: 20 });
    const clients = [];
    try {
      for (const name of ['PartyHost', 'PlayerB', 'PlayerC', 'PlayerD']) {
        const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
        clients.push(c); c.id = (await c.hello(name)).playerId;
      }
      await clients[0].request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      assert.equal((await clients[0].waitFor('room.state')).pauseMode, 'veto');
      for (const c of clients) assert.equal((await c.request({ t: 'match.join', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
      const pub = await clients[0].waitFor('m.public', p => p.players?.length === 4, 10000);
      assert.equal(pub.pauseMode, 'vote');
      await clients[0].request({ t: 'g.pause', on: true });
      const requested = await clients[0].waitFor('m.public', p => p.pauseRequests?.includes(clients[0].id));
      assert.equal(requested.paused, false, 'one player cannot pause public matchmaking');
    } finally {
      await Promise.all(clients.map(c => c.close()));
      await srv.close();
    }
  });
}
