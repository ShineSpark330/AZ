// Reading and checking a mod file (.osmod). Pure functions, no DB access.
//
// A mod file is JSON (docs/mods.md has the full format):
//   {
//     "format": "oceans-symphony-mod", "formatVersion": 1,
//     "id": "twin-notes", "name": "Twin notes", "version": "1.0.0",
//     "author": "…", "description": "…",
//     "permissions": ["alters:read"],
//     "pages": [{ "id": "notes", "title": "Twin notes" }],
//     "code": "symphony.registerPage('notes', (root) => { … })"
//   }
// The code never runs in the app's page — only inside the sandboxed mod
// frame (public/mod-host.html).

import { isDataScope } from "./appDataRules.js";

export const MOD_FORMAT = "oceans-symphony-mod";
export const MOD_FORMAT_VERSION = 1;
export const MAX_MOD_CODE_BYTES = 2 * 1024 * 1024;

// Everything a mod can ask for. A mod can always keep its own data and see
// the person's terms and colours; anything about the person's data needs one
// of these, ticked by the person at install. Text uses {{alters}}-style
// placeholders resolved with applyModTerms.
export const MOD_PERMISSIONS = {
  "alters:read": {
    label: "See your {{alters}}",
    detail: "Names, pronouns, roles and colours of your {{alters}} (not bios, notes or pictures).",
  },
  "fronting:read": {
    label: "See who is {{fronting}}",
    detail: "Which {{alters}} are {{fronting}} right now and since when (not your history).",
  },
  "data:read": {
    label: "Read your app data (needs your mod access password)",
    detail: "Read-only copy of the kinds of records you pick: how many {{alters}} there are, {{alters}}, {{fronting}} history, journals, check-ins, {{system}} chat (not private channels), the bulletin board and similar. Locked journal entries stay locked. Only works while a trusted role you chose, like a Gatekeeper, is {{fronting}}. It still can't change anything or send anything off the device.",
    heavy: true,
  },
  "files:save": {
    label: "Save files to your device",
    detail: "It can offer to save a file (an export, say). The app asks you every time, showing the file's name and size.",
  },
  // Adds a picture the mod made to Assets (a drawing, say), optionally as one
  // {{alter}}'s picture. Never silent: the app asks every time (broker.js).
  "pictures:save": {
    label: "Save pictures to your Assets",
    detail: "It can offer to add a picture it made to your Assets, and say which {{alter}} made it. The app asks you every time, showing the picture.",
  },
  "apps:launch": {
    label: "Open apps and links you choose",
    detail: "Lets the mod open an app on your device, or a web link, when you tap something in it. It can check whether an app is installed only for the app names it already knows, and can't list your apps or see anything inside them.",
  },
};

// ── Starting data (`template`) and saved data (`data`) inside a .osmod ──
//   "template": [{ "collection": "shortcut", "name": "…" }, …]
//       The mod's starting state. Added when the mod is installed fresh with
//       no data, and what "Reset to template" puts back. A record may carry
//       an "id" so other records can point at it; ids are remapped on use.
//   "data": { "exported_at": "…", "records": [{ "id": "…", "collection": "…", … }] }
//       A snapshot of the mod's saved data, written by "Export mod + data".
//       The person decides at install whether to restore it.
// Same rules as records a mod saves itself (broker.js): plain JSON, no keys
// the app uses, field names letters/numbers/_, 256 KB and 100 fields a record.
const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const RESERVED_FIELDS = new Set(["id", "mod_id", "collection", "created_date", "updated_date", "created_by"]);
const MAX_RECORD_FIELDS = 100;
const MAX_RECORD_BYTES = 256 * 1024;
export const MAX_TEMPLATE_RECORDS = 500;
export const MAX_DATA_RECORDS = 5000;
export const MAX_MOD_DATA_BYTES = 12 * 1024 * 1024;

// One record out of a file → { collection, id?, …fields }, or null when it
// isn't a usable record (it is then left out, never half-kept).
export function cleanModRecord(rec, { keepId = false } = {}) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  if (typeof rec.collection !== "string" || !COLLECTION_RE.test(rec.collection)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (RESERVED_FIELDS.has(k)) continue;
    if (!FIELD_RE.test(k) || ++n > MAX_RECORD_FIELDS) return null;
    out[k] = v;
  }
  let json;
  try { json = JSON.stringify(out); } catch { return null; }
  if (json.length > MAX_RECORD_BYTES) return null;
  const clean = JSON.parse(json);
  if (keepId && typeof rec.id === "string" && rec.id) clean.id = rec.id.slice(0, 100);
  return { collection: rec.collection, ...clean };
}

function cleanRecordList(list, max, keepId) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, max)) {
    const c = cleanModRecord(r, { keepId });
    if (c) out.push(c);
  }
  return out;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const PAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function applyModTerms(text, terms) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (terms && typeof terms[k] === "string" ? terms[k] : m));
}

