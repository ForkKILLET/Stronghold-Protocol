import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, Tabs, useTicker } from './components.js';
import { createStore, store, useStore, loadPref, savePref } from '../store.js';
import { net } from '../net.js';
import { announcementLive, validAnnouncementUrl } from '../../../shared/announcements.js';
import { PHASE } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

/** Constant pixel speed for long and short notices; the animation travels across the measured viewport. */
export function announcementScroll(viewport, textWidth) {
  const distance = Math.max(0, viewport) + Math.max(0, textWidth);
  return { from: Math.max(0, viewport), to: -Math.max(0, textWidth), duration: Math.max(8, distance / 70) };
}

export function announcementDismissKey(notice) {
  if (!notice) return '';
  const key = `${notice.type === 'popup' ? 'popup:' : ''}${notice.id}:${notice.startAt}:${notice.endAt}:${notice.text}`;
  const display = notice.title !== undefined || notice.url !== undefined || notice.autoPopup !== undefined
    ? `${key}:${JSON.stringify([notice.title, notice.url, notice.autoPopup])}` : key;
  return notice.format !== undefined ? `${display}:${notice.format}` : display;
}

export const announcementUi = createStore({ open: false, automatic: false, noticeKey: '' });
export const closeAnnouncement = () => announcementUi.set({ open: false, automatic: false, noticeKey: '' });
let popupMemory = [];

function popupSeen() {
  const saved = loadPref('announcementPopupsSeen', popupMemory);
  return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string').slice(-100) : [];
}

function rememberPopup(key) {
  popupMemory = [...popupSeen().filter((seen) => seen !== key), key].slice(-100);
  savePref('announcementPopupsSeen', popupMemory);
}

export function openAnnouncement() {
  const notice = store.get().popupAnnouncement;
  if (announcementLive(notice, net.serverNow())) rememberPopup(announcementDismissKey(notice));
  announcementUi.set({ open: true, automatic: false, noticeKey: '' });
}

// Include match startup, preparation, spectators and the result screen; reconnecting must not pop over a restored match.
const popupBlocked = (s) => !!s.room?.inMatch || !!(s.match?.public?.phase && s.match.public.phase !== PHASE.LOBBY);

/** Unseen notices wait until outside a match. Closing or reconnecting never reopens the same viewed version. */
export function syncAnnouncementPopup(notice, now, inMatch = popupBlocked(store.get())) {
  if (notice?.type !== 'popup' || !announcementLive(notice, now)) {
    if (announcementUi.get().automatic) closeAnnouncement();
    return;
  }
  if (inMatch) {
    if (announcementUi.get().automatic) closeAnnouncement();
    return; // Do not mark the notice viewed until it is actually shown (manual viewing still records it).
  }
  const key = announcementDismissKey(notice);
  if (announcementUi.get().automatic && announcementUi.get().noticeKey !== key) closeAnnouncement();
  if (notice.autoPopup === true && !popupSeen().includes(key)) {
    rememberPopup(key);
    announcementUi.set({ open: true, automatic: true, noticeKey: key });
  }
}

export function AnnouncementButton({ class: cls, variant = 'secondary', size = 'sm', onClick } = {}) {
  return html`<${Button} variant=${variant} size=${size} icon="info" class=${cls}
    aria-haspopup="dialog" title=${t('公告')} onClick=${() => { onClick?.(); openAnnouncement(); }}>${t('公告')}<//>`;
}

// No Markdown parser in the initial static graph. Load only while a Markdown popup body is mounted.
let markdownModule = null, markdownPending = null;
export function loadAnnouncementMarkdown() {
  if (markdownModule) return Promise.resolve(markdownModule);
  if (!markdownPending) {
    markdownPending = import('./announcementMarkdown.js').then(module => {
      markdownModule = module;
      return module;
    }).finally(() => { markdownPending = null; });
  }
  return markdownPending;
}

function MarkdownBody({ text }) {
  const [module, setModule] = useState(() => markdownModule);
  useEffect(() => {
    let mounted = true;
    if (!module) loadAnnouncementMarkdown().then(value => { if (mounted) setModule(value); }).catch(() => {});
    return () => { mounted = false; };
  }, [module]);
  // Expiry/clock ticks must not re-lex a long body; cache only within this mounted component.
  return useMemo(() => module ? module.renderAnnouncementMarkdown(text)
    : html`<p class="modal__text announcement-content__plain">${text}</p>`, [module, text]);
}

export function AnnouncementContent({ notice }) {
  if (!notice) return html`<p class="modal__text">${t('暂无公告')}</p>`;
  return html`<div class="announcement-content">
    ${notice.format === 'markdown' ? html`<${MarkdownBody} text=${notice.text} />`
      : html`<p class="modal__text announcement-content__plain">${notice.text}</p>`}
    ${validAnnouncementUrl(notice.url) ? html`<a class="announcement-content__link" href=${notice.url} target="_blank" rel="noopener noreferrer">
      <${Icon} name="link" />${t('查看详情')}<span class="announcement-content__url">${notice.url}</span>
    </a>` : null}
  </div>`;
}

