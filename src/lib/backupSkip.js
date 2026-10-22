// "Skip in backups" — a per-file switch in the Assets library.
//
// By default EVERY stored file is backed up. A person can mark individual
// files (or every file in a folder, which just marks each one) to be left
// out of backups — handy for a few huge videos they don't want in every
// backup. Marked files are left out of manual exports, the .zip exports AND
// automatic backups, so "skipped" means the same thing everywhere.
//
// DATA SAFETY: this only ever decides what is COPIED into a backup. It never
// deletes, moves or changes a file, and it can't be turned on by accident for
// new uploads (new files are always included). A skipped file exists only on
// this device, so the library says so wherever the switch is shown.
//
// Stored on SystemSettings.backup_skip = { keys: ["i:<imageId>", "m:<mediaId>"] }
// (the same keys the zip exports use: i: = picture/audio store, m: = attached
// files / videos store). It travels with the "Settings & Custom" category.

import { base44 } from "@/api/base44Client";

export const skipKeyForImage = (id) => `i:${id}`;
export const skipKeyForMedia = (id) => `m:${id}`;

async function settingsRow() {
  const rows = await base44.entities.SystemSettings.list();
  return rows?.[0] || null;
}

function keysFrom(row) {
  const k = row?.backup_skip?.keys;
  return Array.isArray(k) ? k.filter((x) => typeof x === "string") : [];
}

// The set of marked keys. Never throws — if settings can't be read, nothing
// is skipped (the safe direction: back up more, not less).
export async function loadBackupSkip() {
  try { return new Set(keysFrom(await settingsRow())); } catch { return new Set(); }
}

// Mark (skip = true) or un-mark (skip = false) a list of keys. Re-reads the
// settings row first so a stale screen can't overwrite a newer list.
export async function setBackupSkipKeys(keys, skip) {
  const row = await settingsRow();
  if (!row?.id) throw new Error("Settings aren't ready yet — try again in a moment.");
  const next = new Set(keysFrom(row));
  for (const k of keys) { if (skip) next.add(k); else next.delete(k); }
  await base44.entities.SystemSettings.update(row.id, { backup_skip: { keys: [...next] } });
  return next;
}

// { [imageId]: dataUrl } without the marked pictures / audio.
export function filterImagesBySkip(imagesMap, skipSet) {
  if (!skipSet || !skipSet.size) return imagesMap;
  const out = {};
  for (const [id, v] of Object.entries(imagesMap || {})) {
    if (!skipSet.has(skipKeyForImage(id))) out[id] = v;
  }
  return out;
}
