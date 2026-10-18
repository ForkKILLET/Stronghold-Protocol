const $ = (id) => document.getElementById(id);
const sizes = (n) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
let catalogue, voice = 'cn';
const recommended = () => {
  if (!catalogue) return;
  const ids = ['core', 'common', `voice-${voice}`];
  $('recommended-size').textContent = sizes(catalogue.packages.filter(p => ids.includes(p.id)).reduce((sum, p) => sum + p.size, 0));
  for (const card of document.querySelectorAll('.dl-card')) card.classList.toggle('is-recommended', ids.includes(card.dataset.id));
};
for (const button of document.querySelectorAll('[data-voice]')) button.addEventListener('click', () => {
  voice = button.dataset.voice;
  for (const b of document.querySelectorAll('[data-voice]')) { b.classList.toggle('is-on', b === button); b.setAttribute('aria-pressed', String(b === button)); }
  recommended();
});

function safeUrl(raw, primary = false) {
  const url = new URL(raw, location.href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('无效下载地址');
  if (primary && (url.origin !== location.origin || !/^\/downloads\/files\/[a-z0-9-]+\.zip$/.test(url.pathname))) throw Error('无效资源包地址');
  return url.href;
}

function draw(document) {
  if (document.format !== 'stronghold-resource-downloads' || document.version !== 1 || !Array.isArray(document.packages) || !document.packages.length) throw Error('资源目录尚未准备好');
  $('packages').replaceChildren();
  for (const pack of document.packages) {
    if (!/^[a-z0-9-]+$/.test(pack.id) || !/^[a-f0-9]{64}$/.test(pack.sha256) || !Number.isSafeInteger(pack.size) || pack.size <= 0) throw Error('资源目录数据异常');
    const fragment = $('package-template').content.cloneNode(true), card = fragment.querySelector('article');
    card.dataset.id = pack.id;
    card.querySelector('.dl-kicker').textContent = pack.micro;
    card.querySelector('.dl-badge').textContent = pack.badge;
    card.querySelector('h3').textContent = pack.title;
    card.querySelector('.dl-description').textContent = pack.description;
    card.querySelector('.dl-metrics b').textContent = sizes(pack.size);
    card.querySelector('.dl-metrics span').textContent = `${pack.count.toLocaleString()} 个文件`;
    const primary = card.querySelector('.dl-button'); primary.href = safeUrl(pack.url, true);
    for (const [index, mirror] of (pack.mirrors || []).entries()) {
      const link = globalThis.document.createElement('a'); link.className = 'dl-mirror'; link.href = safeUrl(mirror);
      link.textContent = index === 0 ? '备用下载 ↗' : `备用 ${index + 1} ↗`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.querySelector('.dl-actions').append(link);
    }
    card.querySelector('code').textContent = pack.sha256;
    card.querySelector('.dl-copy').addEventListener('click', async event => {
      const button = event.currentTarget;
      try { await navigator.clipboard.writeText(pack.sha256); button.textContent = '已复制'; }
      catch { button.textContent = '请选中上方校验值复制'; }
    });
    $('packages').append(fragment);
  }
  $('version').textContent = document.resourceVersion;
  const date = new Date(document.generatedAt);
  $('updated').textContent = `${document.count.toLocaleString()} 个资源 · ${Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('zh-CN')} 更新`;
  $('notice').hidden = true;
  catalogue = document; recommended();
}

async function load() {
  $('notice').hidden = false; $('notice').textContent = '正在读取资源目录…';
  try {
    const response = await fetch('./downloads.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    draw(await response.json());
  } catch {
    $('notice').textContent = '资源目录暂时无法读取，请稍后重试。';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新读取'; retry.addEventListener('click', load);
    $('notice').append(retry); $('version').textContent = '暂不可用';
  }
}
void load();
