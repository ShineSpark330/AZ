// "Save a copy to my device" for attached files.
//
// Android: written silently into  Downloads/Oceans Symphony/files/<Type>/
// (Images, Videos, Audio or Files) through the MediaStore plugin — survives an
// uninstall and needs no permission prompt. That plugin passes the whole file
// across the native bridge as base64, so past NATIVE_DIRECT_LIMIT_BYTES we hand
// the file to the system share sheet instead (the person picks where it goes)
// rather than risk running the app out of memory.
// Web: a normal browser download.

import { isNative } from "@/lib/platform";
import { MEDIA_FOLDER_FOR_KIND, safeFileName } from "@/lib/mediaStore";

export const NATIVE_DIRECT_LIMIT_BYTES = 40 * 1024 * 1024;
export const FILES_ROOT_SUBDIR = "Oceans Symphony/files";

export function deviceFolderFor(kind) {
  return `${FILES_ROOT_SUBDIR}/${MEDIA_FOLDER_FOR_KIND[kind] || "Files"}`;
}

// Returns { ok, cancelled?, location?, via?, error? }
//   location — where it landed, e.g. "Downloads/Oceans Symphony/files/Videos"
//   via      — "folder" (silent save) | "share" | "download"
export async function saveBlobToDeviceFolder({ blob, filename, mime, kind }) {
  const name = safeFileName(filename, "file");
  const mimeType = mime || blob.type || "application/octet-stream";

  if (isNative()) {
    if (blob.size <= NATIVE_DIRECT_LIMIT_BYTES) {
      try {
        const { saveBlobToPublicDownloads } = await import("@/lib/nativeMediaStoreSave");
        const res = await saveBlobToPublicDownloads({ blob, filename: name, mimeType, subdir: deviceFolderFor(kind) });
        if (res?.result === "filesystem") return { ok: true, via: "folder", location: res.location };
      } catch { /* fall through to the share sheet */ }
    }
    const { shareFile } = await import("@/lib/shareFile");
    const r = await shareFile({ blob, filename: name, title: name, dialogTitle: "Save file", prefer: "share" });
    if (r?.result === "cancelled") return { ok: false, cancelled: true };
    if (r?.result === "failed") return { ok: false, error: r.error || "save_failed" };
    return { ok: true, via: "share" };
  }

  const { shareFile } = await import("@/lib/shareFile");
  const r = await shareFile({ blob, filename: name, title: name, prefer: "download" });
  if (r?.result === "cancelled") return { ok: false, cancelled: true };
  if (r?.result === "failed") return { ok: false, error: r.error || "save_failed" };
  return { ok: true, via: "download" };
}

// Toast-friendly one-liner for a result.
export function describeSaveResult(res, filename = "File") {
  if (res.cancelled) return null;
  if (!res.ok) return { type: "error", text: `Couldn't save ${filename}${res.error ? ` — ${res.error}` : ""}` };
  if (res.via === "folder") return { type: "success", text: `Saved to ${res.location}` };
  if (res.via === "share") return { type: "success", text: "Choose where to keep it from the share sheet." };
  return { type: "success", text: `${filename} downloaded` };
}
