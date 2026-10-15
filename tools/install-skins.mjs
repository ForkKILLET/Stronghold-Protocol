// tools/install-skins.mjs — 按需安装干员皮肤 (docs/SKINS.md).
//
// Deployment-time tool, never invoked by a browser or a WebSocket handler. Downloads only the requested outfits
// and uses the existing asset animation-role pipeline before publishing their manifest entries.
//
// The files are Front and Back (each a .skel, a .atlas and a page .png), a 180×180 avatar and a 180×360 portrait. They come
// from the same upstream sources as a full run, so a rebuilt manifest and an installed skin never disagree.
//
// Interrupting an install is safe, and resuming is just running it again:
//   * the files — the Downloader writes through a temp file and renames, and skips whatever is already on disk
//     with the size its ledger recorded, so a re-run continues rather than starting over;
//   * the manifest and the selection — written after EVERY skin (saveProgress) through a temp file and a rename,
//     so quitting mid-way keeps the skins that finished and never leaves a truncated manifest (one that is half
//     written takes the whole client down: it is what resolves every model and avatar).
//
// CLI:
//   node tools/install-skins.mjs list [text]         what exists, and what is installed
//   node tools/install-skins.mjs add <skinId…>       install
//   node tools/install-skins.mjs remove <skinId…>    uninstall (the files stay on disk)
//   node tools/install-skins.mjs add-char <charId…>  every available skin of those operators
//   node tools/install-skins.mjs portraits          add portraits to already-installed skins, without model downloads

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fexliModelDef, alt, skillIndicesByChar } from './assets/plan.mjs';
import { processModels } from './assets/spine.mjs';
import { Downloader } from './assets/downloader.mjs';
import { contentHash, MANIFEST_VERSION } from './assets/manifest.mjs';
import { assetUrl } from './assets/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const CACHE = path.join(ROOT, '.cache');
const RESEARCH = path.join(ROOT, 'docs', 'research', '08-skins.json');
const OPS03 = path.join(ROOT, 'docs', 'research', '03-operators.json');
const SELECTION = path.join(ROOT, 'data', 'skins-installed.json');
const MANIFEST = path.join(ROOT, 'data', 'assets.json');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/**
 * Write JSON through a temp file + rename. `rename` is atomic on one filesystem, so a process killed mid-write
 * leaves either the old file or the new one — never a truncated one.
 *
 * This matters more here than anywhere else in the project: an install can be interrupted at any moment (the
 * player quits, the server is stopped), and a half-written data/assets.json is not a cosmetic problem — the
 * client reads it to resolve every model and avatar, so a truncated file means nothing renders at all.
 */
async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

/**
 * Every installable skin, keyed by skinId.
 * @returns {Promise<{ catalog: Map<string, {charId: string, skin: any}>, charIds: string[] }>}
 */
export async function readSkinCatalog() {
  const research = await readJson(RESEARCH);
  const catalog = new Map();
  for (const [charId, list] of Object.entries(research.skins || {})) {
    for (const skin of list) catalog.set(skin.skinId, { charId, skin });
  }
  return { catalog, charIds: Object.keys(research.skins || {}) };
}

/** @returns {Promise<Set<string>>} the skinIds data/skins-installed.json lists */
export async function readInstalled() {
  const sel = await readJson(SELECTION).catch(() => null);
  return new Set(Array.isArray(sel?.installed) ? sel.installed : []);
}

/** Write the selection file back, keeping its shape. */
async function writeInstalled(ids) {
  const sel = (await readJson(SELECTION).catch(() => null)) || { version: 1 };
  sel.version = sel.version || 1;
  sel.installed = [...ids].sort();
  await writeJsonAtomic(SELECTION, sel);
}

/**
 * `stats` is informational, but leaving it stale reads as a bug. Everything derivable from the manifest itself is
 * recomputed here; the disk-walk figures (files / bytes) just take the delta this run downloaded.
 * @param {any} m the manifest
 * @param {{files: number, bytes: number}} delta
 */
