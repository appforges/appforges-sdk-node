/** Encode bytes for the public JSON UploadAsset.data field (not multipart).
 * The public API recommends files smaller than 4 MiB. Pre-signed upload is
 * not currently a public endpoint; this helper performs no network request.
 */
export function encodeUploadData(data: Uint8Array): string {
  if (!(data instanceof Uint8Array)) throw new TypeError("upload data must be Uint8Array");
  if (data.byteLength >= 4 * 1024 * 1024)
    throw new RangeError("small-file upload requires fewer than 4 MiB");
  let raw = "";
  for (let i = 0; i < data.length; i += 8192)
    raw += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(raw);
}
