// One cancellable maintenance task, after actual inactivity. Navigation/combat
// eligibility is supplied by the controller; browser idle callbacks alone do not
// make Cache Storage I/O cheap or interruptible.
export function idleResourceCheck({ allowed, run, interrupt, win = globalThis.window, doc = globalThis.document, delay = 15000 }) {
  if (!win?.setTimeout) return () => {};
  let timer = null, stopped = false, running = false;
  const events = ['pointerdown', 'keydown', 'input', 'wheel', 'visibilitychange'];
  const cancel = () => {
    stopped = true;
    if (timer !== null) win.clearTimeout(timer);
    for (const event of events) doc?.removeEventListener?.(event, activity, true);
    interrupt();
  };
  const queue = () => {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
    if (stopped || running || doc?.visibilityState === 'hidden' || !allowed()) return;
    timer = win.setTimeout(async () => {
      timer = null;
      if (stopped || doc?.visibilityState === 'hidden' || !allowed()) return;
      running = true;
      try { if (await run()) { cancel(); return; } }
      finally { running = false; if (!stopped) queue(); }
    }, delay);
  };
  const activity = () => { interrupt(); queue(); };
  for (const event of events) doc?.addEventListener?.(event, activity, true);
  queue();
  return cancel;
}
