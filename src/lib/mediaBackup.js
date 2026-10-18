// Backups for ALL the app's files — pictures, audio, videos and attached files —
// in size-limited PARTS, with their real names and real file types.
//
// Each part is a complete, standalone .zip (never one archive spread across
// several), so parts can be restored in any order, one at a time, and restoring
// a part only ADDS or UPDATES what's inside it — it never deletes anything.
// A single file bigger than the limit gets a part to itself (it can't be cut).
//
// Inside a zip the files sit in folders — Pictures/, Audio/, Videos/, Files/ —
// named after their library name (e.g. "Calm Waters.mp3"), with the type taken
// from the file itself. A symphony-manifest.json maps every file back to its id
// so a restore puts it exactly where it was.
//
//   • Everything     → exportAllFilesZipParts   (this module)
//   • Pictures as JSON parts → exportImagesInParts (DataBackupRestore.jsx),
//                      imported with the normal Import button
//   • Restore        → restoreFromZipFiles — pick one or many .zip parts

import { isNative } from "@/lib/platform";
import { base44 } from "@/api/base44Client";
import { listLocalImageIds, getLocalImage, saveLocalImage, dataUrlToBlob, getLocalImageId } from "@/lib/localImageStorage";
import { listMedia, getMedia, saveMedia, playableBlob, extForMime, sniffExt, classifyMedia, nameWithRealExt } from "@/lib/mediaStore";
import { loadBackupSkip, skipKeyForImage, skipKeyForMedia } from "@/lib/backupSkip";

export const MB = 1024 * 1024;
export const PART_SIZE_CHOICES_MB = [25, 50, 100, 250, 500];
export const DEFAULT_PART_SIZE_MB = 100;
// The Android silent-save path hands a whole part across the native bridge as
// base64, so bigger parts go through the share sheet instead.
export const NATIVE_SILENT_PART_LIMIT = 40 * MB;

const MANIFEST_NAME = "symphony-manifest.json";
const MIME_FOR_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif" };

const stamp = () => new Date().toISOString().slice(0, 10);
export const partFileName = (what, index, total, ext) =>
  `oceans-symphony-${what}-part-${index}-of-${total}-${stamp()}.${ext}`;