function refreshStats(m, delta) {
  const vals = (o) => Object.values(o || {});
  const spines = new Set();
  for (const c of vals(m.chars)) {
    for (const s of vals(c.spine)) spines.add(s.skel);
    for (const sk of vals(c.skins)) for (const s of vals(sk.spine)) spines.add(s.skel);
  }
  for (const e of vals(m.enemies)) if (e.spine) spines.add(e.spine.skel);
  for (const t of vals(m.tokens)) if (t.spine) spines.add(t.spine.skel);
  const st = m.stats || (m.stats = {});
  st.files = (st.files || 0) + delta.files;
  st.bytes = (st.bytes || 0) + delta.bytes;
  st.spineModels = spines.size;
  st.skins = vals(m.chars).reduce((n, c) => n + vals(c.skins).length, 0);
  st.charsWithSkins = vals(m.chars).filter((c) => c.skins).length;
}

/** The manifest body the hash is taken over (everything except the meta fields the writer adds). */
function hashBody(m) {
  const { version, hash, generator, stats, ...body } = m;
  return body;
}

/**
 * Install skins: download their models and avatar, resolve animation roles, then splice them into the manifest.
 * @param {string[]} ids skinIds
 * @param {{ log?: (m: string) => void, force?: boolean }} [opts]
 * @returns {Promise<{ installed: string[], failed: { id: string, why: string }[] }>}
 */
export async function installSkins(ids, { log = console.log, force = false, onProgress = null } = {}) {
  const { catalog } = await readSkinCatalog();
  const manifest = await readJson(MANIFEST);
  const ops03 = await readJson(OPS03).catch(() => null);
  const skillIdx = ops03 ? skillIndicesByChar(ops03) : new Map();
  const installed = await readInstalled();

  // Per-file progress. The Downloader has no public hook — it reports through its `log` (`[spine] 3/6 ok=…`) — so
  // the label lines are read back out here. Model, avatar and portrait passes contribute to one progress total.
  let current = null;
  const seen = { spine: [0, 0], 'skin-avatar': [0, 0], 'skin-portrait': [0, 0] };
  const report = () => {
    if (!onProgress || !current) return;
    const done = Object.values(seen).reduce((n, v) => n + v[0], 0);
    const total = Object.values(seen).reduce((n, v) => n + v[1], 0);
    onProgress({ skinId: current, phase: 'download', done, total });
  };
  const dl = new Downloader({
    root: ASSETS, ledgerPath: path.join(CACHE, 'assets-ledger.json'), force,
    log: (m) => {
      const mm = /^\[(spine|skin-avatar|skin-portrait)\]\s+(\d+)\/(\d+)/.exec(String(m));
      if (mm) { seen[mm[1]] = [Number(mm[2]), Number(mm[3])]; report(); }
      log(m);
    },
  });
  await dl.loadLedger();
  let before = { files: dl.totals?.ok || 0, bytes: dl.totals?.bytesDownloaded || 0 };

  const ok = [];
  const failed = [];

  /**
   * Persist everything installed so far. Called after EVERY skin rather than once at the end, because one skin
   * takes tens of seconds on a slow link and the player may quit in the middle: whatever finished stays installed
   * and usable, and a later run picks up at the next one. The files themselves are already resumable — the
   * downloader skips what is on disk and records what it fetched in its ledger — so this only has to keep the
   * manifest and the selection in step with them.
   */
  async function saveProgress() {
    refreshStats(manifest, { files: (dl.totals?.ok || 0) - before.files, bytes: (dl.totals?.bytesDownloaded || 0) - before.bytes });
    before = { files: dl.totals?.ok || 0, bytes: dl.totals?.bytesDownloaded || 0 };
    manifest.version = MANIFEST_VERSION;
    manifest.hash = contentHash(hashBody(manifest));
    await writeJsonAtomic(MANIFEST, manifest);
    await writeInstalled(installed);
  }

  for (const id of ids) {
    const hit = catalog.get(id);
    if (!hit) { failed.push({ id, why: '不在 docs/research/08-skins.json 里' }); continue; }
    const { charId, skin } = hit;
    current = id;
    // Seed with the expected model, avatar and portrait file counts. The downloader's total can be higher when an atlas
    // references extra pages, and it overrides this as soon as it reports.
    seen.spine = [0, 3 + (skin.battleSpine?.back ? 3 : 0)];
    seen['skin-avatar'] = [0, skin.avatar?.url ? 1 : 0];
    seen['skin-portrait'] = [0, skin.portrait?.url ? 1 : 0];
    report();

    // 1. the Spine models. Going through processModels is what resolves the animation roles (anims) the client's
    //    validSpine() requires — without them the model silently never loads.
    const models = new Map();
    for (const side of ['front', 'back']) {
      const key = `skin:${skin.stem}:${side}`;
      const def = fexliModelDef(key, 'op', `spine/op/${charId}/${skin.stem}/${side}/`, skin.battleSpine?.[side], skillIdx.get(charId) || [0]);
      if (def) models.set(key, def);
    }
    if (!models.size) { failed.push({ id, why: '08-skins.json 里缺少模型 URL' }); continue; }

    const { entries, problems } = await processModels(models, {
      root: ASSETS, dl, cachePath: path.join(CACHE, 'spine-info.json'), download: true, log,
    });
    const front = entries.get(`skin:${skin.stem}:front`);
    const back = entries.get(`skin:${skin.stem}:back`);
    if (!front) { failed.push({ id, why: `Front 模型不可用${problems.length ? ` (${problems[0]})` : ''}` }); continue; }

    // 2. the avatar leaf
    const avatarRel = `char/avatar/skin/${skin.stem}.png`;
    let avatarUrl = null;
    if (skin.avatar?.url) {
      await dl.run([alt(avatarRel, skin.avatar.url)], 'skin-avatar');
      try { await readFile(path.join(ASSETS, avatarRel)); avatarUrl = assetUrl(avatarRel); }
      catch { log(`[skins] ${id}: avatar 下载失败，皮肤仍可用（选择器会退回干员头像）`); }
    }

    // 3. splice it in, exactly where the plan would have put it
    const entry = { spine: { front } };
    if (back) entry.spine.back = back;
    if (avatarUrl) entry.avatar = avatarUrl;
    const portrait = skinPortraitJob(skin);
    if (portrait) {
      const results = await dl.run([portrait], 'skin-portrait');
      if (['ok', 'skip'].includes(results.get(portrait.rel)?.status)) entry.portrait = assetUrl(portrait.rel);
      else log(`[skins] ${id}: portrait 下载失败，使用默认立绘`);
    }
    entry.name = skin.name;
    entry.group = skin.group;
    const c = manifest.chars[charId] || (manifest.chars[charId] = {});
    c.skins = c.skins || {};
    c.skins[id] = entry;
    installed.add(id);
    ok.push(id);
    log(`[skins] ✓ ${id}  ${skin.name}${skin.group ? ` [${skin.group}]` : ''}  (a${Object.keys(front.anims || {}).length}项角色, ${back ? '有' : '无'}Back)`);
    // the download is over; the parse and the manifest write are what remains, and neither can report a fraction
    const total = Object.values(seen).reduce((n, v) => n + v[1], 0);
    if (onProgress) onProgress({ skinId: id, phase: 'finishing', done: total, total });
    await saveProgress();
  }

  return { installed: ok, failed };
}

