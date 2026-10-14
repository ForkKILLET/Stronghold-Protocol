import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseAnnouncements, activeAnnouncement, announcementFromMessage, announcementLive, POPUP_MAX_TEXT } from '../shared/announcements.js';
import { Announcements } from '../server/announcements.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { announcementDismissKey, announcementUi, closeAnnouncement, syncAnnouncementPopup, AnnouncementContent } from '../public/js/ui/announcement.js';
import { renderAnnouncementMarkdown, popupContentUrl } from '../public/js/ui/announcementMarkdown.js';

const BASE = Date.parse('2026-10-14T12:00:00+08:00');
const popup = (options = {}) => ({ id: 'rich-popup', type: 'popup', text: '# 新闻\n\n**正文**\n第二行', format: 'markdown', ...options });
const config = (...rows) => ({ announcements: rows });
function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  yield* walk(node.props?.children);
}
const nodes = text => [...walk(renderAnnouncementMarkdown(text))];
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sp-popup-rich-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'announcements.json');
}

test('popup default is stable immediate publication with no expiry; Markdown whitespace and long content survive frames', () => {
  const raw = '  # 标题\r\n\r\n- 项目\n\n```text\n  缩进\n```\n' + '说明'.repeat(600);
  const [row] = parseAnnouncements(config(popup({ text: raw })));
  assert.equal(row.startAt, 0);
  assert.equal(row.endAt, null);
  assert.equal(row.text, raw.replace(/\r\n?/g, '\n'));
  assert.equal(row.format, 'markdown');
  for (const now of [BASE, BASE + 86400 * 1000, BASE + 365 * 86400 * 1000]) {
    const live = activeAnnouncement([row], now, 'popup');
    assert.equal(live.id, row.id);
    assert.deepEqual(announcementFromMessage({ popupAnnouncement: live }, 'popup'), live);
    assert.equal(announcementLive(live, now), true);
  }
  assert.deepEqual(parseAnnouncements(config(popup({ text: raw })))[0], row, 'reload does not assign a new current-time start');
  assert.equal(parseAnnouncements(config(popup({ startAt: null, durationSeconds: null })))[0].endAt, null);
  assert.equal(parseAnnouncements(config(popup({ format: 'plain' })))[0].text, '# 新闻\n\n**正文**\n第二行');
  assert.equal(parseAnnouncements(config(popup({ text: '😀'.repeat(POPUP_MAX_TEXT) })))[0].text.length, POPUP_MAX_TEXT * 2);
  assert.throws(() => parseAnnouncements(config(popup({ text: '😀'.repeat(POPUP_MAX_TEXT + 1) }))));
});

test('popup optional schedule keeps legacy expiry and permits more than one day or a fixed end, never extends on restart', () => {
  const startAt = new Date(BASE).toISOString();
  const [long] = parseAnnouncements(config(popup({ startAt, durationSeconds: 86400 * 90 })));
  assert.equal(announcementLive(long, BASE - 1), false);
  assert.equal(long.endAt, BASE + 86400 * 90 * 1000);
  assert.equal(announcementLive(long, long.endAt), false);
  const [future] = parseAnnouncements(config(popup({ startAt })));
  assert.equal(announcementLive(future, BASE - 1), false);
  assert.equal(announcementLive(future, BASE + 1e12), true);
  const [fixed] = parseAnnouncements(config(popup({ endAt: new Date(BASE + 123000).toISOString() })));
  assert.equal(fixed.startAt, 0);
  assert.equal(fixed.endAt, BASE + 123000);
  for (const changes of [
    { startAt: '2026-10-14' }, { durationSeconds: 10 }, { startAt, durationSeconds: 0 },
    { startAt, durationSeconds: -1 }, { startAt, durationSeconds: 1.5 },
    { startAt, durationSeconds: Number.MAX_SAFE_INTEGER },
    { startAt, endAt: startAt }, { startAt, endAt: 'bad' },
    { startAt, durationSeconds: 10, endAt: new Date(BASE + 30000).toISOString() }, { format: 'html' },
  ]) assert.throws(() => parseAnnouncements(config(popup(changes))), JSON.stringify(changes));
});

