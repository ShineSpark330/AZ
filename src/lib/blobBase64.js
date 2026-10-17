// Fast Blob → base64 for the native bridge. The old per-byte
// String.fromCharCode loop ran in JS and made 100 MB+ saves take a minute;
// FileReader.readAsDataURL encodes natively. Done in 3 MB slices (a multiple
// of 3, so slices concatenate losslessly) to keep peak memory small.
const SLICE = 3 * 1024 * 1024;

function sliceToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error || new Error("read_failed"));
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

export async function blobToBase64Fast(blob) {
  if (blob.size <= SLICE) return sliceToBase64(blob);
  const parts = [];
  for (let off = 0; off < blob.size; off += SLICE) {
    parts.push(await sliceToBase64(blob.slice(off, Math.min(off + SLICE, blob.size))));
  }
  return parts.join("");
}
