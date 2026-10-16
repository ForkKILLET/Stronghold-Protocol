import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalMedia, mediaStorage } from '../../public/js/ui/localMedia.js';
import { MAX_IMAGE_BYTES, sanitizeBackdrop, validateImage, prepareBackdrop, backdropTheme } from '../../public/js/ui/hubAppearance.js';
import { MAX_MUSIC_BYTES, validateMusicFile, prepareMusic } from '../../public/js/ui/lobbyMusic.js';
import { HubBackdrop, HubRadar } from '../../public/js/ui/hubBackdrop.js';
import { AudioManager } from '../../public/js/audio.js';

const record = (name = 'song.mp3') => ({ name, blob: new Blob(['song'], { type: 'audio/mpeg' }), paused: false });
function localStore(storage) {
  let next = 0;
  const revoked = [];
  const store = createLocalMedia({ storage, valid: (r) => r?.blob instanceof Blob,
    urls: { createObjectURL: () => `blob:${++next}`, revokeObjectURL: (url) => revoked.push(url) } });
  return { store, revoked };
}

test('late storage restore cannot replace a newer song; pause keeps the object URL and reset releases it', async () => {
  let restore, disk;
  const { store, revoked } = localStore(async (write, value) => {
    if (write) { disk = value; return; }
    return new Promise((resolve) => { restore = resolve; });
  });
  const loading = store.load();
  const chosen = record();
  await store.change(() => chosen);
  restore(record('old.mp3')); await loading;
  assert.equal(store.get().record, chosen);
  assert.equal(disk, chosen);
  const url = store.get().url;
  await store.change(() => ({ ...chosen, paused: true }));
  assert.equal(store.get().url, url);
  assert.deepEqual(revoked, []);
  await store.change(() => null);
  assert.equal(store.get().record, null); assert.equal(disk, null);
  assert.deepEqual(revoked, [url]);
});

test('concurrent imports are rejected and a failed save retains the current file and releases the busy state', async () => {
  let fail = false, complete;
  const { store } = localStore(async () => { if (fail) throw Error('quota'); });
  const first = record(); await store.change(() => first);
  const pending = store.change(() => new Promise((resolve) => { complete = resolve; }));
  assert.equal(await store.change(() => null), false);
  fail = true; complete(record('next.mp3'));
  await assert.rejects(pending, /quota/);
  assert.equal(store.get().record, first);
  assert.equal(store.get().busy, false);
});

test('refresh restores the stored Blob while absent or inaccessible IndexedDB keeps defaults', async () => {
  let disk = null;
  const storage = async (write, value) => write ? (disk = value) : disk;
  await localStore(storage).store.change(() => record());
  const { store } = localStore(storage); await store.load();
  assert.equal(store.get().record.name, 'song.mp3'); assert.ok(store.get().url);
  const unavailable = localStore(async () => { throw Error('denied'); }).store;
  await unavailable.load(); assert.equal(unavailable.get().ready, true); assert.equal(unavailable.get().url, null);
  if (!globalThis.indexedDB) await assert.rejects(mediaStorage('db', 'table', 'key')(), /浏览器无法保存/);
});

test('file type/size boundaries and saved background settings are validated', () => {
  const music = { name: 'song.mp3', type: 'audio/mpeg', size: MAX_MUSIC_BYTES };
  assert.doesNotThrow(() => validateMusicFile(music));
  assert.throws(() => validateMusicFile({ ...music, size: MAX_MUSIC_BYTES + 1 }), /20MB/);
  assert.throws(() => validateMusicFile({ ...music, size: 0 }), /有效/);
  assert.throws(() => validateMusicFile({ ...music, name: 'file.html', type: 'text/html' }), /音频/);
  assert.doesNotThrow(() => validateImage({ type: 'image/png', size: MAX_IMAGE_BYTES }));
  assert.throws(() => validateImage({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), /30MB/);
  assert.throws(() => validateImage({ type: 'video/mp4', size: 200 }), /图片/);
  assert.deepEqual(sanitizeBackdrop({ theme: 'external', dim: 200, blur: -1, overlay: false, motion: false }),
    { theme: 'night', dim: 85, blur: 0, overlay: false, motion: false });
  assert.equal(sanitizeBackdrop({ dim: null, blur: NaN }).dim, 45);
});

test('image preparation scales to 2560px and releases its temporary URL; undecodable music never reaches storage', async (ctx) => {
  const originalImage = globalThis.Image, originalDocument = globalThis.document, originalAudio = globalThis.Audio;
  const revoked = [], draws = [], canvas = { getContext: () => ({ fillRect() {}, drawImage: (...args) => draws.push(args) }),
    toBlob(fn, mime) { fn(new Blob(['image'], { type: mime })); } };
  ctx.mock.method(URL, 'createObjectURL', () => 'blob:probe');
  ctx.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  globalThis.Image = class { naturalWidth = 5120; naturalHeight = 2880; set src(_) { queueMicrotask(() => this.onload()); } };
  globalThis.document = { createElement: () => canvas };
  globalThis.Audio = class {
    duration = 0;
    set src(_) { queueMicrotask(() => this.onerror?.()); }
    removeAttribute() {} load() {}
  };
  try {
    const image = await prepareBackdrop(new Blob(['png'], { type: 'image/png' }));
    assert.equal(canvas.width, 2560); assert.equal(canvas.height, 1440);
    assert.deepEqual(draws[0].slice(1), [0, 0, 2560, 1440]);
    assert.equal(image.blob.type, 'image/jpeg');
    await assert.rejects(prepareMusic(new File(['bad'], 'bad.mp3', { type: 'audio/mpeg' })), /无法播放/);
    globalThis.Audio = class {
      duration = 10;
      set src(_) { queueMicrotask(() => this.onloadedmetadata?.()); }
      removeAttribute() {} load() {}
    };
    const file = new File(['song'], `${'a'.repeat(200)}.mp3`, { type: 'audio/mpeg' });
    const song = await prepareMusic(file);
    assert.equal(song.name, file.name);
    assert.doesNotThrow(() => validateMusicFile({ size: song.blob.size, type: song.blob.type, name: song.name }));
    assert.deepEqual(revoked, ['blob:probe', 'blob:probe', 'blob:probe']);
  } finally { globalThis.Image = originalImage; globalThis.document = originalDocument; globalThis.Audio = originalAudio; }
});

function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}
test('custom backgrounds keep the shade and disable motion/grid; missing files fall back to night', () => {
  const bg = { pref: sanitizeBackdrop({ theme: 'custom', motion: false, overlay: false, dim: 70, blur: 5 }),
    imageUrl: 'blob:local', ready: true };
  const tree = HubBackdrop({ bg }), nodes = [...walk(tree)];
  assert.equal(tree.props['data-motion'], 'off'); assert.equal(tree.props['aria-hidden'], 'true');
  assert.equal(nodes.find((v) => v.props?.class === 'hub-bg__photo').props.style.filter, 'blur(5px)');
  assert.equal(nodes.find((v) => v.props?.class === 'hub-bg__shade').props.style.opacity, .7);
  assert.equal(nodes.some((v) => v.props?.class === 'hub-bg__grid'), false);
  assert.equal([...walk(HubRadar({ bg }))].some((v) => v.props?.class === 'hub-radar__sweep'), false);
  assert.equal(backdropTheme({ ...bg, imageUrl: null }), 'night');
  assert.equal(HubBackdrop({ bg: { ...bg, imageUrl: null, ready: false } }).props['data-scene'], 'blank');
});