test('scroll rules stay plain, 500 code points, 1..86400 seconds and mandatory schedule; perpetual popup cannot impersonate scroll', () => {
  const scroll = { id: 'legacy-scroll', text: '  一行\n正文  ', startAt: new Date(BASE).toISOString(), durationSeconds: 30 };
  const [row] = parseAnnouncements(config(scroll));
  assert.equal(row.text, '一行 正文');
  const notice = activeAnnouncement([row], BASE);
  assert.deepEqual(announcementFromMessage({ announcement: notice }), notice);
  for (const changes of [{ text: 'x'.repeat(501) }, { durationSeconds: 86401 }, { format: 'plain' },
    { format: 'markdown' }, { startAt: null }, { endAt: null }]) {
    assert.throws(() => parseAnnouncements(config({ ...scroll, ...changes })));
  }
  const forever = activeAnnouncement(parseAnnouncements(config(popup())), BASE, 'popup');
  assert.equal(announcementFromMessage({ announcement: { ...forever, type: 'scroll' } }), null);
  for (const changes of [{ endAt: undefined }, { endAt: NaN }, { text: '\u0001bad' }, { format: 'html' }]) {
    assert.equal(announcementFromMessage({ popupAnnouncement: { ...forever, ...changes } }, 'popup'), null);
  }
});

test('Markdown fixed-element rendering supports headings, inline styles, lists/tasks, quotes, fences, tables, links and images', () => {
  const content = '# 标题\n\n正文 **重点** *斜体* ~~删除~~ `行内代码` &amp;\n换行\n\n'
    + '- 第一条\n  - 子项\n- [x] 已完成\n\n3. 第三条\n4. 第四条\n\n'
    + '> 引用\n\n---\n\n```js\n<script>alert("code")</script>\n```\n\n'
    + '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |\n\n'
    + '[链接](https://example.com/news?a=1&b=2)\n\n![描述](/icons/app-192.png "图片标题")';
  const tree = nodes(content);
  for (const tag of ['h1', 'p', 'strong', 'em', 'del', 'code', 'br', 'ul', 'ol', 'li', 'input', 'blockquote', 'hr', 'pre', 'table', 'th', 'td', 'a', 'img']) {
    assert.ok(tree.some(n => n.type === tag), tag);
  }
  const link = tree.find(n => n.type === 'a');
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noopener noreferrer');
  assert.equal(link.props.href, 'https://example.com/news?a=1&b=2');
  const image = tree.find(n => n.type === 'img');
  assert.equal(image.props.src, '/icons/app-192.png');
  assert.equal(image.props.alt, '描述');
  assert.equal(image.props.loading, 'lazy');
  assert.equal(image.props.referrerPolicy, 'no-referrer');
  assert.equal(tree.find(n => n.type === 'input').props.disabled, true);
  assert.equal(tree.find(n => n.type === 'ol').props.start, 3);
  assert.ok(tree.some(n => n.props?.class === 'announcement-markdown__cell--right'));
  assert.ok(tree.every(n => !n.props?.dangerouslySetInnerHTML));
});

test('Markdown never executes raw HTML and rejects script/data/blob/credential/protocol-relative URLs, including entity obfuscation', () => {
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,x', 'blob:https://a/b',
    '//evil.example/x', '/\\evil.example/x', 'https://u:p@example.com/x', 'https://example.com/a b', 'https://example.com/\u0000x'];
  for (const url of bad) assert.equal(popupContentUrl(url), null, url);
  for (const url of ['https://example.com/a.png', 'http://localhost:3000/news', '/icons/a.png?v=2']) assert.equal(popupContentUrl(url), url);
  const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src=https://evil.example></iframe>\n\n'
    + '[bad](javascript:alert%281%29) ![bad](data:image/svg+xml,x)\n\n'
    + '[bad](jav&#x61;script&#58;alert%281%29) [bad](//evil.example/x)\n\n'
    + '![bad](https://user:secret@example.com/image.png)';
  const tree = nodes(source);
  assert.ok(!tree.some(n => ['script', 'iframe', 'img', 'a', 'style', 'object', 'svg'].includes(n.type)));
  assert.ok(tree.every(n => !n.props?.dangerouslySetInnerHTML && !Object.keys(n.props || {}).some(k => /^on/i.test(k))));
  const raw = renderAnnouncementMarkdown('<img src=x onerror=alert(1)>');
  assert.equal(raw.props.children[0], '<img src=x onerror=alert(1)>');
  const plain = [...walk(AnnouncementContent({ notice: { text: '[not formatted](https://a)', url: 'javascript:alert(1)' } }))];
  assert.equal(plain.find(n => n.type === 'p').props.children, '[not formatted](https://a)');
  assert.ok(!plain.some(n => n.type === 'a'));
});

test('Markdown limits degrade deep input to escaped text, and CSS bounds images/tables without global or battlefield rules', async () => {
  const deep = '> '.repeat(32) + 'nested';
  assert.equal(renderAnnouncementMarkdown(deep).props.class, 'announcement-content__plain');
  const css = await readFile(new URL('../public/css/components.css', import.meta.url), 'utf8');
  assert.match(css, /\.announcement-content__plain\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /\.announcement-markdown img\s*\{[^}]*max-width:\s*100%[^}]*height:\s*auto/);
  assert.match(css, /\.announcement-markdown__table\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.announcement-modal \.modal__body\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
});

