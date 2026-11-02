// Installed mods and their data, in the app database.
//
//   ModPackage — one row per installed mod: the checked manifest, its code,
//                which permissions the person granted, and whether it's on.
//   ModData    — every record any mod saves: { mod_id, collection, …fields }.
//
// Both are ordinary entities, so they ride encryption, the native file
// mirror, device sync, Recent changes and backups (the "mods" export
// category in DataBackupRestore.jsx) like everything else. Removing a mod
// never removes its data; only deleteModData does, and it saves a copy first.

import { localEntities } from "@/api/base44Client";
import { MOD_FORMAT, MOD_FORMAT_VERSION, MOD_DATA_KIND, MAX_TEMPLATE_RECORDS } from "@/lib/mods/modPackage";
import { verifyModAccessPassword, assertRoleGate, ModAccessError } from "@/lib/mods/modAccess";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export const MODS_QUERY_KEY = ["mods"];

export async function listMods() {
  const rows = await localEntities.ModPackage.list();
  return rows.filter((r) => r && r.mod_id);
}

// The starting state a mod resets to: the person's own saved template if they
// made one ("Save as template"), else the one that came with the mod's file.
export function effectiveTemplate(mod) {
  if (Array.isArray(mod?.custom_template)) return mod.custom_template;
  return Array.isArray(mod?.template) ? mod.template : [];
}

export async function findMod(modId) {
  const rows = await localEntities.ModPackage.filter({ mod_id: modId });
  return rows[0] || null;
}

// Install a parsed mod (modPackage.parseModFile) with the permissions the
// person ticked. Installing a mod that's already here updates it in place:
// its data is untouched, and it stays on or off as it was.
//
// A mod that ships a `template` gets it as its starting data, but only on a
// FRESH install with nothing saved for it already (a reinstall after removing
// keeps the data it had; an update never re-adds starter items the person
// deleted). Pass { seedTemplate: false } when the person is restoring saved
// data from the file instead.
export async function installMod(parsed, grantedPermissions, { seedTemplate = true } = {}) {
  const existing = await findMod(parsed.mod_id);
  // "data:read" is never granted by a tick at install: it needs the mod access
  // password (grantDataAccess). An update keeps it only if it was already
  // granted AND the update doesn't ask for more kinds of records than before.
  const scopesGrew = (parsed.dataScopes || []).some((x) => !(existing?.data_scopes || []).includes(x));
  const keepData = !!existing && (existing.granted_permissions || []).includes("data:read")
    && parsed.permissions.includes("data:read") && !scopesGrew;
  const granted = (grantedPermissions || [])
    .filter((p) => parsed.permissions.includes(p) && p !== "data:read")
    .concat(keepData ? ["data:read"] : []);
  const fields = {
    mod_id: parsed.mod_id,
    name: parsed.name,
    version: parsed.version,
    author: parsed.author,
    description: parsed.description,
    homepage: parsed.homepage,
    permissions: parsed.permissions,
    granted_permissions: granted,
    data_scopes: keepData ? (existing.data_scopes || []) : [],
    requested_data_scopes: parsed.dataScopes || [],
    pages: parsed.pages,
    code: parsed.code,
    template: parsed.template || [],
  };
  if (existing) return localEntities.ModPackage.update(existing.id, fields);
  const created = await localEntities.ModPackage.create({ ...fields, enabled: true, installed_at: new Date().toISOString() });
  if (seedTemplate && fields.template.length && (await listModData(parsed.mod_id)).length === 0) {
    await insertRecordsRemapped(parsed.mod_id, fields.template);
  }
  return created;
}

export function setModEnabled(mod, enabled) {
  return localEntities.ModPackage.update(mod.id, { enabled: !!enabled });
}

export function setModPermissions(mod, granted) {
  // data:read can be taken away here but only given through grantDataAccess.
  const hadData = (mod.granted_permissions || []).includes("data:read");
  const next = (granted || []).filter((p) => (mod.permissions || []).includes(p) && p !== "data:read");
  if (hadData && (granted || []).includes("data:read")) next.push("data:read");
  return localEntities.ModPackage.update(mod.id, {
    granted_permissions: next,
    ...(hadData && !next.includes("data:read") ? { data_scopes: [] } : {}),
  });
}

// Give a mod "data:read" for the kinds of records the person picked. Needs the
// mod access password AND an allowed-role {{alter}} to be {{fronting}} now.
// Throws ModAccessError (message safe to show) when either fails.
export async function grantDataAccess(mod, scopes, password) {
  const wanted = (scopes || []).filter((x) => (mod.requested_data_scopes || []).includes(x));
  if (!(mod.permissions || []).includes("data:read")) throw new ModAccessError("This mod doesn't ask to read your data.");
  if (!wanted.length) throw new ModAccessError("Pick at least one kind of record to allow.");
  if (!(await verifyModAccessPassword(password))) throw new ModAccessError("That isn't the mod access password.");
  await assertRoleGate();
  const granted = new Set(mod.granted_permissions || []);
  granted.add("data:read");
  return localEntities.ModPackage.update(mod.id, { granted_permissions: [...granted], data_scopes: wanted });
}

