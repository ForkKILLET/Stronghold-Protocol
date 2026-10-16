// Image/background controls adapted from Stardust-minus/Stronghold-Protocol d6e96f4 (ui/hubBackdrop.js).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { createLocalMedia, mediaStorage } from './localMedia.js';
import { t, N_ } from '../../../shared/i18n.js';

export const HUB_THEMES = Object.freeze([
  { id: 'night', name: N_('夜巡'), en: 'NIGHT WATCH' },
  { id: 'frost', name: N_('霜原'), en: 'FROSTLINE' },
  { id: 'ember', name: N_('烬野'), en: 'EMBERFIELD' },
  { id: 'calm', name: N_('静默'), en: 'SILENT' },
]);
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_EDGE = 2560;
const PREF_KEY = 'hub.backdrop';
export function sanitizeBackdrop(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (n, fallback, max) => Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
  return {
    theme: r.theme === 'custom' || HUB_THEMES.some((x) => x.id === r.theme) ? r.theme : 'night',
    dim: num(r.dim, 45, 85), blur: num(r.blur, 0, 16), overlay: r.overlay !== false, motion: r.motion !== false,
  };
}

export function validateImage(file) {
  if (!file || file.size <= 0 || !/^image\//.test(file.type)) throw new Error(t('请选择有效的图片文件'));
  if (file.size > MAX_IMAGE_BYTES) throw new Error(t('图片太大（上限 30MB）'));
}

/** Re-encode on the device, keeping transparent images readable against the hub's ground colour. */
export async function prepareBackdrop(file) {
  validateImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error(t('图片读取超时，请换一个文件试试'))); }, 15000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error(t('背景读取失败，换一个文件试试'))); };
      img.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('浏览器无法处理该图片'));
    ctx.fillStyle = '#0b1110'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error(t('图片转换失败'));
    return { blob };
  } finally { URL.revokeObjectURL(url); }
}

const images = createLocalMedia({ storage: mediaStorage('sp-hub-backdrop', 'kv', 'image'),
  valid: (r) => r?.blob instanceof Blob && /^image\//.test(r.blob.type) && r.blob.size > 0 && r.blob.size <= MAX_IMAGE_BYTES });
const preferences = createStore(sanitizeBackdrop(loadPref(PREF_KEY, null)));
preferences.subscribe((pref) => savePref(PREF_KEY, pref));

export function useHubBackdrop() {
  const pref = useStore((s) => s, Object.is, preferences);
  const [image, setImage] = useState(images.get);
  useEffect(() => {
    const off = images.subscribe(setImage);
    setImage(images.get()); images.load();
    return off;
  }, []);
  // A file import can finish after navigating away; its choice must still be available on the next visit.
  const update = (patch) => preferences.set(sanitizeBackdrop({ ...preferences.get(), ...patch }));
  return { pref, update, imageUrl: image.url, ready: image.ready, busy: image.busy,
    async setImage(file) { if (await images.change(() => prepareBackdrop(file))) update({ theme: 'custom' }); },
    async clearImage() { if (await images.change(() => null)) update({ theme: 'night', dim: 45, blur: 0 }); },
  };
}

export function backdropScene(bg) {
  return bg.pref.theme !== 'custom' ? bg.pref.theme : bg.imageUrl ? 'photo' : bg.ready ? 'night' : 'blank';
}
export function backdropTheme(bg) {
  const scene = backdropScene(bg);
  return scene === 'photo' ? 'custom' : scene === 'blank' ? 'night' : scene;
}
