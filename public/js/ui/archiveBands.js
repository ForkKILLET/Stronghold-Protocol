// Read-only strategy names for records spanning official versions; never install a gameplay content set.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { createDataStore, data } from '../data.js';
import { useStore } from '../store.js';
import { DEFAULT_VERSION, versionById } from '../../../shared/versions.js';
import { dataUrl } from '../../../shared/cdn.js';
import { DATA_CDN } from '../asset-cdn.js';

export function createArchiveBandCatalog({ fetch } = {}) {
  const catalogs = new Map();
  return async (ids, versions) => {
    const found = {};
    for (const id of new Set([DEFAULT_VERSION, ...versions])) {
      const version = versionById(id);
      if (!version || ids.every(key => found[key])) continue;
      if (!catalogs.has(id)) catalogs.set(id, createDataStore({ fetch, base: dataUrl(`/data/${version.dir}`, DATA_CDN) }));
      const source = catalogs.get(id);
      await source.load('bands');
      for (const key of ids) {
        const band = source.lookup('bands', key);
        if (!found[key] && band) found[key] = band;
      }
    }
    return found;
  };
}

const loadBands = createArchiveBandCatalog();

export function useArchiveBands(ids, gd) {
  const offered = useStore(s => s.versions);
  const versions = (offered || []).map(v => v.id).join('|');
  const missing = ids.filter(id => !gd.band(id)).join('|');
  const [extra, setExtra] = useState({});
  useEffect(() => {
    if (!missing) return;
    let active = true;
    loadBands(missing.split('|'), versions ? versions.split('|') : []).then(bands => { if (active) setExtra(bands); });
    return () => { active = false; };
  }, [missing, versions]);
  return id => {
    const current = gd.band(id);
    const band = extra[id];
    return current || (band ? { ...band, name: data.localeName(band.name) } : null);
  };
}