// Narrow what a mod may read, without the password: only kinds it already has
// can stay. Narrowing to nothing takes data:read away. (Adding kinds goes
// through grantDataAccess, which needs the password and the allowed role.)
export function narrowDataAccess(mod, scopes) {
  const have = new Set(mod.data_scopes || []);
  const keep = (scopes || []).filter((x) => have.has(x));
  if (!keep.length) return setModPermissions(mod, (mod.granted_permissions || []).filter((p) => p !== "data:read"));
  return localEntities.ModPackage.update(mod.id, { data_scopes: keep });
}

// Removes the mod itself. Its saved data stays (and comes back to life if
// the mod is installed again); Recent changes keeps the removed package too.
export function uninstallMod(mod) {
  return localEntities.ModPackage.delete(mod.id);
}

export async function listModData(modId) {
  return localEntities.ModData.filter({ mod_id: modId });
}

async function saveJsonCopy(obj, filename, { mimeType = "application/json", title = "Mod data copy", dialogTitle = "Save mod data" } = {}) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: mimeType });
  const { isNative } = await import("@/lib/platform");
  if (isNative()) {
    try {
      const { saveBlobToPublicDownloads } = await import("@/lib/nativeMediaStoreSave");
      const res = await saveBlobToPublicDownloads({ blob, filename, mimeType, subdir: "Oceans Symphony" });
      if (res?.result === "filesystem") return { result: "downloaded" };
    } catch { /* fall through to the share chain */ }
  }
  const { shareFile } = await import("@/lib/shareFile");
  return shareFile({ blob, filename, title, dialogTitle, prefer: "download" });
}

// Adds records ({ collection, …fields }) to a mod's data in one save and
// returns the new rows, in order. New rows always get new ids.
async function addModRecords(modId, records) {
  if (!records.length) return [];
  return localEntities.ModData.bulkCreate(records.map(({ collection, id: _id, ...fields }) => ({ ...fields, mod_id: modId, collection })));
}

// Adds records that may point at each other. A record's own `id` is only used
// to find those links: any string inside another record's fields (also inside
// arrays and objects) that equals an old id is rewritten to the new id.
async function insertRecordsRemapped(modId, records) {
  const created = await addModRecords(modId, records);
  const idMap = new Map();
  records.forEach((r, i) => { if (r.id && created[i]) idMap.set(r.id, created[i].id); });
  if (!idMap.size) return created;
  const remap = (v) => {
    if (typeof v === "string") return idMap.has(v) ? idMap.get(v) : v;
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
    return v;
  };
  const patches = [];
  records.forEach((r, i) => {
    if (!created[i]) return;
    const { collection: _c, id: _id, ...fields } = r;
    const next = remap(fields);
    if (JSON.stringify(next) !== JSON.stringify(fields)) patches.push({ id: created[i].id, data: next });
  });
  if (patches.length) await localEntities.ModData.bulkUpdate(patches);
  return created;
}

// The saved data of a mod as plain records for a file, oldest first.
async function snapshotRecords(modId) {
  const rows = (await listModData(modId)).slice().sort((a, b) => String(a.created_date || "").localeCompare(String(b.created_date || "")));
  return rows.map((r) => {
    const out = { id: r.id, collection: r.collection };
    for (const [k, v] of Object.entries(r)) {
      if (["id", "mod_id", "collection", "created_date", "updated_date", "created_by"].includes(k) || k.startsWith("_")) continue;
      out[k] = v;
    }
    return out;
  });
}