export class ModFormatError extends Error {
  constructor(message) { super(message); this.name = "ModFormatError"; }
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Parse the text of a picked file into a clean manifest + code, or throw a
// ModFormatError whose message can be shown to the person as-is.
export function parseModFile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new ModFormatError("This file isn't a mod — it isn't readable mod data."); }
  if (!raw || typeof raw !== "object" || raw.format !== MOD_FORMAT) {
    throw new ModFormatError("This file isn't an Apeiron Zetta mod.");
  }
  if (Number(raw.formatVersion || 1) > MOD_FORMAT_VERSION) {
    throw new ModFormatError("This mod needs a newer version of the app. Update the app, then try again.");
  }
  const id = str(raw.id, 48).toLowerCase();
  if (!ID_RE.test(id)) throw new ModFormatError("This mod has no valid id (lowercase letters, numbers and dashes).");
  const name = str(raw.name, 60);
  if (!name) throw new ModFormatError("This mod has no name.");
  const code = typeof raw.code === "string" ? raw.code : "";
  if (!code.trim()) throw new ModFormatError("This mod has no code.");
  if (new Blob([code]).size > MAX_MOD_CODE_BYTES) throw new ModFormatError("This mod is too large (over 2 MB of code).");

  const permissions = Array.isArray(raw.permissions)
    ? [...new Set(raw.permissions.filter((p) => typeof p === "string"))]
    : [];
  const unknown = permissions.filter((p) => !MOD_PERMISSIONS[p]);
  if (unknown.length) {
    throw new ModFormatError(`This mod asks for something this version of the app doesn't know (${unknown.join(", ")}). It may need a newer version of the app.`);
  }

  const seen = new Set();
  const pages = (Array.isArray(raw.pages) ? raw.pages : [])
    .map((p) => ({ id: str(p?.id, 40).toLowerCase(), title: str(p?.title, 40) }))
    .filter((p) => PAGE_ID_RE.test(p.id) && p.title && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 12);
  if (!pages.length) throw new ModFormatError("This mod has no pages to show.");

  const template = cleanRecordList(raw.template, MAX_TEMPLATE_RECORDS, true);
  const dataRaw = raw.data && typeof raw.data === "object" ? raw.data : null;
  let dataRecords = dataRaw ? cleanRecordList(dataRaw.records, MAX_DATA_RECORDS, true) : [];
  if (dataRecords.length && JSON.stringify(dataRecords).length > MAX_MOD_DATA_BYTES) {
    throw new ModFormatError("The saved data inside this mod file is too large to restore (over 12 MB).");
  }

  return {
    mod_id: id,
    name,
    version: str(raw.version, 20) || "1.0.0",
    author: str(raw.author, 60),
    description: str(raw.description, 500),
    homepage: /^https:\/\//i.test(str(raw.homepage, 300)) ? str(raw.homepage, 300) : "",
    permissions,
    // Which kinds of records a data:read mod wants. Anything not in the app's
    // allow-list is dropped, and the person still decides at install.
    dataScopes: permissions.includes("data:read")
      ? [...new Set((Array.isArray(raw.dataScopes) ? raw.dataScopes : []).filter((x) => isDataScope(x)))]
      : [],
    pages,
    code,
    template,
    // Saved data that travelled inside the file. Not stored with the mod:
    // the install dialog asks whether to restore it.
    data: dataRecords.length ? { exported_at: str(dataRaw?.exported_at, 40), records: dataRecords } : null,
  };
}


// ── Data files: what "Import data" accepts ──
// Two kinds of file hold a mod's saved data:
//   • a data-only file   { kind: "oceans-symphony-mod-data", mod_id, mod_name, exported_at, records }
//   • a .osmod that has a "data" block (and so also carries the mod itself)
// Both come back as { kind: "data" | "mod", mod_id, mod_name, exported_at, records, mod }
// where `mod` is the parsed mod for a .osmod (so the person can tick "update the
// mod too") and null for a data-only file.
export const MOD_DATA_KIND = "oceans-symphony-mod-data";

export function parseDataFile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new ModFormatError("That file isn't readable mod data."); }
  if (raw && typeof raw === "object" && raw.kind === MOD_DATA_KIND) {
    const id = str(raw.mod_id, 48).toLowerCase();
    if (!ID_RE.test(id)) throw new ModFormatError("This data file doesn't say which mod it belongs to.");
    // Older copies saved the app's whole row, including internal fields that
    // start with "_" — leave those out rather than dropping the record.
    const rows = (Array.isArray(raw.records) ? raw.records : []).map((r) => {
      if (!r || typeof r !== "object") return r;
      return Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));
    });
    const records = cleanRecordList(rows, MAX_DATA_RECORDS, true);
    if (JSON.stringify(records).length > MAX_MOD_DATA_BYTES) throw new ModFormatError("This data file is too large to import (over 12 MB).");
    return { kind: "data", mod_id: id, mod_name: str(raw.mod_name, 60) || id, exported_at: str(raw.exported_at, 40), records, mod: null };
  }
  if (raw && typeof raw === "object" && raw.format === MOD_FORMAT) {
    const mod = parseModFile(text);
    return { kind: "mod", mod_id: mod.mod_id, mod_name: mod.name, exported_at: mod.data?.exported_at || "", records: mod.data?.records || [], mod };
  }
  throw new ModFormatError("This file isn't mod data or a mod.");
}
