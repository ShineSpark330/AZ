// Media file store — videos, audio and any other file attached in chat, kept at
// ORIGINAL quality (no compression, no re-encoding).
//
// Why a separate store from localImageStorage.js: that store is bundled into the
// JSON backup as base64 data URIs (+33% size, and the whole string in memory).
// That is fine for avatars, but one 300 MB video would blow the backup up. Media
// lives here instead and is backed up separately, in size-limited .zip parts
// (see mediaBackup.js).
//
// Records are { blob, name, mime, size, kind, createdAt } keyed by an id like
// "media-1760000000000-ab12cd". Messages reference a file by that id only.

const DB_NAME = "symphony_media";
const STORE_NAME = "files";

let _db = null;

function getIdb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(new Error("Couldn't open the media store"));
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Android can close the connection while the app sits in the background —
      // forget it so the next call reopens instead of failing on a dead handle.
      db.onclose = () => { if (_db === db) _db = null; };
      db.onversionchange = () => { try { db.close(); } catch { /* already closed */ } if (_db === db) _db = null; };
      _db = db;
      resolve(db);
    };
  });
}

function tx(mode, fn) {
  return getIdb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction([STORE_NAME], mode);
    const store = t.objectStore(STORE_NAME);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result?.result !== undefined ? result.result : undefined);
    t.onabort = () => reject(t.error || new Error("Media store write aborted (storage full?)"));
    t.onerror = () => reject(t.error || new Error("Media store error"));
  }));
}

// ── helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "3gp", "avi", "ogv"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"];
const MIME_BY_EXT = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", "3gp": "video/3gpp", avi: "video/x-msvideo", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  pdf: "application/pdf", txt: "text/plain", zip: "application/zip", json: "application/json",
};

export function extOf(name = "") {
  const i = String(name).lastIndexOf(".");
  return i === -1 ? "" : String(name).slice(i + 1).toLowerCase();
}

// "image" | "video" | "audio" | "file". Android file pickers often report an
// empty mime type for videos, so fall back to the extension.
export function classifyMedia(mime = "", name = "") {
  const m = String(mime || "").toLowerCase();
  const ext = extOf(name);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
  if (m.startsWith("audio/") || AUDIO_EXT.includes(ext)) return "audio";
  return "file";
}

// File extension for a mime type (no dot), or "" when unknown.
const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg", "image/avif": "avif", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg",
  "audio/opus": "opus", "audio/flac": "flac", "audio/x-flac": "flac", "audio/webm": "weba",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  "video/3gpp": "3gp", "video/x-msvideo": "avi", "video/ogg": "ogv",
  "application/pdf": "pdf", "application/zip": "zip", "application/json": "json", "text/plain": "txt",
};
export function extForMime(mime) {
  return EXT_BY_MIME[String(mime || "").toLowerCase().split(";")[0].trim()] || "";
}

// Work out a file's type from its first bytes — for files that were stored with
// no (or a useless) mime type, which is why audio used to export as ".img".
// Returns an extension without the dot, or "" when it can't tell.
export function sniffExt(bytes) {
  if (!bytes || bytes.length < 4) return "";
  const b = bytes;
  const str = (i, n) => { let o = ""; for (let k = i; k < i + n && k < b.length; k++) o += String.fromCharCode(b[k]); return o; };
  if (b[0] === 0x89 && str(1, 3) === "PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (str(0, 4) === "GIF8") return "gif";
  if (str(0, 4) === "RIFF") { const t = str(8, 4); return t === "WEBP" ? "webp" : t === "WAVE" ? "wav" : t === "AVI " ? "avi" : ""; }
  if (str(0, 4) === "OggS") return "ogg";
  if (str(0, 4) === "fLaC") return "flac";
  if (str(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (str(4, 4) === "ftyp") {
    const brand = str(8, 4);
    if (brand === "M4A " || brand === "M4B ") return "m4a";
    if (brand === "qt  ") return "mov";
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^hei|^mif1|^msf1/.test(brand)) return "heic";
    if (brand.startsWith("3gp")) return "3gp";
    return "mp4";
  }
  if (str(0, 4) === "%PDF") return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) return "zip";
  const head = str(0, 5).toLowerCase();
  if (head === "<svg " || head === "<?xml") return "svg";
  return "";
}

// Extensions we trust as already being a real file type on a name.
const KNOWN_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "heif", "bmp", "mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba", "mp4", "mov", "webm", "mkv", "3gp", "avi", "ogv", "pdf", "zip", "json", "txt"]);

