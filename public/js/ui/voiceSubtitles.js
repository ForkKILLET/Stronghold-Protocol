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
import { createVoiceCaptionTables } from '../voiceCaptionTables.js';
import { captionLocale, voiceCaptionIdentity, selectVoiceCaptions, formatVoiceCaption, voiceCaptionPosition, voiceCaptionHudPosition, voiceCaptionDockPosition } from '../voiceCaptions.js';

const tables = createVoiceCaptionTables({ urlFor: lang => dataUrl(`/data/voice-captions/${lang}.json`, DATA_CDN) });
const loadTable = lang => tables.load(lang);
const OBSTACLES = '.shopbar,.shopbar-tab,.gm__corner,.gm__watching,.gm__dead,.gm__bonds .bslot,.gm__bonds .bonds-toggle,.gm__bonds .bstrip__more,.gm__bonds .bstrip--empty,.gm__effects,.team,.gtop > *, .chud > *, .dpanel,.bpop,.edrawer,.ewheel__dialog,.combat-metrics,.ldmg,.term-help,.room-vote-panel:popover-open,.gm__ui-slot,.site-notice,.lo button,.lo input,.lo .game-select,.result__actions';
// Full-page surfaces reserve a caption lane; their dimming backdrops are not obstacles.
const SURFACES = '.modal,.guide,.st,.lo,.spov';

/** One strip for the actual audio channel; no timers derived from battle speed or simulated events. */
export function VoiceSubtitleHost({ manager = audio }) {
  const settings = useSettings(), lang = useLang(), route = useStore(selectRoute);
  const playerName = useStore(s => s.me.name) || t('博士');
  const enabled = settings.voiceSubtitles;
  const uiLocale = langChain(lang).map(captionLocale).find(Boolean) || 'zh';
  const [line, setLine] = useState(null), [caption, setCaption] = useState(null), [position, setPosition] = useState(null);
  const [held, setHeld] = useState(null), [tableRevision, setTableRevision] = useState(0);
  useEffect(() => enabled ? tables.subscribe(() => setTableRevision(n => n + 1)) : undefined, [enabled]);
  const ref = useRef(null);
  useLayoutEffect(() => { setHeld(null); }, [enabled, manager, route, settings.voiceSubtitleMode, lang]);
  useEffect(() => {
    if (!enabled) { setLine(null); return; }
    let fieldRevision = manager.fieldRevision;
    return manager.subscribeVoice(value => {
      setLine(value);
      // Natural end/takeover keep hovered text; field cleanup and inaudible/background playback clear it.
      if (fieldRevision !== manager.fieldRevision || document.hidden || manager.volumes?.muted || manager.volumes?.voice <= 0
        || ['suspended', 'interrupted', 'closed'].includes(manager.ctx?.state)) setHeld(null);
      fieldRevision = manager.fieldRevision;
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
  }, [line, enabled, settings.voiceSubtitleMode, uiLocale, lang, manager, tableRevision]);
  const playing = line && caption?.token === line.token && caption.lines.length ? caption : null;
  const current = enabled ? held || playing : null;
  useLayoutEffect(() => {
    if (!current || !position) return;
    const release = () => setHeld(null);
    const move = e => {
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
    let frame, hudDocked = false;
    const reserved = new Set();
    const clearReservation = el => { el.classList.remove('voice-caption-reserved'); el.style.removeProperty('--voice-caption-reserve'); el.style.removeProperty('--voice-caption-content-height'); };
    const visible = el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const resize = new ResizeObserver(() => schedule());
    const update = () => {
      frame = null;
      const el = ref.current;
      if (!el) return;
      const obstacles = [...document.querySelectorAll(OBSTACLES + ',.game-select-popover')].filter(visible);
      for (const obstacle of obstacles) resize.observe(obstacle);
      const anchor = document.querySelector('.gtop__subtitle-anchor');
      if (anchor) resize.observe(anchor);
      const surfaces = [...document.querySelectorAll(SURFACES)].filter(visible);
      const root = getComputedStyle(document.documentElement), safe = side => parseFloat(root.getPropertyValue('--sa-' + side)) || 0;
      const oldWidth = el.style.width;
      let p;
      try {
        const viewport = { width: innerWidth, height: innerHeight, safeTop: safe('t'), safeBottom: safe('b'), safeLeft: safe('l'), safeRight: safe('r') };
        const box = { width: 520, minWidth: 280,
          heightAtWidth: width => { el.style.width = `${width}px`; return el.getBoundingClientRect().height; } };
        const rects = obstacles.map(e => e.getBoundingClientRect());
        if (surfaces.length || hudDocked) p = voiceCaptionDockPosition(viewport, box);
        else if (anchor) p = voiceCaptionHudPosition(viewport, box, anchor.getBoundingClientRect(), rects);
        else p = voiceCaptionPosition(viewport, box, rects);
        if (p.dock && !surfaces.length) hudDocked = true; // Do not oscillate after reserving HUD space.
        const hud = !surfaces.length || surfaces.some(e => e.matches('.spov')) ? [...document.querySelectorAll('.gm__hud')] : [];
        const targets = p.dock ? [...surfaces, ...hud] : [];
        const reserve = `${Math.ceil(viewport.height - p.top + 8)}px`;
        for (const target of reserved) if (!targets.includes(target)) { clearReservation(target); reserved.delete(target); }
        for (const target of targets) {
          if (!target.classList.contains('voice-caption-reserved')) target.classList.add('voice-caption-reserved');
          if (target.style.getPropertyValue('--voice-caption-reserve') !== reserve) target.style.setProperty('--voice-caption-reserve', reserve);
          const style = getComputedStyle(target);
          const available = Math.max(0, p.top - 8 - target.getBoundingClientRect().top - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
          const contentHeight = `${Math.floor(available)}px`;
          if (target.style.getPropertyValue('--voice-caption-content-height') !== contentHeight) target.style.setProperty('--voice-caption-content-height', contentHeight);
          reserved.add(target);
        }
      } finally { el.style.width = oldWidth; }
      // Relocation is not a reason to discard a hovered phrase. Real pointer movement releases it.
      setPosition(old => JSON.stringify(old) === JSON.stringify(p) ? old : p);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
    resize.observe(ref.current);
    const mutations = new MutationObserver(records => {
      if (records.some(r => !ref.current?.contains(r.target) && (r.attributeName !== 'style'
        || r.target === document.documentElement || r.target.matches(`${OBSTACLES},${SURFACES},.gtop__subtitle-anchor`)))) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('toggle', schedule, true);
    update();
    return () => { resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); for (const target of reserved) clearReservation(target); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); document.removeEventListener('toggle', schedule, true); };
  }, [current]);
  if (!current) return null;
  return html`<section ref=${ref} class=${`voice-subtitles${held ? ' is-held' : ''}${position?.dock ? ' is-docked' : ''}`} role="status" aria-live="off" aria-label=${t('干员台词')}
    style=${position ? `left:${position.left}px;top:${position.top}px;width:${position.width}px` : 'right:12px;bottom:12px'}>
    <header class="voice-subtitles__speaker"><${Icon} name="mic" /><span>${current.name}</span></header>
    <div class="voice-subtitles__text">${current.lines.map((row, i) => html`<p key=${row.lang} lang=${row.lang}
      class=${`voice-subtitles__line${i ? ' is-translation' : ''}`}>${formatVoiceCaption(row.text, playerName)}</p>`)}</div>
  </section>`;
}
