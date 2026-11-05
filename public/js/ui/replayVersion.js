// Historical views must wait for the recorded official dataset, never decode reused IDs against the lobby's data.
import { useEffect } from '../../vendor/hooks.module.js';
import { useStore, store } from '../store.js';
import { data, useData } from '../data.js';
import { contentSet } from '../content.js';
import { DEFAULT_VERSION, versionOfData } from '../../../shared/versions.js';
import { roomVersion, welcomeVersion } from '../versions.js';
import { t } from '../../../shared/i18n.js';
export function useReplayVersion(record) {
  useData('config');
  const version = record?.version || DEFAULT_VERSION;
  const state = useStore(s => s);
  const content = useStore(s => s, Object.is, contentSet);
  const conflict = !!state.room && roomVersion(state.room) !== version;
  const offered = version === DEFAULT_VERSION || !!welcomeVersion(state, version);
  useEffect(() => {
    if (conflict || !offered || state.room) return;
    const previous = store.get().replayVersion;
    store.set({ replayVersion: version });
    return () => { if (store.get().replayVersion === version) store.set({ replayVersion: previous }); };
  }, [version, conflict, offered, !!state.room]);
  return {
    ready: !conflict && offered && versionOfData({ config: data.get('config') }) === version && content.status !== 'loading',
    error: conflict ? t('请先离开同盟，再查看其他版本的记录。') : !offered ? t('这台服务器没有提供该记录的版本。') : content.status === 'failed' ? t('版本数据加载失败，请稍后重试。') : null,
  };
}