// "Calm Waters" + audio/mpeg -> "Calm Waters.mp3". The name keeps its own
// extension when it has a real one; otherwise the type comes from the stored
// mime type, then from what the file's first bytes say it is — never ".img".
export function nameWithRealExt({ name, id, mime, head }) {
  const base = safeFileName(name, id).replace(/\.[A-Za-z0-9]{1,5}$/, (m) => (KNOWN_EXT.has(m.slice(1).toLowerCase()) ? "" : m));
  const own = extOf(name);
  const ext = (own && KNOWN_EXT.has(own)) ? own : (extForMime(mime) || sniffExt(head) || "bin");
  return `${base}.${ext}`;
}

export function guessMime(mime, name) {
  if (mime) return mime;
  return MIME_BY_EXT[extOf(name)] || "application/octet-stream";
}

// Folder name under Downloads/Oceans Symphony/files/ for each kind.
export const MEDIA_FOLDER_FOR_KIND = { image: "Images", video: "Videos", audio: "Audio", file: "Others" };

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10 * 1024 ? 1 : 0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function newMediaId() {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function safeFileName(name, fallback = "file") {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned || fallback;
}

// ── store API ────────────────────────────────────────────────────────────────

let _persistAsked = false;
function askPersistOnce() {
  if (_persistAsked) return;
  _persistAsked = true;
  try { navigator.storage?.persist?.(); } catch { /* best-effort: asks the browser not to evict big files */ }
}

// Save a File/Blob exactly as given. `meta` lets a restore keep the original
// name / created time / id.
export async function saveMedia(file, { id = newMediaId(), name, mime, createdAt } = {}) {
  askPersistOnce();
  const fileName = safeFileName(name || file.name, id);
  const mimeType = guessMime(mime || file.type, fileName);
  const rec = {
    blob: file,
    name: fileName,
    mime: mimeType,
    size: file.size,
    kind: classifyMedia(mimeType, fileName),
    createdAt: createdAt || Date.now(),
  };
  await tx("readwrite", (s) => s.put(rec, id));
  return { id, name: rec.name, mime: rec.mime, size: rec.size, kind: rec.kind, createdAt: rec.createdAt };
}

export async function getMedia(id) {
  if (!id) return null;
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const req = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("Couldn't read the file"));
  });
}

// Rename a stored file. Keeps the original extension if the new name drops it,
// so "holiday" stays "holiday.mp4". Returns the final name.
export async function renameMedia(id, name) {
  const rec = await getMedia(id);
  if (!rec) throw new Error("That file isn't on this device any more");
  const clean = safeFileName(name, rec.name);
  const ext = extOf(rec.name);
  const finalName = ext && !extOf(clean) ? `${clean}.${ext}` : clean;
  await tx("readwrite", (s) => s.put({ ...rec, name: finalName }, id));
  return finalName;
}

export async function deleteMedia(id) {
  if (!id) return;
  await tx("readwrite", (s) => s.delete(id));
}

// Metadata for every stored file (the blob itself is not read).
export async function listMedia() {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out); return; }
      const v = cur.value || {};
      out.push({ id: cur.key, name: v.name, mime: v.mime, size: v.size, kind: v.kind, createdAt: v.createdAt });
      cur.continue();
    };
    req.onerror = () => reject(req.error || new Error("Couldn't list files"));
  });
}

export async function countMedia() {
  try { return (await listMedia()).length; } catch { return 0; }
}

// A blob whose type is guaranteed to be set — <video> refuses to play a blob
// with an empty type on some WebViews.
export function playableBlob(rec) {
  if (!rec?.blob) return null;
  return rec.blob.type === rec.mime ? rec.blob : new Blob([rec.blob], { type: rec.mime });
}

// The HTML placeholder dropped into a message. It is inert text + data-*
// attributes; renderBulletinContent.jsx turns it into the player / file card.
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function mediaPlaceholderHtml({ id, kind, name, size }) {
  const icon = kind === "video" ? "🎬" : kind === "audio" ? "🎵" : "📎";
  return `<div data-media-id="${escAttr(id)}" data-media-kind="${escAttr(kind)}" data-media-name="${escAttr(name)}" data-media-size="${Number(size) || 0}">${icon} ${escAttr(name)} (${formatBytes(size)})</div>`;
}
