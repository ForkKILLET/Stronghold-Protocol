// Local song selection adapted from Stardust-minus/Stronghold-Protocol d6e96f4, ui/lobbyMusic.js.
// Playback belongs to AudioManager, sharing its BGM volume, gesture unlock and route/visibility lifecycle.
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { audio } from '../audio.js';
import { createLocalMedia, mediaStorage } from './localMedia.js';
import { t } from '../../../shared/i18n.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
export function validateMusicFile(file) {
  if (!file || file.size <= 0) throw new Error(t('请选择有效的音频文件'));
  if (file.size > MAX_MUSIC_BYTES) throw new Error(t('音乐不能超过 20MB，请选择较小的文件'));
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '')
    || (file.type && !file.type.startsWith('audio/') && !['video/webm', 'application/ogg'].includes(file.type))) {
    throw new Error(t('请选择 MP3、M4A、OGG、WAV 等音频文件'));
  }
}

export async function prepareMusic(file) {
  validateMusicFile(file);
  const url = URL.createObjectURL(file), probe = new Audio();
  probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t('音频读取超时，请尝试其他文件'))), 10000);
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        if (Number.isFinite(probe.duration) && probe.duration > 0) resolve();
        else reject(new Error(t('音频文件无效')));
      };
      probe.onerror = () => { clearTimeout(timer); reject(new Error(t('浏览器无法播放该音频，请尝试 MP3 或 M4A'))); };
      probe.src = url;
    });
    return { blob: file, name: file.name, paused: false };
  } finally {
    probe.onloadedmetadata = probe.onerror = null;
    probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url);
  }
}

export const lobbyMusic = createLocalMedia({ storage: mediaStorage('sp-lobby-music', 'tracks', 'lobby'),
  valid: (r) => {
    if (!(r?.blob instanceof Blob)) return false;
    try { validateMusicFile({ size: r.blob.size, type: r.blob.type, name: r.name }); return true; } catch { return false; }
  },
});
let installed = false;
export function installLobbyMusic() {
  if (installed) return;
  installed = true;
  let lastUrl, lastPaused;
  lobbyMusic.subscribe((s) => {
    if (lastUrl === s.url && lastPaused === s.record?.paused) return;
    lastUrl = s.url; lastPaused = s.record?.paused;
    audio.setLobbyMusic(s.url ? { url: s.url, paused: s.record.paused } : null);
  });
  lobbyMusic.load();
}

export function LobbyMusicButton() {
  const [open, setOpen] = useState(false), [state, setState] = useState(lobbyMusic.get), [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => {
    installLobbyMusic(); const off = lobbyMusic.subscribe(setState); setState(lobbyMusic.get()); return off;
  }, []);
  const action = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message || t('操作失败')); } };
  const record = state.record;
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn"
    title=${t('大厅音乐')} aria-label=${t('大厅音乐')} onClick=${() => setOpen(true)}>
    <svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9 3v12.2A4 4 0 1 0 11 19V7l8-2v8.2A4 4 0 1 0 21 17V0z" /></svg><//>
    <${Modal} open=${open} utility=${true} class="lobby-music-panel" title=${t('大厅音乐')} micro="LOBBY MUSIC" onClose=${() => setOpen(false)}>
      <div class="lobby-music">
        <p class="bgset__note">${t('选择你喜欢的大厅音乐，每首最大 20MB。仅保存在当前浏览器，无需上传服务器。')}</p>
        <div class="lobby-music__track" role="status"><strong>${record?.name || t('默认大厅音乐')}</strong>
          <span>${state.busy ? t('正在导入…') : record ? record.paused ? t('已暂停') : t('已启用 · 单曲循环') : t('使用游戏默认音乐')}</span>
          ${record ? html`<small>${(record.blob.size / 1024 / 1024).toFixed(1)} MB</small>` : null}</div>
        <input ref=${input} type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm" hidden onChange=${(e) => {
          const file = e.currentTarget.files?.[0]; e.currentTarget.value = '';
          if (file) action(() => lobbyMusic.change(() => prepareMusic(file)));
        }} />
        <div class="bgset__row">
          <${Button} disabled=${state.busy} onClick=${() => input.current?.click()}>${record ? t('更换音乐') : t('选择音乐')}<//>
          <${Button} disabled=${!record || state.busy} onClick=${() => {
            audio._unlock(); action(() => lobbyMusic.change(() => ({ ...record, paused: !record.paused })));
          }}>${record?.paused ? t('播放') : t('暂停')}<//>
          <${Button} disabled=${!record || state.busy} variant="secondary" onClick=${() => action(() => lobbyMusic.change(() => null))}>${t('恢复默认')}<//>
        </div>
        <p class="bgset__note">${t('音量和静音沿用游戏设置。标题页、房间及战前选择继续播放，进入战场切换原有音乐。刷新后保留，清理浏览器数据会删除音乐。')}</p>
        ${error ? html`<p class="lobby-media-error" role="alert">${t(error)}</p>` : null}
      </div>
    <//>`;
}
