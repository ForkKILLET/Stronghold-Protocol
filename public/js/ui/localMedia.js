import { t } from '../../../shared/i18n.js';
// Browser-only media storage. Blobs stay in IndexedDB; object URLs never enter preferences or network messages.
export function mediaStorage(database, table, key) {
  return (write = false, value = null) => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error(t('浏览器无法保存文件'))); return; }
    let blocked = false;
    const open = indexedDB.open(database, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(table);
    open.onerror = () => reject(open.error);
    open.onblocked = () => { blocked = true; reject(new Error(t('浏览器存储被占用，请关闭其他游戏页面后重试'))); };
    open.onsuccess = () => {
      const db = open.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction(table, write ? 'readwrite' : 'readonly');
        const store = tx.objectStore(table);
        const request = write ? value == null ? store.delete(key) : store.put(value, key) : store.get(key);
        tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error(t('文件保存失败，请检查浏览器存储空间'))); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

/** Serial writes and a generation guard keep a late restore from replacing a newer selection. */
export function createLocalMedia({ storage, valid, urls = globalThis.URL }) {
  let state = { record: null, url: null, ready: false, busy: false }, generation = 0, loading, writing = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));
  const replace = (record) => {
    const old = state.url;
    const sameBlob = record && record.blob === state.record?.blob && old;
    state = { ...state, record, url: record ? sameBlob || urls.createObjectURL(record.blob) : null };
    notify();
    if (old && old !== state.url) urls.revokeObjectURL(old);
  };
  return {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    load() {
      if (loading) return loading;
      const version = generation;
      loading = (async () => {
        try {
          const record = await storage();
          if (version === generation && valid(record)) replace(record);
        } catch { /* An unavailable store leaves the default appearance/music intact. */ }
        finally { state = { ...state, ready: true }; notify(); }
      })();
      return loading;
    },
    async change(prepare) {
      if (writing) return false;
      writing = true;
      ++generation;
      state = { ...state, busy: true }; notify();
      try {
        const record = await prepare();
        if (record !== null && !valid(record)) throw new Error(t('文件无效'));
        await storage(true, record);
        replace(record);
        return true;
      } finally { writing = false; state = { ...state, busy: false }; notify(); }
    },
  };
}
