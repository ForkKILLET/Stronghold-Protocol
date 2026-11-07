// Injected only by `npm run dev`. CSS swaps preserve the current UI and battle renderer.
const events = new EventSource('/__dev/events');
let instance, revision, styles = Promise.resolve();

function updateStyles(paths) {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => new URL(link.href).origin === location.origin);
  const matching = links.filter(link => paths.includes(new URL(link.href).pathname));
  return Promise.all((matching.length ? matching : links).map(link => new Promise(resolve => {
    const next = link.cloneNode();
    const url = new URL(link.href);
    url.searchParams.set('__sp_dev', String(Date.now()));
    next.href = url.href;
    next.onload = () => { link.remove(); resolve(); };
    next.onerror = () => { next.remove(); console.warn('[dev] CSS update failed:', url.pathname); resolve(); };
    link.after(next);
  })));
}

events.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'hello') {
    // Reconnect after a backend restart or missed changes: native ESM needs a fresh page module graph.
    if (instance && (message.instance !== instance || message.revision !== revision)) location.reload();
    instance = message.instance; revision = message.revision;
    return;
  }
  revision = message.revision;
  if (message.type === 'css') styles = styles.then(() => updateStyles(message.paths));
  else if (message.type === 'reload') location.reload();
};
window.addEventListener('pagehide', () => events.close(), { once: true });
