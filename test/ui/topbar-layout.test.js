import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('lobby and room share the header that places announcements after online count', async () => {
  const [lobby, room, header] = await Promise.all([
    readFile(new URL('../../public/js/screens/lobby.js', import.meta.url), 'utf8'),
    readFile(new URL('../../public/js/screens/room.js', import.meta.url), 'utf8'),
    readFile(new URL('../../public/js/ui/pageHeader.js', import.meta.url), 'utf8'),
  ]);
  for (const source of [lobby, room]) {
    assert.match(source, /<\$\{PageHeader\}/, 'page renders the shared header');
    assert.doesNotMatch(source, /<\$\{(?:AnnouncementButton|OnlineCount)\}/, 'pages do not duplicate header controls');
  }
  const announcement = header.indexOf('<${AnnouncementButton}');
  const online = header.indexOf('<${OnlineCount}');
  assert.ok(online >= 0 && announcement > online, 'announcement must follow online count in the shared header');
  assert.equal((header.match(/<\$\{AnnouncementButton\}/g) || []).length, 1, 'shared header has one announcement action');
});

test('portrait headers retain their fallback while landscape uses a compact shared toolbar', async () => {
  const css = await readFile(new URL('../../public/css/navigation.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-header \.app-header__status\s*\{[^}]*overflow:visible/);
  assert.match(css, /grid-template-areas:"links identity" "tools tools" "heading heading"/);
  assert.match(css, /max-width:760px\) and \(orientation:portrait/);
  assert.match(css, /grid-template-areas:"links heading account"/);
  assert.match(css, /\.app-header__status \.topbar-announcement\s*\{[^}]*width:32px/);
});
