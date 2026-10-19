import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { audio } from '../audio.js';
import { data } from '../data.js';
import { useStore, selectRoute } from '../store.js';
import { DATA_CDN } from '../asset-cdn.js';
import { dataUrl } from '../../../shared/cdn.js';
import { langChain, t } from '../../../shared/i18n.js';
import { useSettings } from './settings.js';
import { useLang } from './lang.js';
import { CAPTION_LANGS, captionLocale, voiceCaptionIdentity, selectVoiceCaptions, voiceCaptionPosition, voiceCaptionHudPosition } from '../voiceCaptions.js';

const tables = new Map();
async function loadTable(lang) {
  if (!CAPTION_LANGS.includes(lang)) return null;
  if (!tables.has(lang)) tables.set(lang, fetch(dataUrl(`/data/voice-captions/${lang}.json`, DATA_CDN), { signal: AbortSignal.timeout(10000) })
    .then(r => { if (!r.ok) throw Error('Caption HTTP ' + r.status); return r.json(); })
    .catch(() => { tables.delete(lang); return null; })); // a future line can retry after a temporary failure
  return tables.get(lang);
}
const OBSTACLES = '.shopbar,.shopbar-tab,.gm__corner,.gm__watching,.gm__dead,.gm__bonds .bslot,.gm__bonds .bonds-toggle,.gm__bonds .bstrip__more,.gm__bonds .bstrip--empty,.gm__effects,.team,.gtop > *, .chud > *, .dpanel,.bpop,.edrawer,.ewheel__dialog,.combat-metrics,.gm__ui-slot,.site-notice,.lo button,.lo input,.lo .game-select,.result__actions';
const BLOCKED = '.modal,.guide,.st,.gm.has-sp,.gm.has-spdraft,.game-select-popover';

