let _blobsPromise;

export function getBlobs() {
  if (!_blobsPromise) _blobsPromise = import('@netlify/blobs');
  return _blobsPromise;
}

// Helpers mínimos
export function parseNdjsonToArray(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  return lines.map(l => { try { return JSON.parse(l); } catch { return l; } });
}

export async function loadNdjson() {
  // placeholder: reemplázalo por lectura real de blobs si aplica
  return '';
}

export function diagWindow(info = {}) {
  return { ok: true, ...info };
}

const _default = { getBlobs, parseNdjsonToArray, loadNdjson, diagWindow };
export default _default;
