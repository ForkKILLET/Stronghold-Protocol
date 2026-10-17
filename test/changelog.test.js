import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseForkChangelog, createChangelogReader, CHANGELOG_SOURCE } from '../server/changelog.js';
import { createPublicApi } from '../server/publicApi.js';
import { startServer } from '../server/index.js';

test('fork history excludes upstream releases and fenced headings, sorts dates and preserves link origins', () => {
  const entries = parseForkChangelog(`## Fork — 2026-10-17：Earlier

- [Design](docs/design/client.md)
- [External](https://example.com/news)
- [Local](/guide)
- [Anchor](#section)

### Subheading

~~~markdown
## Fork — 2099-01-01：Not an entry
~~~

## 0.3.0 — 2026-10-18

- Upstream only

\`\`\`markdown
## Fork — 2099-01-01：Not a fork section
\`\`\`

## 本部署 — 2026-10-16

- Deployment history

## Fork — 2026-10-18：Latest

- Newest update

## Fork — 2026-10-18：Second

- Same day
`);
  assert.deepEqual(entries.map(entry => [entry.date, entry.title]), [
    ['2026-10-18', 'Latest'], ['2026-10-18', 'Second'], ['2026-10-17', 'Earlier'], ['2026-10-16', ''],
  ]);
  assert.match(entries[2].text, /https:\/\/github.com\/ForkKILLET\/Stronghold-Protocol\/blob\/main\/docs\/design\/client.md/);
  assert.match(entries[2].text, /\[External\]\(https:\/\/example.com\/news\)/);
  assert.match(entries[2].text, /\[Local\]\(\/guide\)/);
  assert.match(entries[2].text, /\[Anchor\]\(#section\)/);
  assert.match(entries[2].text, /### Subheading/);
  assert.match(entries[2].text, /2099-01-01/);
  assert.ok(entries.every(entry => !entry.text.includes('Upstream only')));
  assert.deepEqual(parseForkChangelog('## 0.3.0 — 2026-10-18\n\nUpstream only'), []);
});

test('lazy history reads coalesce, refresh after edits and recover after a missing source', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stronghold-changelog-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'CHANGELOG.md');
  let now = 0;
  const read = createChangelogReader({ file, now: () => now });
  await writeFile(file, '## Fork — 2026-10-18：First\n\n- Original');
  const pending = read();
  assert.equal(read(), pending);
  const original = await pending;
  assert.equal(original.source, CHANGELOG_SOURCE);
  await writeFile(file, '## Fork — 2026-10-18：Edited\n\n- New body');
  assert.equal((await read()).entries[0].title, 'First');
  now = 2000;
  assert.equal((await read()).entries[0].title, 'Edited');
  await rm(file);
  now = 4000;
  await assert.rejects(read(), { code: 'ENOENT' });
  await writeFile(file, '## 本部署 — 2026-10-18\n\n- Restored');
  now = 6000;
  assert.match((await read()).entries[0].text, /Restored/);
});

test('history API reports a generic unavailable error without disclosing filesystem details', async () => {
  let status, body;
  const serve = createPublicApi({ now: () => 0, readChangelog: async () => { throw new Error('/private/config/path'); },
    sendJson: (_req, _res, code, data) => { status = code; body = data; } });
  assert.equal(await serve({ method: 'GET' }, {}, '/api/changelog'), true);
  assert.equal(status, 503);
  assert.deepEqual(body, { error: 'CHANGELOG_UNAVAILABLE' });
});

test('real history API supports GET/HEAD only and works independently of empty announcements', async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, store: null, announcementsFile: null });
  t.after(() => srv.close());
  const response = await fetch(`${srv.url}/api/changelog`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  const payload = JSON.parse(body);
  assert.equal(payload.source, CHANGELOG_SOURCE);
  assert.ok(payload.entries.length > 25);
  assert.ok(payload.entries.some(entry => entry.text.includes('全局暂停')));
  assert.ok(payload.entries.some(entry => entry.title.includes('公告分板块')));
  assert.ok(payload.entries.every((entry, index, all) => !index || entry.date <= all[index - 1].date));
  const head = await fetch(`${srv.url}/api/changelog`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(body)));
  const post = await fetch(`${srv.url}/api/changelog`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.deepEqual(await post.json(), { error: 'METHOD_NOT_ALLOWED' });
  assert.equal(srv.registry.size, 0);
  assert.equal(srv.lobby.rooms.size, 0);
});
