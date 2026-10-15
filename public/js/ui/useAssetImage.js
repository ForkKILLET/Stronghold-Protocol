import { useEffect, useState } from '../../vendor/hooks.module.js';
import { artTransport, subscribeArtRecovery } from '../resourceNetwork.js';

/** Keep the existing glyph fallback while a failed DOM image recovers. No updates after unmount/source change. */
export function useAssetImage(source) {
  const [failed, setFailed] = useState(null);
  const [recovered, setRecovered] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!source || failed !== source || recovered?.source === source) return undefined;
    return subscribeArtRecovery(() => setRevision((n) => n + 1));
  }, [source, failed, recovered]);
  useEffect(() => {
    if (!source || failed !== source) return undefined;
    let disposed = false;
    let temporary;
    artTransport.blob(source).then((blob) => {
      if (disposed) return;
      temporary = URL.createObjectURL(blob);
      setRecovered({ source, url: temporary });
    }, () => {}); // Keep the fallback. A later online/visible event can try again.
    return () => {
      disposed = true;
      if (temporary) URL.revokeObjectURL(temporary);
    };
  }, [source, failed, revision]);
  return {
    src: recovered?.source === source ? recovered.url : failed === source ? null : source,
    onError: () => { setRecovered(null); setFailed(source); },
  };
}
