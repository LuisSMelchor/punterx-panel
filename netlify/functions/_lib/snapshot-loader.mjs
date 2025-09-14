let _blobsPromise;

export function getBlobs() {
  if (!_blobsPromise) _blobsPromise = import('@netlify/blobs');
  return _blobsPromise;
}

// Carga NDJSON desde URL o desde Netlify Blobs.
// source: string (http(s):// | store:STORE/KEY | blob:STORE/KEY) o {url, store, key, blobKey}
export async function loadNdjson(source) {
  if (!source) return '';

  // string simple
  if (typeof source === 'string') {
    // URL http(s)
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`fetch ${source} -> ${res.status}`);
      return await res.text();
    }

    // store:/blob:  => store y key
    if (/^(store:|blob:)/i.test(source)) {
      const spec = source.replace(/^(store:|blob:)/i, '');
      const [storeName, ...rest] = spec.split(/[/:]/);
      const key = rest.join('/');
      if (!storeName || !key) return '';
      const { getStore } = await getBlobs();
      const store = getStore({ name: storeName });
      return (await store.get(key, { type: 'text' })) ?? '';
    }

    // "STORE/KEY" directo
    if (/^[^/]+\/.+/.test(source)) {
      const [storeName, ...rest] = source.split('/');
      const key = rest.join('/');
      const { getStore } = await getBlobs();
      const store = getStore({ name: storeName });
      return (await store.get(key, { type: 'text' })) ?? '';
    }
  }

  // objeto detallado
  const { url, store, key, blobKey } = (typeof source === 'object' && source) || {};
  if (url) return await loadNdjson(String(url));
  if (blobKey) return await loadNdjson(String(blobKey));
  if (store && key) {
    const { getStore } = await getBlobs();
    const s = getStore({ name: String(store) });
    return (await s.get(String(key), { type: 'text' })) ?? '';
  }

  return '';
}

// Parser NDJSON robusto
export function parseNdjsonToArray(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  return lines.map(l => { try { return JSON.parse(l); } catch { return l; } });
}

// Diagnóstico simple
export function diagWindow(info = {}) {
  return { ok: true, ...info };
}

// Conveniencia para window-log:
// usa EV_MKT_URL/EV_BETS_URL o EV_MKT_BLOB_KEY/EV_BETS_BLOB_KEY.
// blobKey acepta "STORE/KEY" o "store:STORE/KEY".
export async function loadWindowNdjson(kind = 'mkt') {
  const env = process.env || {};
  const url = kind === 'bets' ? env.EV_BETS_URL : env.EV_MKT_URL;
  const blobKey = kind === 'bets' ? env.EV_BETS_BLOB_KEY : env.EV_MKT_BLOB_KEY;

  if (url) return await loadNdjson(url);
  if (blobKey) {
    const spec = /^store:|^blob:/i.test(blobKey) ? blobKey : `store:${blobKey}`;
    return await loadNdjson(spec);
  }
  return '';
}

const _default = { getBlobs, loadNdjson, loadWindowNdjson, parseNdjsonToArray, diagWindow };
export default _default;