/** The same 180×360 portrait used by the normal asset plan, with a filename-safe stem. */
export function skinPortraitJob(skin) {
  return skin.portrait?.url ? alt(`char/portrait/skin/${skin.stem}.png`, skin.portrait.url, skin.portrait.bytes) : null;
}

/** Upgrade installed entries without fetching models, changing selections or replacing other manifest fields. */
export async function installSkinPortraits({ root = ROOT, log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const manifestPath = path.join(root, 'data', 'assets.json');
  const manifest = await readJson(manifestPath);
  const research = await readJson(path.join(root, 'docs', 'research', '08-skins.json'));
  const dl = new Downloader({ root: path.join(root, 'public', 'assets'), ledgerPath: path.join(root, '.cache', 'assets-ledger.json'), log, fetchImpl });
  await dl.loadLedger();
  const selected = [];
  const failed = [];
  for (const [charId, skins] of Object.entries(research.skins || {})) for (const skin of skins) {
    const entry = manifest.chars?.[charId]?.skins?.[skin.skinId];
    if (!entry) continue;
    const job = skinPortraitJob(skin);
    if (job) selected.push({ entry, job, id: skin.skinId });
    else failed.push(skin.skinId);
  }
  const results = await dl.run(selected.map((v) => v.job), 'skin-portrait');
  let installed = 0;
  for (const { entry, job, id } of selected) {
    if (['ok', 'skip'].includes(results.get(job.rel)?.status)) { entry.portrait = assetUrl(job.rel); installed++; }
    else failed.push(id);
  }
  if (installed) {
    refreshStats(manifest, { files: dl.totals.ok, bytes: dl.totals.bytesDownloaded });
    manifest.version = MANIFEST_VERSION;
    manifest.hash = contentHash(hashBody(manifest));
    await writeJsonAtomic(manifestPath, manifest);
  }
  return { installed, failed };
}

/**
 * Uninstall: drop the entries from the manifest and the selection. The files stay on disk (another skin may share
 * them, and the next install would only re-download them); `--prune` on the full pipeline clears orphans.
 * @param {string[]} ids
 * @param {{ log?: (m: string) => void }} [opts]
 */
export async function removeSkins(ids, { log = console.log } = {}) {
  const manifest = await readJson(MANIFEST);
  const installed = await readInstalled();
  const done = [];
  for (const id of ids) {
    let found = false;
    for (const c of Object.values(manifest.chars || {})) {
      if (c.skins && c.skins[id]) { delete c.skins[id]; if (!Object.keys(c.skins).length) delete c.skins; found = true; }
    }
    if (installed.delete(id) || found) { done.push(id); log(`[skins] ✓ 已卸载 ${id}`); }
  }
  if (done.length) {
    refreshStats(manifest, { files: 0, bytes: 0 });
    manifest.version = MANIFEST_VERSION;
    manifest.hash = contentHash(hashBody(manifest));
    await writeJsonAtomic(MANIFEST, manifest);
    await writeInstalled(installed);
  }
  return done;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'portraits') {
    const result = await installSkinPortraits();
    console.log(`[skins] 立绘就绪 ${result.installed}，失败 ${result.failed.length}`);
    for (const id of result.failed) console.error(`[skins] ✗ ${id}: portrait unavailable`);
    return result.failed.length ? 1 : 0;
  }
  const { catalog, charIds } = await readSkinCatalog();
  const installed = await readInstalled();

  if (!cmd || cmd === 'list') {
    const filter = args.join(' ').toLowerCase();
    const rows = [...catalog.entries()].filter(([id, v]) =>
      !filter || id.toLowerCase().includes(filter) || String(v.skin.name).toLowerCase().includes(filter));
    console.log(`可用皮肤 ${catalog.size} 套（涉及 ${charIds.length} 个干员），已安装 ${installed.size} 套\n`);
    for (const [id, { charId, skin }] of rows) {
      console.log(`  ${installed.has(id) ? '●' : '○'} ${id.padEnd(34)} ${String(skin.name).padEnd(18)} ${skin.group || ''}  [${charId}]`);
    }
    console.log('\n  ● 已安装   ○ 未安装');
    return 0;
  }

  if (cmd === 'add' || cmd === 'remove') {
    if (!args.length) { console.error('用法: node tools/install-skins.mjs add <skinId…>'); return 2; }
    const r = cmd === 'add' ? await installSkins(args) : { installed: await removeSkins(args), failed: [] };
    for (const f of r.failed) console.error(`[skins] ✗ ${f.id}: ${f.why}`);
    console.log(`\n${cmd === 'add' ? '已安装' : '已卸载'} ${r.installed.length} 套`);
    return r.failed.length && !r.installed.length ? 1 : 0;
  }

  if (cmd === 'add-char' || cmd === 'add-all') {
    if (cmd === 'add-char' && !args.length) { console.error('用法: node tools/install-skins.mjs add-char <charId…>'); return 2; }
    const ids = [...catalog.entries()].filter(([, v]) => cmd === 'add-all' || args.includes(v.charId)).map(([id]) => id);
    if (!ids.length) { console.error(`没有找到这些干员的皮肤: ${args.join(', ')}`); return 1; }
    console.log(`选中 ${ids.length} 套: ${ids.join(', ')}\n`);
    const r = await installSkins(ids);
    for (const f of r.failed) console.error(`[skins] ✗ ${f.id}: ${f.why}`);
    console.log(`\n已安装 ${r.installed.length} 套`);
    return r.failed.length ? 1 : 0;
  }

  console.error(`未知命令: ${cmd}（可用: list / add / remove / add-char / add-all / portraits）`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
}
