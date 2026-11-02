// The only door between a mod and the person's data.
//
// A mod runs in a sandboxed frame (public/mod-host.html) that cannot reach
// the database at all. Every `symphony.*` call it makes arrives here as a
// message; ModFrame.jsx hands it to handleModCall with the installed mod's
// record. Rules enforced here, whatever the mod's code says:
//   • a mod reads and writes only ModData rows stamped with its own mod_id;
//   • it never writes anything else — no core record can be changed or
//     deleted through this file;
//   • reading core data needs the matching permission the person granted,
//     and returns a small copy with only the fields that permission names.

import { localEntities } from "@/api/base44Client";
import { ACCESSIBLE_ENTITIES, isDataScope, COUNT_SCOPE_PREFIX, sanitizeRecord, hasModAccessPassword, gateKeepersFronting } from "@/lib/mods/modAccess";
import { visibleRows, privateChannelIdSet, countRows } from "@/lib/mods/appDataRules";

const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const RESERVED_FIELDS = new Set(["id", "mod_id", "collection", "created_date", "updated_date", "created_by"]);
const MAX_FIELDS = 100;
const MAX_RECORD_BYTES = 256 * 1024;

export class ModCallError extends Error {
  constructor(message) { super(message); this.name = "ModCallError"; }
}

function checkCollection(c) {
  if (typeof c !== "string" || !COLLECTION_RE.test(c)) {
    throw new ModCallError("Collection names are letters, numbers, - and _ (up to 40), starting with a letter.");
  }
  return c;
}

// A mod's fields, cleaned: plain JSON only, no keys the app uses itself.
function cleanFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new ModCallError("Records must be plain objects.");
  }
  const keys = Object.keys(fields);
  if (keys.length > MAX_FIELDS) throw new ModCallError(`A record can have at most ${MAX_FIELDS} fields.`);
  const out = {};
  for (const k of keys) {
    if (RESERVED_FIELDS.has(k)) continue;
    if (!FIELD_RE.test(k)) throw new ModCallError(`"${k}" isn't a valid field name (letters, numbers and _, starting with a letter).`);
    out[k] = fields[k];
  }
  let json;
  try { json = JSON.stringify(out); } catch { throw new ModCallError("Records must be plain JSON data."); }
  if (json.length > MAX_RECORD_BYTES) throw new ModCallError("That record is too big (over 256 KB).");
  return JSON.parse(json);
}