function ChangelogContent() {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    fetch('/api/changelog', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('changelog unavailable');
      const data = await response.json();
      if (!Array.isArray(data.entries)) throw new Error('invalid changelog');
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => { if (!controller.signal.aborted) setResult({ error: true }); });
    return () => controller.abort();
  }, [attempt]);
  const days = useMemo(() => {
    const grouped = new Map();
    for (const entry of result?.entries || []) {
      if (!grouped.has(entry.date)) grouped.set(entry.date, []);
      grouped.get(entry.date).push(entry);
    }
    return [...grouped];
  }, [result]);
  if (!result) return html`<p class="modal__text" role="status">${t('加载中')}</p>`;
  if (result.error) return html`<div class="announcement-content" role="status">
    <p class="modal__text">${t('更新日志加载失败，请重试。')}</p>
    <${Button} variant="secondary" onClick=${() => setAttempt(value => value + 1)}>${t('重试')}<//>
  </div>`;
  if (!days.length) return html`<p class="modal__text">${t('暂无更新记录。')}</p>`;
  return html`<div class="announcement-changelog">
    ${validAnnouncementUrl(result.source) ? html`<a class="announcement-changelog__source" href=${result.source} target="_blank" rel="noopener noreferrer"><${Icon} name="link" />${t('完整更新记录')}</a>` : null}
    ${days.map(([date, entries], index) => html`<details class="announcement-changelog__day" key=${date} open=${index === 0}>
      <summary><time dateTime=${date}>${date}</time><span>${t('{n} 项更新', { n: entries.length })}</span><${Icon} name="chevronRight" /></summary>
      <div class="announcement-changelog__entries">${entries.map((entry, i) => html`<article key=${i}>
        ${entry.title ? html`<h3>${entry.title}</h3>` : null}
        <${AnnouncementContent} notice=${{ text: entry.text, format: 'markdown' }} />
      </article>`)}</div>
    </details>`)}
  </div>`;
}

// Mount afresh when opened, or when an automatic notice replaces another version.
function AnnouncementSections({ notice }) {
  const [section, setSection] = useState(() => notice ? 'notice' : 'changelog');
  return html`<div class="announcement-sections">
    <${Tabs} class="announcement-sections__tabs" value=${section} onChange=${setSection} items=${[
      { id: 'notice', label: t('服务器公告') }, { id: 'changelog', label: t('更新日志') },
    ]} />
    <section key=${section} class="announcement-sections__panel" role="tabpanel" tabIndex="0"
      aria-label=${section === 'notice' ? t('服务器公告') : t('更新日志')}>
      ${section === 'notice' ? html`<div class="announcement-content">
        ${notice?.title ? html`<h3 class="announcement-content__title">${notice.title}</h3>` : null}
        <${AnnouncementContent} notice=${notice} />
      </div>` : html`<${ChangelogContent} />`}
    </section>
  </div>`;
}

export function AnnouncementHost() {
  const notice = useStore((s) => s.popupAnnouncement);
  const inMatch = useStore(popupBlocked);
  useStore((s) => s.clock.offset);
  const { open, automatic } = useStore((s) => s, Object.is, announcementUi);
  const now = net.serverNow();
  useTicker(notice && Number.isFinite(notice.endAt) && now < notice.endAt ? 250 : 0);
  const live = announcementLive(notice, now);
  const key = announcementDismissKey(notice);
  useEffect(() => { syncAnnouncementPopup(notice, net.serverNow(), inMatch); }, [key, live, inMatch]);
  return html`<${Modal} open=${open && (!automatic || !inMatch)} title=${t('公告')} micro="ANNOUNCEMENT"
    class="announcement-modal" width="min(8.8rem, 94vw)" onClose=${closeAnnouncement} utility=${true}
    actions=${html`<${Button} variant="primary" icon="close" data-autofocus onClick=${closeAnnouncement}>${t('关闭')}<//>`}>
    ${open && (!automatic || !inMatch) ? html`<${AnnouncementSections} key=${automatic ? key : 'manual'} notice=${live ? notice : null} />` : null}
  <//>`;
}

export function AnnouncementBanner() {
  const notice = useStore((s) => s.announcement);
  useStore((s) => s.clock.offset);
  const now = net.serverNow();
  useTicker(notice && now < notice.endAt ? 250 : 0);
  const key = announcementDismissKey(notice);
  const [dismissed, setDismissed] = useState(() => loadPref('announcementDismissed', ''));
  useEffect(() => {
    setDismissed(loadPref('announcementDismissed', '') === key ? key : '');
  }, [key]);
  const live = announcementLive(notice, now) && dismissed !== key;
  const viewport = useRef(null);
  const line = useRef(null);
  const [scroll, setScroll] = useState({ from: 0, to: 0, duration: 8 });
  useEffect(() => {
    if (!live) return undefined;
    const measure = () => {
      if (viewport.current && line.current) setScroll(announcementScroll(viewport.current.clientWidth, line.current.scrollWidth));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (viewport.current) observer?.observe(viewport.current);
    if (line.current) observer?.observe(line.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [live, notice]);
  if (!live) return null;
  const label = notice.level === 'urgent' ? t('紧急通知') : notice.level === 'warning' ? t('提醒') : t('通知');
  const dismiss = () => { savePref('announcementDismissed', key); setDismissed(key); };
  return html`<aside class=${`site-notice site-notice--${notice.level}`} role="status" aria-live="polite" aria-atomic="true">
    <span class="site-notice__label">${label}</span>
    <span class="site-notice__accessible">${notice.text}</span>
    <div ref=${viewport} class="site-notice__viewport" aria-hidden="true">
      <span ref=${line} key=${`${notice.id}:${notice.text}`} class="site-notice__text"
        style=${{ '--notice-from': `${scroll.from}px`, '--notice-to': `${scroll.to}px`, '--notice-duration': `${scroll.duration}s` }}>${notice.text}</span>
    </div>
    <button type="button" class="site-notice__close" aria-label=${t('关闭通知')} title=${t('关闭通知')} onClick=${dismiss}><${Icon} name="close" /><//>
  </aside>`;
}
