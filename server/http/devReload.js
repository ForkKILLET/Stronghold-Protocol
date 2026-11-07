// Opt-in source development only: keep native ESM/import maps and the ordinary HTTP/WS origin.
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createDevReload({ publicDir, sharedDir, simDir, log = console }) {
  const instance = randomUUID(), clients = new Set(), watchers = [], pending = new Set();
  let revision = 0, timer, closed = false;
  const send = (res, payload) => {
    if (!res.write(`data: ${JSON.stringify(payload)}\n\n`)) res.destroy();
  };
  const changed = (file) => {
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = [...pending]; pending.clear();
      const event = { type: paths.every(p => p.endsWith('.css')) ? 'css' : 'reload', paths, revision: ++revision };
      for (const res of clients) send(res, event);
    }, 150);
    timer.unref();
  };
  // Do not recursively watch public/: assets, vendor and build outputs can contain enormous trees.
  const roots = [
    [publicDir, '/', false], [path.join(publicDir, 'css'), '/css/', true],
    [path.join(publicDir, 'js'), '/js/', true], [path.join(publicDir, 'i18n'), '/i18n/', true],
    [sharedDir, '/shared/', true], [simDir, '/sim/', true],
  ];
  for (const [dir, prefix, recursive] of roots) {
    try {
      const watcher = watch(dir, { recursive, persistent: false }, (_kind, filename) => {
        if (closed) return;
        const name = filename?.toString().replaceAll('\\', '/');
        if (!name) { changed('*'); return; }
        if (prefix === '/' ? name !== 'index.html' : !/\.(css|m?js|json|html)$/.test(name)) return;
        changed(prefix + name);
      });
      watcher.on('error', err => log.warn?.('[dev] file watcher failed', err));
      watchers.push(watcher);
    } catch (err) {
      if (err.code !== 'ENOENT') { for (const w of watchers) w.close(); throw err; }
    }
  }
  const heartbeat = setInterval(() => {
    for (const res of clients) if (!res.write(': keepalive\n\n')) res.destroy();
  }, 15000);
  heartbeat.unref();
  return {
    async handle(req, res, rawPath) {
      if (rawPath === '/__dev/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        if (req.method === 'HEAD') { res.end(); return true; }
        res.write('retry: 1000\n\n');
        clients.add(res);
        res.on('close', () => clients.delete(res));
        send(res, { type: 'hello', instance, revision });
        return true;
      }
      if (rawPath !== '/' && rawPath !== '/index.html') return false;
      const source = await readFile(path.join(publicDir, 'index.html'), 'utf8');
      const body = Buffer.from(source.replace('</head>', '<script type="module" src="/js/devReload.js"></script>\n</head>'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    },
    close() {
      closed = true;
      clearTimeout(timer); clearInterval(heartbeat);
      for (const watcher of watchers) watcher.close();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