// Saves the mod ITSELF as a .osmod file — the same file you install from — so a
// mod that was imported (and later deleted or lost with the device) can be
// installed again or shared. Rebuilt from the installed copy: manifest + code
// (+ its starting template). With { includeData: true } the file also carries
// the mod's saved data, in readable form; installing that file offers to
// restore it. Records that point at each other by id keep working: the ids are
// remapped when the data is restored (restoreModData).
export async function exportModPackage(mod, { includeData = false } = {}) {
  const pkg = {
    format: MOD_FORMAT,
    formatVersion: MOD_FORMAT_VERSION,
    id: mod.mod_id,
    name: mod.name,
    version: mod.version || "1.0.0",
    author: mod.author || "",
    description: mod.description || "",
    ...(mod.homepage ? { homepage: mod.homepage } : {}),
    permissions: mod.permissions || [],
    pages: mod.pages || [],
    ...(effectiveTemplate(mod).length ? { template: effectiveTemplate(mod) } : {}),
    code: mod.code || "",
  };
  if (includeData) {
    const records = await snapshotRecords(mod.mod_id);
    if (records.length) pkg.data = { exported_at: new Date().toISOString(), records };
  }
  return saveJsonCopy(pkg, `${mod.mod_id}-${pkg.version}${pkg.data ? "-with-data" : ""}.osmod`, {
    mimeType: "application/octet-stream", title: "Mod", dialogTitle: "Save mod",
  });
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

export async function exportModData(modId, modName) {
  const records = await snapshotRecords(modId);
  return saveJsonCopy(
    { kind: MOD_DATA_KIND, mod_id: modId, mod_name: modName || modId, exported_at: new Date().toISOString(), records },
    `mod-data-${modId}-${stamp()}.json`
  );
}

// Deletes everything a mod saved — only ever from an explicit button, and
// only after a copy is saved. A cancelled or failed save stops the delete.
export async function deleteModData(modId, modName) {
  const saved = await exportModData(modId, modName);
  if (!saved || !["downloaded", "shared", "filesystem"].includes(saved.result)) {
    return { deleted: 0, saved: false };
  }
  const records = await listModData(modId);
  for (const r of records) await localEntities.ModData.delete(r.id);
  return { deleted: records.length, saved: true };
}

// Puts a mod's data back to its template: saves a copy of what's there, removes
// it, then adds the template's starting records again. A mod with no template
// ends up empty (same as deleteModData). A cancelled or failed copy stops
// everything — nothing is removed.
export async function resetModDataToTemplate(mod) {
  const saved = await exportModData(mod.mod_id, mod.name);
  if (!saved || !["downloaded", "shared", "filesystem"].includes(saved.result)) {
    return { saved: false, deleted: 0, added: 0 };
  }
  const records = await listModData(mod.mod_id);
  if (records.length) await localEntities.ModData.bulkDelete(records.map((r) => r.id));
  const added = await insertRecordsRemapped(mod.mod_id, effectiveTemplate(mod));
  return { saved: true, deleted: records.length, added: added.length };
}

// Restores saved data that came inside a .osmod (parsed.data.records). With
// replace, the mod's current data is removed first, but only after a copy of
// it was saved (a failed copy stops it: returns { saved: false }). Records keep
// pointing at each other: an id inside a record's fields that matches an old
// record id is rewritten to the new id.
export async function restoreModData(modId, modName, records, { replace = false } = {}) {
  if (replace) {
    const current = await listModData(modId);
    if (current.length) {
      const saved = await exportModData(modId, modName);
      if (!saved || !["downloaded", "shared", "filesystem"].includes(saved.result)) return { saved: false, restored: 0 };
      await localEntities.ModData.bulkDelete(current.map((r) => r.id));
    }
  }
  const created = await insertRecordsRemapped(modId, records);
  return { saved: true, restored: created.length };
}

// "Save as template": keeps the mod's data as it is right now as the state
// "Reset to template" goes back to (and what a mod export carries as its
// template). It never changes the mod's own original template, so
// restoreOriginalTemplate can bring that back.
export async function saveCurrentAsTemplate(mod) {
  const records = await snapshotRecords(mod.mod_id);
  if (records.length > MAX_TEMPLATE_RECORDS) {
    throw new Error(`A template can hold up to ${MAX_TEMPLATE_RECORDS} items, and it has ${records.length}.`);
  }
  if (JSON.stringify(records).length > 2 * 1024 * 1024) throw new Error("There's too much saved data to keep as a template (over 2 MB).");
  await localEntities.ModPackage.update(mod.id, { custom_template: records });
  return records.length;
}

export function restoreOriginalTemplate(mod) {
  return localEntities.ModPackage.update(mod.id, { custom_template: null });
}

// "Import data". `file` is what parseDataFile returned. With updateMod the mod
// itself is also updated from a .osmod file (keeping the permissions it has
// now; new ones it asks for stay off). With replace, the current data is
// removed first, after a copy of it is saved; a copy that can't be saved stops
// everything before anything changes.
export async function importModData(mod, file, { replace = false, updateMod = false } = {}) {
  if (replace && file.records.length) {
    const res = await restoreModData(mod.mod_id, mod.name, [], { replace: true });
    if (!res.saved) return { saved: false, restored: 0, updated: false };
  }
  let updated = false;
  if (updateMod && file.mod) {
    await installMod(file.mod, mod.granted_permissions || [], { seedTemplate: false });
    updated = true;
  }
  const res = await restoreModData(mod.mod_id, mod.name, file.records);
  return { saved: true, restored: res.restored, updated };
}

export function useMods() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: MODS_QUERY_KEY, queryFn: listMods, staleTime: 30_000 });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: MODS_QUERY_KEY }), [qc]);
  return { mods: query.data || [], isLoading: query.isLoading, refresh };
}