/** One strip for the actual audio channel; no timers derived from battle speed or simulated events. */
export function VoiceSubtitleHost({ manager = audio }) {
  const settings = useSettings(), lang = useLang(), route = useStore(selectRoute);
  const enabled = settings.voiceSubtitles;
  const uiLocale = langChain(lang).map(captionLocale).find(Boolean) || 'zh';
  const [line, setLine] = useState(null), [caption, setCaption] = useState(null), [position, setPosition] = useState(null);
  const [held, setHeld] = useState(null);
  const ref = useRef(null), pointer = useRef(null);
  useLayoutEffect(() => { setHeld(null); }, [enabled, manager, route, settings.voiceSubtitleMode, lang]);
  useEffect(() => {
    if (!enabled) { setLine(null); return; }
    return manager.subscribeVoice(value => {
      setLine(value);
      // A natural end keeps the hovered text; inaudible/background playback must still clear it.
      if (document.hidden || manager.volumes?.muted || manager.volumes?.voice <= 0
        || ['suspended', 'interrupted', 'closed'].includes(manager.ctx?.state)) setHeld(null);
    });
  }, [enabled, manager]);
  useLayoutEffect(() => {
    if (!held) return;
    const release = () => setHeld(null);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => { window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); };
  }, [held]);
  useEffect(() => {
    if (!enabled) return;
    if (settings.voiceSubtitleMode !== 'voice') void loadTable(uiLocale);
    if (settings.voiceSubtitleMode !== 'ui') void loadTable({ cn: 'zh', jp: 'ja', en: 'en', kr: 'ko' }[settings.voiceLang]);
  }, [enabled, uiLocale, settings.voiceLang, settings.voiceSubtitleMode]);
  useEffect(() => {
    if (!line || !enabled) { setCaption(null); return; }
    let live = true;
    const identity = voiceCaptionIdentity(line.url, line.nativeType);
    if (!identity) { setCaption(null); return; }
    const mode = settings.voiceSubtitleMode;
    Promise.all([mode !== 'voice' ? loadTable(uiLocale) : null, mode !== 'ui' ? loadTable(identity.lang) : null]).then(([ui, voice]) => {
      if (!live || manager.currentVoice()?.token !== line.token) return;
      const uiText = ui?.[identity.key], voiceText = voice?.[identity.key];
      const lines = selectVoiceCaptions({ mode, uiLang: uiLocale, voiceLang: identity.lang, uiText, voiceText });
      const backups = data.get('backups');
      const operator = data.list('chess').find(r => r.charId === line.charId) || backups?.units?.[line.charId] || backups?.diy?.operators?.[line.charId];
      setCaption({ token: line.token, lines, name: operator?.name || t('干员') });
    });
    return () => { live = false; };
  }, [line, enabled, settings.voiceSubtitleMode, uiLocale, lang, manager]);
  const playing = line && caption?.token === line.token && caption.lines.length ? caption : null;
  const current = enabled ? held || playing : null;
  useLayoutEffect(() => {
    if (!current || !position) return;
    const release = () => { pointer.current = null; setHeld(null); };
    const move = e => {
      pointer.current = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
      const el = ref.current, r = el?.getBoundingClientRect();
      const over = e.pointerType === 'mouse' && !e.buttons && r && getComputedStyle(el).visibility !== 'hidden'
        && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      setHeld(over ? current : null);
    };
    // Keep click/touch input passing through to the playfield; only observe the mouse's position.
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', release);
    document.addEventListener('pointercancel', release);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', release); document.removeEventListener('pointercancel', release); };
  }, [current, position]);
  useLayoutEffect(() => {
    if (!current || !ref.current) { setPosition(null); return; }
    let frame;
    const resize = new ResizeObserver(() => schedule());
    const update = () => {
      frame = null;
      const el = ref.current;
      if (!el) return;
      const obstacles = [...document.querySelectorAll(OBSTACLES)].filter(e => getComputedStyle(e).visibility !== 'hidden');
      for (const obstacle of obstacles) resize.observe(obstacle);
      const anchor = document.querySelector('.gtop__subtitle-anchor');
      if (anchor) resize.observe(anchor);
      const blocked = document.querySelector(BLOCKED);
      const root = getComputedStyle(document.documentElement), safe = side => parseFloat(root.getPropertyValue('--sa-' + side)) || 0;
      const oldWidth = el.style.width;
      let p = null, height = 0;
      try {
        if (!blocked) {
          const viewport = { width: innerWidth, height: innerHeight, safeTop: safe('t'), safeBottom: safe('b'), safeLeft: safe('l'), safeRight: safe('r') };
          const box = { width: 520, minWidth: 280,
            heightAtWidth: width => { el.style.width = `${width}px`; return el.getBoundingClientRect().height; } };
          const rects = obstacles.map(e => e.getBoundingClientRect());
          if (anchor) p = voiceCaptionHudPosition(viewport, box, anchor.getBoundingClientRect(), rects);
          else p = document.querySelector('.gm') ? null : voiceCaptionPosition(viewport, box, rects);
          if (p && pointer.current) height = box.heightAtWidth(p.width);
        }
      } finally { el.style.width = oldWidth; }
      const mouse = pointer.current;
      if (!p || mouse && (mouse.x < p.left || mouse.x >= p.left + p.width || mouse.y < p.top || mouse.y >= p.top + height)) setHeld(null);
      setPosition(old => JSON.stringify(old) === JSON.stringify(p) ? old : p);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
    resize.observe(ref.current);
    const mutations = new MutationObserver(records => {
      if (records.some(r => !ref.current?.contains(r.target))) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    update();
    return () => { resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); };
  }, [current]);
  if (!current) return null;
  return html`<section ref=${ref} class=${`voice-subtitles${held ? ' is-held' : ''}`} role="status" aria-live="off" aria-label=${t('干员台词')}
    style=${position ? `left:${position.left}px;top:${position.top}px;width:${position.width}px` : 'visibility:hidden'}>
    <header class="voice-subtitles__speaker"><${Icon} name="mic" /><span>${current.name}</span></header>
    <div class="voice-subtitles__text">${current.lines.map((row, i) => html`<p key=${row.lang} lang=${row.lang}
      class=${`voice-subtitles__line${i ? ' is-translation' : ''}`}>${row.text}</p>`)}</div>
  </section>`;
}
