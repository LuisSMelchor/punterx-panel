let _blobsPromise;
export function getBlobs() {
  if (!_blobsPromise) _blobsPromise = import('@netlify/blobs');
  return _blobsPromise;
}
export default { getBlobs };