function audioHarness() {
  const streams = [], decoded = [];
  const gain = () => ({ gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
  const win = { document: { hidden: false }, addEventListener() {}, removeEventListener() {},
    Audio: class {
      constructor() { this.paused = true; streams.push(this); }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute() {} load() {}
    },
  };
  const manager = new AudioManager({ win, getManifest: () => ({ audio: { bgm: { lobby: { loop: '/default.mp3' }, prep: { loop: '/prep.mp3' }, combat: { loop: '/battle.mp3' } } } }) });
  const ctx = { currentTime: 0, state: 'running', createGain: gain, createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve() };
  manager._buffer = async (url) => { decoded.push(url); return { duration: 1 }; };
  return { manager, streams, decoded, unlock() { manager.ctx = ctx; manager.bgmGain = gain(); } };
}

test('local music waits for unlock, shares mute/volume/visibility, pauses without restarting, and streams outside the buffer cache', () => {
  const { manager: a, streams, decoded, unlock } = audioHarness();
  a.playBgm('lobby'); a.setLobbyMusic({ url: 'blob:song' });
  assert.equal(streams.length, 0); unlock(); a.playBgm('lobby');
  assert.equal(streams.length, 1); assert.equal(streams[0].paused, false); assert.equal(streams[0].loop, true);
  assert.deepEqual(decoded, []);
  a.playBgm('lobby'); a.setLobbyMusic({ url: 'blob:song', paused: true });
  assert.equal(streams.length, 1); assert.equal(streams[0].paused, true);
  a.setLobbyMusic({ url: 'blob:song', paused: false }); assert.equal(streams[0].paused, false);
  a.setVolumes({ muted: true }); assert.equal(streams[0].paused, true);
  a.setVolumes({ muted: false, bgm: 0 }); assert.equal(streams[0].paused, true);
  a.setVolumes({ bgm: .6 }); assert.equal(streams[0].paused, false);
  a.win.document.hidden = true; a._onVis(); assert.equal(streams[0].paused, true);
  a.win.document.hidden = false; a._onVis(); assert.equal(streams[0].paused, false);
  a.bgm.stop();
});

test('late song restore cannot replace battle music; returning to the lobby selects it and reset restores official music', async () => {
  const { manager: a, unlock } = audioHarness(); unlock();
  a.playBgm('combat:1'); a.setLobbyMusic({ url: 'blob:song' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(a.bgmKey, 'combat:1'); assert.equal(a.lobbyMusic.url, 'blob:song');
  a.playBgm('lobby'); assert.equal(a.bgm.loopUrl, 'blob:song');
  a.setLobbyMusic(null); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(a.bgm.loopUrl, '/default.mp3');
});

test('muted songs do not start a media request; failed songs fall back without reviving a previous route', async () => {
  const { manager: a, unlock, streams } = audioHarness(); unlock();
  a.setVolumes({ muted: true }); a.setLobbyMusic({ url: 'blob:bad' }); a.playBgm('lobby');
  assert.equal(streams.length, 0);
  a.setVolumes({ muted: false }); const oldError = streams[0].onerror;
  oldError(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(a.lobbyMusic, null); assert.equal(a.bgm.loopUrl, '/default.mp3');
  a.playBgm('prep'); oldError(); assert.equal(a.bgmKey, 'prep');
});

test('lobby media uses existing modal management and audio bootstrap without changing battle choices', () => {
  const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(read('public/js/main.js'), /installLobbyMusic\(\)/);
  assert.match(read('public/js/screens/lobby.js'), /title=\$\{t\('大厅背景'\)\}/);
  assert.match(read('public/js/screens/lobby.js'), /open=\$\{bgOpen\} utility=\$\{true\}/);
  assert.match(read('public/js/ui/lobbyMusic.js'), /open=\$\{open\} utility=\$\{true\}/);
});
