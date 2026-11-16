import { useLayoutEffect } from '../../vendor/hooks.module.js';
import { combatMetricsLayout } from './combatMetricsLayout.js';

/** Shared modeless tool placement, including the existing archived combat meter's header exclusion. */
export function useCornerPanel(panelRef, closeRef, onClose, historical = false, minimumHeight = 128) {
  useLayoutEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = e => {
      if (e.key !== 'Escape' || document.querySelector('.modal, .guide')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus?.(); };
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const corner = panel?.parentElement;
    const viewport = window.visualViewport;
    const archiveHeader = historical ? panel?.closest('.st--replay')?.querySelector('.app-header') : null;
    const measure = () => {
      if (!panel || !corner) return;
      const rect = corner.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const layout = combatMetricsLayout({
        cornerTop: rect.top, cornerBottom: rect.bottom,
        viewportHeight: viewport?.height || window.innerHeight,
        viewportTop: viewport?.offsetTop || 0,
        rem: parseFloat(rootStyle.fontSize) || 40,
        safeTop: Math.max(parseFloat(rootStyle.getPropertyValue('--sa-t')) || 0,
          archiveHeader ? archiveHeader.getBoundingClientRect().bottom - (viewport?.offsetTop || 0) : 0),
        safeBottom: parseFloat(rootStyle.getPropertyValue('--sa-b')) || 0,
      });
      if (layout.availableHeight < Math.min(minimumHeight, layout.viewportSpace)) layout.viewportDocked = true;
      panel.style.setProperty('--combat-corner-height', `${rect.height || 44}px`);
      panel.style.setProperty('--combat-available-height', `${layout.availableHeight}px`);
      panel.style.setProperty('--combat-viewport-height', `${layout.viewportSpace}px`);
      panel.style.setProperty('--combat-viewport-top', `${layout.viewportPanelTop}px`);
      panel.dataset.viewportDocked = String(layout.viewportDocked);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (corner) observer?.observe(corner);
    if (archiveHeader) observer?.observe(archiveHeader);
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, []);
}