test('permanent popup survives elapsed time, invalid edits and restart; withdrawing it leaves scroll selection intact', async t => {
  const file = await fixture(t);
  let now = BASE;
  const scroll = { id: 'scroll', text: '旧滚动', startAt: new Date(BASE).toISOString(), durationSeconds: 60 };
  await writeFile(file, JSON.stringify(config(scroll, popup())));
  const frames = [];
  const service = new Announcements({ file, now: () => now, broadcast: m => frames.push(m) });
  t.after(() => service.stop());
  await service.start();
  assert.equal(service.current.id, 'scroll');
  assert.equal(service.popupCurrent.endAt, null);
  const oldKey = announcementDismissKey(service.popupCurrent);
  now += 365 * 86400 * 1000;
  service.refresh();
  assert.equal(service.current, null);
  assert.equal(service.popupCurrent.id, 'rich-popup');
  assert.equal(service.boundaryTimer, null, 'no expiry timer for an unscheduled permanent notice');
  await writeFile(file, '{bad');
  assert.equal(await service.reload(), false);
  assert.equal(service.popupCurrent.id, 'rich-popup');
  await writeFile(file, JSON.stringify(config(popup())));
  await service.reload();
  assert.equal(announcementDismissKey(service.popupCurrent), oldKey);
  const restarted = new Announcements({ file, now: () => now });
  t.after(() => restarted.stop());
  await restarted.start();
  assert.equal(announcementDismissKey(restarted.popupCurrent), oldKey);
  now = BASE + 1;
  await writeFile(file, JSON.stringify(config(scroll, popup({ enabled: false }))));
  await service.reload();
  assert.equal(service.popupCurrent, null);
  assert.equal(service.current.id, 'scroll');
  assert.equal(frames.at(-1).popupAnnouncement, null);
});

test('permanent popup viewed state changes on formatting/content edits, defers in matches and closes on withdrawal', t => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  t.after(() => { globalThis.localStorage = previous; closeAnnouncement(); });
  closeAnnouncement();
  const notice = activeAnnouncement(parseAnnouncements(config(popup({ autoPopup: true }))), BASE, 'popup');
  syncAnnouncementPopup(notice, BASE, true);
  assert.equal(announcementUi.get().open, false);
  syncAnnouncementPopup(notice, BASE + 1, false);
  assert.equal(announcementUi.get().open, true);
  closeAnnouncement();
  syncAnnouncementPopup(notice, BASE + 365 * 86400 * 1000, false);
  assert.equal(announcementUi.get().open, false);
  syncAnnouncementPopup({ ...notice, format: 'plain' }, BASE, false);
  assert.equal(announcementUi.get().open, true, 'format-only change counts as new version');
  syncAnnouncementPopup(null, BASE, false);
  assert.equal(announcementUi.get().open, false);
});

test('HTTP and WS deliver the same permanent Markdown content; API exposes null expiry, stable digest and separate scroll', async t => {
  const file = await fixture(t);
  const text = '## 发布说明\n\n[链接](https://example.com/news)\n\n![图片](/icons/app-192.png)';
  const scroll = { id: 'scroll', text: '普通通知', startAt: new Date(Date.now() - 1000).toISOString(), durationSeconds: 300 };
  await writeFile(file, JSON.stringify(config(scroll, popup({ text, autoPopup: true }))));
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, roomWorkers: 0, announcementsFile: file });
  t.after(() => srv.close());
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(() => c.close());
  const frame = await c.waitFor('site.announcement');
  assert.equal(frame.popupAnnouncement.endAt, null);
  assert.equal(frame.popupAnnouncement.format, 'markdown');
  assert.equal(frame.popupAnnouncement.text, text);
  assert.deepEqual(announcementFromMessage(frame, 'popup'), frame.popupAnnouncement);
  const get = async p => (await (await fetch(srv.url + p)).json()).announcement;
  const api = await get('/api/popup-announcement'), legacy = await get('/api/announcement');
  assert.equal(api.expiresAt, null);
  assert.equal(api.format, 'markdown');
  assert.equal(api.text, text);
  assert.equal(legacy.text, scroll.text);
  assert.equal(legacy.format, undefined);
  await srv.announcements.reload();
  assert.equal((await get('/api/popup-announcement')).id, api.id);
  const bodyFile = join(dirname(file), 'api-body.md');
  await writeFile(bodyFile, text);
  await writeFile(file, JSON.stringify(config(scroll,
    { id: 'rich-popup', type: 'popup', textFile: 'api-body.md', autoPopup: true })));
  await srv.announcements.reload();
  assert.deepEqual(await get('/api/popup-announcement'), api, 'body-file mode has the same public content and does not expose its path');
  const head = await fetch(srv.url + '/api/popup-announcement', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  await writeFile(file, JSON.stringify(config(scroll, popup({ text, format: 'plain', autoPopup: true }))));
  await srv.announcements.reload();
  assert.notEqual((await get('/api/popup-announcement')).id, api.id);
  assert.deepEqual(await get('/api/announcement'), legacy);
  await writeFile(file, JSON.stringify(config(scroll)));
  await srv.announcements.reload();
  await c.waitFor('site.announcement', m => m.popupAnnouncement === null);
  assert.equal(await get('/api/popup-announcement'), null);
  assert.deepEqual(await get('/api/announcement'), legacy);
});