// What the mod sees of its own row: its fields plus id and dates.
function toModRecord(row) {
  const out = { id: row.id, created_date: row.created_date, updated_date: row.updated_date };
  for (const [k, v] of Object.entries(row)) {
    if (RESERVED_FIELDS.has(k) || k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

async function ownRow(mod, collection, id) {
  if (typeof id !== "string" || !id) throw new ModCallError("Missing record id.");
  const row = await localEntities.ModData.get(id);
  if (!row || row.mod_id !== mod.mod_id || row.collection !== collection) {
    throw new ModCallError("No such record.");
  }
  return row;
}

function requirePermission(mod, perm) {
  if (!(mod.granted_permissions || []).includes(perm)) {
    throw new ModCallError(`This mod wasn't given "${perm}". It can be turned on in the Mods page.`);
  }
}

// Package names look like com.example.app. Anything else is refused before it
// gets near the phone.
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
function checkPackage(pkg) {
  if (typeof pkg !== "string" || pkg.length > 200 || !PACKAGE_RE.test(pkg)) {
    throw new ModCallError("That isn't an app name like com.example.app.");
  }
  return pkg;
}
function checkLink(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { throw new ModCallError("That isn't a web link."); }
  if (u.protocol !== "https:" || String(url).length > 2000) throw new ModCallError("Only https:// links can be opened.");
  return u.toString();
}
// A mod can open an app about once every 1.5 seconds, and a link once every
// 1.5 seconds (counted separately, so "that app isn't installed, open its
// link" in one tap works), so a runaway mod can't flood the phone.
const lastLaunch = new Map();
function throttleLaunch(mod, kind) {
  const key = `${mod.mod_id}:${kind}`;
  const now = Date.now();
  if (now - (lastLaunch.get(key) || 0) < 1500) throw new ModCallError("Too fast. Try again in a moment.");
  lastLaunch.set(key, now);
}

const APPDATA_PAGE_MAX = 500;
const APPDATA_MAX_BYTES = 4 * 1024 * 1024;

// The heavy permission. Every call re-checks everything, so switching the mod
// off, removing the password, or the allowed role stepping away stops reads at
// once. A mod is only told a neutral reason (it has no access to the person's
// words for these things; the app's own screens explain it properly).
async function requireDataAccess(mod, entity, { countOk = false } = {}) {
  requirePermission(mod, "data:read");
  if (!hasModAccessPassword()) throw new ModCallError("Data access is switched off in the app (no mod access password is set).");
  const keepers = await gateKeepersFronting();
  if (keepers !== null && keepers.length === 0) {
    throw new ModCallError("Data access is paused: the role that allows it isn't active right now.");
  }
  const scopes = (mod.data_scopes || []).filter(isDataScope);
  if (entity !== undefined && !scopes.includes(entity) && !(countOk && scopes.includes(COUNT_SCOPE_PREFIX + entity))) {
    throw new ModCallError(`This mod wasn't allowed to read "${String(entity).slice(0, 40)}".`);
  }
  return scopes;
}

// All records of an allowed kind, minus what a mod may never see (private chat
// channels and deleted messages).
async function readVisible(entity) {
  const rows = await localEntities[entity].list();
  if (entity !== "SystemChatMessage") return visibleRows(entity, rows);
  const channels = await localEntities.SystemChatChannel.list();
  return visibleRows(entity, rows, { privateChannelIds: privateChannelIdSet(channels) });
}

const HANDLERS = {
  async "appData.collections"(mod) {
    return requireDataAccess(mod);
  },
  async "appData.list"(mod, [entity, opts]) {
    if (typeof entity !== "string") throw new ModCallError("Say which records to read.");
    await requireDataAccess(mod, entity);
    const o = opts && typeof opts === "object" ? opts : {};
    const offset = Math.max(0, Math.floor(Number(o.offset) || 0));
    const limit = Math.min(APPDATA_PAGE_MAX, Math.max(1, Math.floor(Number(o.limit) || 100)));
    const rows = await readVisible(entity);
    const page = rows.slice(offset, offset + limit).map(sanitizeRecord);
    let json;
    try { json = JSON.stringify(page); } catch { throw new ModCallError("Those records couldn't be read."); }
    if (json.length > APPDATA_MAX_BYTES) throw new ModCallError("That page is too big. Ask for fewer records at a time.");
    return { total: rows.length, offset, records: JSON.parse(json) };
  },
  // Just how many records there are: { total, active }. Works with either the
  // full scope or the count-only "count:Entity" scope.
  async "appData.count"(mod, [entity]) {
    if (typeof entity !== "string" || !ACCESSIBLE_ENTITIES[entity]) throw new ModCallError("Say which records to count.");
    await requireDataAccess(mod, entity, { countOk: true });
    return countRows(await readVisible(entity));
  },
  async "data.list"(mod, [collection, where]) {
    checkCollection(collection);
    const rows = await localEntities.ModData.filter({ mod_id: mod.mod_id, collection }, "created_date");
    let out = rows.map(toModRecord);
    if (where && typeof where === "object") {
      const pairs = Object.entries(where).filter(([k]) => !RESERVED_FIELDS.has(k) || k === "id");
      out = out.filter((r) => pairs.every(([k, v]) => r[k] === v));
    }
    return out;
  },
  async "data.get"(mod, [collection, id]) {
    checkCollection(collection);
    try { return toModRecord(await ownRow(mod, collection, id)); } catch { return null; }
  },
  async "data.create"(mod, [collection, fields]) {
    checkCollection(collection);
    const row = await localEntities.ModData.create({ ...cleanFields(fields), mod_id: mod.mod_id, collection });
    return toModRecord(row);
  },
  async "data.update"(mod, [collection, id, fields]) {
    checkCollection(collection);
    await ownRow(mod, collection, id);
    const row = await localEntities.ModData.update(id, cleanFields(fields));
    return toModRecord(row);
  },
  async "data.remove"(mod, [collection, id]) {
    checkCollection(collection);
    await ownRow(mod, collection, id);
    // A normal delete: Recent changes keeps a copy the person can restore.
    await localEntities.ModData.delete(id);
    return true;
  },
  async "alters.list"(mod) {
    requirePermission(mod, "alters:read");
    const alters = await localEntities.Alter.list();
    return alters.map((a) => ({
      id: a.id,
      name: a.name || "",
      alias: a.alias || "",
      pronouns: a.pronouns || "",
      role: a.role || "",
      color: a.color || "",
      archived: !!a.is_archived,
    }));
  },
  async "fronting.current"(mod) {
    requirePermission(mod, "fronting:read");
    const sessions = await localEntities.FrontingSession.filter({ is_active: true });
    return sessions
      .filter((s) => !s.end_time && (s.alter_id || s.primary_alter_id))
      .map((s) => ({
        alter_id: s.alter_id || s.primary_alter_id,
        is_primary: !!s.is_primary || (!s.alter_id && !!s.primary_alter_id),
        since: s.start_time || null,
      }));
  },
};

// `ui.*` calls need the screen, so ModFrame passes them in as `ui`.
export async function handleModCall(mod, method, args, ui) {
  if (!mod || !mod.enabled) throw new ModCallError("This mod is turned off.");
  const a = Array.isArray(args) ? args : [];
  if (method === "ui.toast") { ui?.toast?.(String(a[0] || "").slice(0, 200)); return true; }
  if (method === "ui.openPage") {
    const page = (mod.pages || []).find((p) => p.id === a[0]);
    if (!page) throw new ModCallError("This mod has no such page.");
    ui?.openPage?.(page.id);
    return true;
  }
  if (method === "ui.openApp") {
    requirePermission(mod, "apps:launch");
    const pkg = checkPackage(a[0]);
    throttleLaunch(mod, "app");
    return (await ui?.openApp?.(pkg)) || "unsupported";
  }
  if (method === "ui.openLink") {
    requirePermission(mod, "apps:launch");
    const url = checkLink(a[0]);
    throttleLaunch(mod, "link");
    return (await ui?.openLink?.(url)) || "failed";
  }
  if (method === "apps.isInstalled") {
    requirePermission(mod, "apps:launch");
    const pkg = checkPackage(a[0]);
    const r = await ui?.isAppInstalled?.(pkg);
    return r === true || r === false ? r : null;
  }
  if (method === "ui.saveFile") {
    requirePermission(mod, "files:save");
    const name = String(a[0] || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";
    if (typeof Blob === "undefined" || !(a[1] instanceof Blob)) throw new ModCallError("saveFile needs file data.");
    return (await ui?.saveFile?.(name, a[1], String(a[2] || "").slice(0, 100))) || "failed";
  }
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, method) ? HANDLERS[method] : null;
  if (!handler) throw new ModCallError(`Unknown call "${method}".`);
  return handler(mod, a);
}