// Greedy, order-preserving packing. items: [{ key, size }] → [[key, …], …]
export function packIntoParts(items, maxBytes) {
  const parts = [];
  let cur = [];
  let curSize = 0;
  for (const it of items) {
    if (cur.length && curSize + it.size > maxBytes) { parts.push(cur); cur = []; curSize = 0; }
    cur.push(it.key);
    curSize += it.size;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

// Save one finished part. Returns { ok, cancelled?, location?, via?, error? }.
export async function savePart({ blob, filename, mimeType }) {
  if (isNative()) {
    if (blob.size <= NATIVE_SILENT_PART_LIMIT) {
      try {
        const { saveBlobToPublicDownloads } = await import("@/lib/nativeMediaStoreSave");
        const res = await saveBlobToPublicDownloads({ blob, filename, mimeType });
        if (res?.result === "filesystem") return { ok: true, via: "folder", location: res.location };
      } catch { /* fall through to the share sheet */ }
    }
    const { shareFile } = await import("@/lib/shareFile");
    const r = await shareFile({ blob, filename, title: filename, dialogTitle: "Save backup part", prefer: "share" });
    if (r?.result === "cancelled") return { ok: false, cancelled: true };
    if (r?.result === "failed") return { ok: false, error: r.error || "save_failed" };
    return { ok: true, via: "share" };
  }
  const { shareFile } = await import("@/lib/shareFile");
  const r = await shareFile({ blob, filename, title: filename, prefer: "download" });
  if (r?.result === "cancelled") return { ok: false, cancelled: true };
  if (r?.result === "failed") return { ok: false, error: r.error || "save_failed" };
  return { ok: true, via: "download" };
}

// Stream a zip together (stored, not re-compressed — pictures and videos are
// already compressed) so the whole part is never held twice in memory.
// entries: [{ name, bytes: Uint8Array | () => Promise<Uint8Array> }]
async function buildZipBlob(entries) {
  const fflate = await import("fflate");
  const chunks = [];
  let failure = null;
  const zip = new fflate.Zip((err, chunk) => { if (err) failure = err; else if (chunk) chunks.push(chunk); });
  for (const e of entries) {
    const bytes = typeof e.bytes === "function" ? await e.bytes() : e.bytes;
    const f = new fflate.ZipPassThrough(e.name);
    zip.add(f);
    f.push(bytes, true);
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks, { type: "application/zip" });
}

async function blobBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }

async function imageAsBlob(id) {
  const v = await getLocalImage(id);
  if (v instanceof Blob) return v;
  if (typeof v === "string") return dataUrlToBlob(v);
  return null;
}

// Common driver: pack → build → save each part. `describe` produces the zip
// entries for one group of keys.
async function exportZipParts({ what, items, maxBytes, describe, onProgress }) {
  if (!items.length) return { parts: 0, items: 0 };
  const groups = packIntoParts(items, maxBytes);
  let location = null;
  let via = null;
  for (let i = 0; i < groups.length; i++) {
    onProgress?.({ part: i + 1, total: groups.length });
    const entries = await describe(groups[i]);
    const blob = await buildZipBlob(entries);
    const res = await savePart({ blob, filename: partFileName(what, i + 1, groups.length, "zip"), mimeType: "application/zip" });
    if (res.cancelled) return { parts: i, total: groups.length, items: items.length, cancelled: true };
    if (!res.ok) throw new Error(res.error || "Couldn't save a backup part");
    location = res.location || location;
    via = res.via || via;
  }
  return { parts: groups.length, total: groups.length, items: items.length, location, via };
}

// "image" | "audio" | "video" | "file" for something in the picture store
// (which also holds audio and the odd attachment). Uses the stored type, and
// only peeks at the first bytes when the type is missing.
async function kindOfImageBlob(b) {
  const mime = b.type || "";
  if (mime) return classifyMedia(mime, "");
  const head = new Uint8Array(await b.slice(0, 16).arrayBuffer());
  const ext = sniffExt(head);
  return classifyMedia(ext ? `x/${ext}` : "", ext ? `x.${ext}` : "");
}

export const FILE_KINDS = ["image", "audio", "video", "file"];
export const FILE_KIND_LABELS = { image: "Pictures", audio: "Audio", video: "Videos", file: "Attachments & other files" };

// How many files / bytes of each type this device holds, and how many of them
// are marked "skip in backups". { image: { count, bytes, skipped }, … }
export async function computeFileKindStats() {
  const skip = await loadBackupSkip();
  const out = Object.fromEntries(FILE_KINDS.map((k) => [k, { count: 0, bytes: 0, skipped: 0 }]));
  try {
    for (const id of await listLocalImageIds()) {
      const b = await imageAsBlob(id);
      if (!b) continue;
      const kind = await kindOfImageBlob(b);
      out[kind].count += 1;
      out[kind].bytes += b.size;
      if (skip.has(skipKeyForImage(id))) out[kind].skipped += 1;
    }
  } catch { /* the picture store couldn't be read — show what we have */ }
  try {
    for (const m of await listMedia()) {
      const kind = FILE_KINDS.includes(m.kind) ? m.kind : "file";
      out[kind].count += 1;
      out[kind].bytes += m.size || 0;
      if (skip.has(skipKeyForMedia(m.id))) out[kind].skipped += 1;
    }
  } catch { /* the files store couldn't be read */ }
  return out;
}

// ── Everything → .zip parts ──────────────────────────────────────────────────

const FOLDER_FOR_KIND = { image: "Pictures", audio: "Audio", video: "Videos", file: "Files" };
const zipFileName = nameWithRealExt;

// id → the name a person gave it in the Assets library (e.g. a song's title).
async function libraryNames() {
  const map = new Map();
  try {
    const assets = await base44.entities.ImageAsset.list();
    for (const a of assets || []) {
      const id = a.image_url ? getLocalImageId(a.image_url) : null;
      if (id && a.name && a.name !== "Image") map.set(id, a.name);
    }
  } catch { /* names are a nicety; ids are used if the library can't be read */ }
  return map;
}

// pictures: the image store (pictures AND audio kept there)
// media:    the attached files / videos store
// kinds: optional list of types to include — any of "image" | "audio" | "video"
// | "file" (default: all). Files marked "skip in backups" in the Assets
// library are left out unless includeSkipped is true.
export async function exportAllFilesZipParts({ maxBytes = DEFAULT_PART_SIZE_MB * MB, onProgress, pictures = true, media = true, extraEntries = null, what = null, kinds = null, includeSkipped = false } = {}) {
  const wanted = kinds && kinds.length ? new Set(kinds) : null;
  const skip = includeSkipped ? new Set() : await loadBackupSkip();
  const names = pictures ? await libraryNames() : new Map();
  const items = [];
  if (pictures) {
    for (const id of await listLocalImageIds()) {
      if (skip.has(skipKeyForImage(id))) continue;
      const b = await imageAsBlob(id);
      if (!b) continue;
      if (wanted && !wanted.has(await kindOfImageBlob(b))) continue;
      items.push({ key: `i:${id}`, size: b.size });
    }
  }
  const mediaById = new Map();
  if (media) {
    for (const m of await listMedia()) {
      if (skip.has(skipKeyForMedia(m.id))) continue;
      if (wanted && !wanted.has(FILE_KINDS.includes(m.kind) ? m.kind : "file")) continue;
      mediaById.set(m.id, m);
      items.push({ key: `m:${m.id}`, size: m.size || 0 });
    }
  }

  return exportZipParts({
    what: what || (pictures && media ? "files" : "videos-and-attachments"),
    items,
    maxBytes,
    onProgress,
    describe: async (group) => {
      const manifest = { kind: "symphony-files-part", version: 2, images: [], files: [] };
      const entries = [];
      const used = new Set();
      const uniquePath = (folder, fileName, id) => {
        let path = `${folder}/${fileName}`;
        if (used.has(path.toLowerCase())) {
          const dot = fileName.lastIndexOf(".");
          const tag = String(id).slice(-6);
          path = `${folder}/${dot === -1 ? fileName : fileName.slice(0, dot)} (${tag})${dot === -1 ? "" : fileName.slice(dot)}`;
        }
        used.add(path.toLowerCase());
        return path;
      };

      for (const key of group) {
        const id = key.slice(2);
        if (key.startsWith("i:")) {
          const b = await imageAsBlob(id);
          if (!b) continue;
          const head = new Uint8Array(await b.slice(0, 16).arrayBuffer());
          const mime = b.type || "";
          const kind = classifyMedia(mime || (sniffExt(head) ? `x/${sniffExt(head)}` : ""), `x.${sniffExt(head) || extForMime(mime)}`);
          const path = uniquePath(FOLDER_FOR_KIND[kind] || "Files", zipFileName({ name: names.get(id) || id, id, mime, head }), id);
          manifest.images.push({ id, file: path, mime: mime || "application/octet-stream" });
          entries.push({ name: path, bytes: () => blobBytes(b) });
        } else {
          const meta = mediaById.get(id);
          if (!meta) continue;
          const rec = await getMedia(id);
          const blob = playableBlob(rec);
          if (!blob) continue;
          const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
          const path = uniquePath(FOLDER_FOR_KIND[meta.kind] || "Files", zipFileName({ name: meta.name, id, mime: meta.mime, head }), id);
          manifest.files.push({ id, name: meta.name, mime: meta.mime, size: meta.size, createdAt: meta.createdAt, path });
          entries.push({ name: path, bytes: () => blobBytes(blob) });
        }
      }
      const fflate = await import("fflate");
      const extra = extraEntries ? await extraEntries() : [];
      return [{ name: MANIFEST_NAME, bytes: fflate.strToU8(JSON.stringify(manifest, null, 1)) }, ...extra, ...entries];
    },
  });
}

// ── Restore ──────────────────────────────────────────────────────────────────

// Restore one or more .zip parts. ADDS / UPDATES only — nothing is deleted.
// Understands: these parts (manifest), the older single "Images as .zip" export
// (plain <id>.<ext> files, no manifest).
export async function restoreFromZipFiles(files, onProgress) {
  const fflate = await import("fflate");
  const totals = { images: 0, files: 0, skipped: 0, failed: 0, zips: 0 };
  const list = Array.from(files || []);
  for (let n = 0; n < list.length; n++) {
    const f = list[n];
    onProgress?.({ index: n + 1, total: list.length, name: f.name });
    let unzipped;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      unzipped = await new Promise((resolve, reject) => fflate.unzip(bytes, (err, d) => (err ? reject(err) : resolve(d))));
    } catch {
      totals.failed += 1;
      continue;
    }
    totals.zips += 1;

    let manifest = null;
    const mEntry = unzipped[MANIFEST_NAME] || unzipped[Object.keys(unzipped).find((k) => k.endsWith(`/${MANIFEST_NAME}`)) || ""];
    if (mEntry) { try { manifest = JSON.parse(fflate.strFromU8(mEntry)); } catch { manifest = null; } }

    const handled = new Set();
    if (manifest?.files?.length) {
      for (const m of manifest.files) {
        const data = unzipped[m.path];
        handled.add(m.path);
        if (!data) { totals.failed += 1; continue; }
        try {
          await saveMedia(new Blob([data], { type: m.mime || "application/octet-stream" }), { id: m.id, name: m.name, mime: m.mime, createdAt: m.createdAt });
          totals.files += 1;
        } catch { totals.failed += 1; }
      }
    }
    if (manifest?.images?.length) {
      for (const m of manifest.images) {
        const data = unzipped[m.file];
        handled.add(m.file);
        if (!data) { totals.failed += 1; continue; }
        try {
          await saveLocalImage(m.id, new Blob([data], { type: m.mime }), m.mime);
          totals.images += 1;
        } catch { totals.failed += 1; }
      }
    }

    // No manifest (the older "Images as .zip"): plain <id>.<ext> picture files.
    if (!manifest) {
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.endsWith("/") || handled.has(path)) continue;
        const base = path.split("/").pop();
        const dot = base.lastIndexOf(".");
        const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
        const mime = MIME_FOR_EXT[ext];
        if (!mime) { totals.skipped += 1; continue; }
        const id = dot === -1 ? base : base.slice(0, dot);
        try {
          await saveLocalImage(id, new Blob([data], { type: mime }), mime);
          totals.images += 1;
        } catch { totals.failed += 1; }
      }
    }
  }
  return totals;
}