test('local Markdown/text body files reload without JSON changes; invalid/missing edits are atomic and paths stay private', async t => {
  const file = await fixture(t), root = dirname(file);
  await mkdir(join(root, 'news'));
  const bodyFile = join(root, 'news', 'post.md');
  await writeFile(bodyFile, '# 原标题\n\n- 第一项\n- 第二项');
  const entry = { id: 'file-body', type: 'popup', textFile: 'news/post.md', autoPopup: true };
  await writeFile(file, JSON.stringify(config(entry)));
  const frames = [];
  const service = new Announcements({ file, now: () => BASE, broadcast: m => frames.push(m) });
  t.after(() => service.stop());
  await service.start();
  assert.equal(service.popupCurrent.format, 'markdown');
  assert.equal(service.popupCurrent.endAt, null);
  assert.equal('textFile' in service.popupCurrent, false);
  const key = announcementDismissKey(service.popupCurrent);
  const next = join(root, 'news', 'next.md');
  await writeFile(next, '# 新标题\n\n[入口](https://example.com)');
  await rename(next, bodyFile);
  await service.reload();
  assert.match(service.popupCurrent.text, /新标题/);
  assert.notEqual(announcementDismissKey(service.popupCurrent), key);
  assert.equal(frames.length, 2);
  await writeFile(bodyFile, '');
  assert.equal(await service.reload(), false);
  assert.match(service.popupCurrent.text, /新标题/, 'empty edit preserves the last valid version');
  await rm(bodyFile);
  assert.equal(await service.reload(), false);
  assert.match(service.popupCurrent.text, /新标题/);
  await writeFile(join(root, 'plain.txt'), '  **原样**\n  缩进\n下一行');
  await writeFile(file, JSON.stringify(config({ ...entry, textFile: 'plain.txt' })));
  await service.reload();
  assert.equal(service.popupCurrent.format, 'plain');
  assert.equal(service.popupCurrent.text, '  **原样**\n  缩进\n下一行');
  const kept = service.popupCurrent;
  for (const changes of [
    { type: 'scroll' }, { text: '混用正文' }, { textFile: '../outside.md' }, { textFile: '/absolute.md' },
    { textFile: 'news\\post.md' }, { textFile: 'https://example.com/post.md' }, { textFile: 'bad.html' },
    { textFile: 'news/./post.md' }, { textFile: 'news//post.md' }, { textFile: 'C:/secret.md' }, { format: null },
  ]) {
    await writeFile(file, JSON.stringify(config({ ...entry, textFile: 'plain.txt', ...changes })));
    assert.equal(await service.reload(), false, JSON.stringify(changes));
    assert.deepEqual(service.popupCurrent, kept);
  }
  await writeFile(join(root, 'huge.md'), '😀'.repeat(16000));
  await writeFile(file, JSON.stringify(config(...[1, 2, 3].map(n => ({ ...entry, id: `huge-${n}`, textFile: 'huge.md' })))));
  assert.equal(await service.reload(), false, 'expanded content has a total byte limit, not only per-file limits');
  assert.deepEqual(service.popupCurrent, kept);
  await writeFile(file, JSON.stringify(config({ ...entry, textFile: 'missing.md', enabled: false })));
  assert.equal(await service.reload(), true, 'a disabled body file need not exist: withdrawal must not depend on a valid old body');
  assert.equal(service.popupCurrent, null);
});

test('body-file directory junction cannot escape the configuration directory', async t => {
  const file = await fixture(t), root = dirname(file);
  const external = await mkdtemp(join(tmpdir(), 'sp-popup-outside-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, 'secret.md'), '# Outside');
  try {
    await symlink(external, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symlink creation unavailable on this host'); return; }
    throw error;
  }
  await writeFile(file, JSON.stringify(config({ id: 'escape', type: 'popup', textFile: 'escape/secret.md' })));
  const service = new Announcements({ file });
  t.after(() => service.stop());
  await service.start();
  assert.equal(service.loaded, false);
  assert.equal(service.popupCurrent, null);
  assert.match(service.lastError, /inside the config directory/);
});
