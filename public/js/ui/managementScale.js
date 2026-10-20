// Non-battle design units. The battlefield continues to use theme.css's layout rem.
// Keep the layout scale stable while a keyboard pans/shrinks the visual viewport;
// the visible height and offsets independently constrain scrolling surfaces.
export function managementScale({ width, height, rem = 100, top = 0, right = 0, bottom = 0, left = 0 }) {
  const unit = Math.min(rem, Math.max(1, width - left - right) / 19.2, Math.max(1, height - top - bottom) / 10.8);
  return { unit, factor: unit / rem };
}

/** Convert a trusted component's design width, including min()/calc() expressions. */
export function managementLength(value) {
  return value.replace(/(-?\d*\.?\d+)rem\b/g, 'calc($1 * var(--ui-unit, 1rem))');
}

export function updateManagementViewport(win) {
  const root = win.document?.documentElement;
  if (!root?.style) return;
  const viewport = win.visualViewport;
  const style = win.getComputedStyle?.(root);
  const number = (name) => parseFloat(style?.getPropertyValue(name)) || 0;
  const width = win.innerWidth || viewport?.width || 1920;
  const height = win.innerHeight || viewport?.height || 1080;
  const rem = parseFloat(style?.fontSize) || Math.max(40, Math.min(width / 19.2, height / 10.8, 240));
  const { unit, factor } = managementScale({ width, height, rem,
    top: number('--sa-t'), right: number('--sa-r'), bottom: number('--sa-b'), left: number('--sa-l') });
  root.style.setProperty('--sp-ui-unit', `${unit}px`);
  root.style.setProperty('--sp-ui-scale', String(factor));
  root.style.setProperty('--sp-vtop', `${viewport?.offsetTop || 0}px`);
  root.style.setProperty('--sp-vleft', `${viewport?.offsetLeft || 0}px`);
}