// ── Everything → ONE .zip (data + every file, never split) ───────────────────
export const DATA_ENTRY_NAME = "symphony-data.json";

// The data (records, settings, fonts — NOT pictures) goes in as symphony-data.json,
// every picture / audio / video / attachment goes in as a real file. Pictures are
// never base64'd into the JSON, so memory stays low. Locked with the backup
// password when one is set, exactly like an automatic backup.
export async function exportEverythingZip({ onProgress } = {}) {
  const { buildFullBackupPayload, resolveBackupPassword } = await import("@/lib/autoBackup");
  // Fail closed: a locked-backup setup with a missing password must not write plain data.
  const { password: pw, error: pwError } = resolveBackupPassword();
  if (pwError) throw new Error(pwError);
  const dataEntry = async () => {
    const fflate = await import("fflate");
    let payload = await buildFullBackupPayload({ skipMedia: true });
    if (pw) {
      const { encryptStandardBackup } = await import("@/lib/backupFormat");
      payload = await encryptStandardBackup(payload, pw);
    }
    return [{ name: DATA_ENTRY_NAME, bytes: fflate.strToU8(JSON.stringify(payload)) }];
  };
  const r = await exportAllFilesZipParts({ maxBytes: Infinity, onProgress, extraEntries: dataEntry, what: "everything" });
  if (r.items) return r;
  // No files stored at all → a zip holding just the data.
  const entries = await dataEntry();
  const blob = await buildZipBlob(entries);
  const res = await savePart({ blob, filename: partFileName("everything", 1, 1, "zip"), mimeType: "application/zip" });
  if (res.cancelled) return { parts: 0, total: 1, items: 1, cancelled: true };
  if (!res.ok) throw new Error(res.error || "Couldn't save the backup");
  return { parts: 1, total: 1, items: 1, location: res.location, via: res.via };
}
