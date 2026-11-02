// Mod data access — the heavy permission.
//
// Ordinary mod permissions (alters:read, fronting:read…) are one tick at
// install. "data:read" lets a mod read the app's records (journals, check-ins,
// history…), so it is locked behind three things, all checked here and again
// on every call in broker.js:
//
//   1. A MOD ACCESS PASSWORD, set in Settings → Storage & encryption → "Mod
//      data access". Separate from the storage password, so a mod grant never
//      needs the password that unlocks the whole app. Only a salted PBKDF2
//      verifier is kept — never the password. Wrong guesses back off.
//   2. An ASSIGNED ROLE. Only an {{alter}} whose role is on the allowed list
//      (default "Gatekeeper") can open the gate: the grant is refused unless
//      such an {{alter}} is {{fronting}} right now, and the mod's reads stop
//      the moment none is. Set the list to nothing to switch the check off.
//   3. The mod must be ON, and the person must have ticked data:read for it.
//
// A mod only ever gets a read-only copy, limited to ACCESSIBLE_ENTITIES and
// with device secrets stripped (see sanitizeRecord). It can't write, and
// nothing here weakens the sandbox: the mod frame still has no network.
//
// The password's recovery key lives in recovery.js under scope "mod-access".

import { localEntities } from "@/api/base44Client";
import { KDF_ITERATIONS } from "@/lib/localEncryption";
import { bytesToBase64, base64ToBytes } from "@/lib/base64";

const LS_KEY = "symphony_mod_access_v1";
export const DEFAULT_ROLES = ["Gatekeeper"];
export const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILS = 5;

// What a mod may read, grouped the way people think of their data. Anything
// not listed is unreachable — including friends identity, push registrations,
// settings (they can hold tokens), other mods' code and data, and deletion logs.
export const ACCESSIBLE_ENTITIES = {
  Alter: "{{Alters}}",
  FrontingSession: "{{Fronting}} history",
  JournalEntry: "Journals (locked entries stay locked)",
  EmotionCheckIn: "Emotion check-ins",
  SymptomCheckIn: "Symptom check-ins",
  Activity: "Activities and plans",
  Task: "To-dos",
  StatusNote: "Status notes",
  Location: "Locations",
  Sleep: "Sleep",
  SystemChangeEvent: "{{System}} changes",
  Group: "Groups",
  AlterNote: "{{Alter}} notes",
  // System chat only reaches channels that aren't private, and bulletins are
  // read as written (see visibleRows in appDataRules.js).
  SystemChatChannel: "{{System}} chat channels (not private ones)",
  SystemChatMessage: "{{System}} chat messages (not private channels)",
  Bulletin: "Bulletin board posts",
  BulletinComment: "Bulletin board comments",
};

// A "count:Entity" scope lets a mod learn only HOW MANY records there are
// (appData.count), never their content. Any entity above can be counted.
export const COUNT_SCOPE_PREFIX = "count:";
export function isDataScope(x) {
  if (typeof x !== "string") return false;
  if (ACCESSIBLE_ENTITIES[x]) return true;
  return x.startsWith(COUNT_SCOPE_PREFIX) && !!ACCESSIBLE_ENTITIES[x.slice(COUNT_SCOPE_PREFIX.length)];
}
export function dataScopeLabel(x) {
  if (x === "count:Alter") return "How many {{alters}} there are (just the number)";
  if (typeof x === "string" && x.startsWith(COUNT_SCOPE_PREFIX)) return `How many: ${ACCESSIBLE_ENTITIES[x.slice(COUNT_SCOPE_PREFIX.length)] || x} (just the number)`;
  return ACCESSIBLE_ENTITIES[x] || x;
}

// How the Mods page groups scopes for the person: one master tick ("all of
// the system data") and an advanced list of these groups. A group only shows
// the scopes a mod actually asked for. Groups may overlap (the Timeline is
// made from the same records as the others).
export const DATA_SCOPE_GROUPS = [
  { id: "count", label: "How many {{alters}} there are", detail: "Just the number. No names or details.", scopes: ["count:Alter"] },
  { id: "alters", label: "Who the {{alters}} are", detail: "Names, roles and profile details, and groups.", scopes: ["Alter", "Group"] },
  { id: "history", label: "{{System}} history and calendar", detail: "{{System}} changes, plans and activities, and to-dos.", scopes: ["SystemChangeEvent", "Activity", "Task"] },
  { id: "journal", label: "Journals and check-in log", detail: "Journals, emotion and symptom check-ins, status notes and {{alter}} notes. Locked entries stay locked.", scopes: ["JournalEntry", "EmotionCheckIn", "SymptomCheckIn", "StatusNote", "AlterNote"] },
  { id: "tracking", label: "Tracking", detail: "Who has been {{fronting}}, sleep and places.", scopes: ["FrontingSession", "Sleep", "Location"] },
  { id: "chat", label: "{{System}} chat", detail: "Messages in channels that aren't private.", scopes: ["SystemChatChannel", "SystemChatMessage"] },
  { id: "bulletin", label: "Bulletin board", detail: "Posts and comments.", scopes: ["Bulletin", "BulletinComment"] },
  { id: "timeline", label: "Timeline", detail: "The timeline is built from your history, journal and tracking records, so this ticks those.", scopes: ["FrontingSession", "EmotionCheckIn", "SymptomCheckIn", "JournalEntry", "Activity", "Task", "Sleep", "Location", "StatusNote", "SystemChangeEvent", "AlterNote"] },
];

// Fields that are never handed to a mod even inside an allowed record.
const STRIP_FIELD = /(^_)|secret|token|password|passphrase|private_key|api_?key|recovery|endpoint/i;

export function sanitizeRecord(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (STRIP_FIELD.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export class ModAccessError extends Error {
  constructor(message) { super(message); this.name = "ModAccessError"; }
}

function read() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); }
  catch { throw new ModAccessError("Couldn't save this on the device."); }
}

export const hasModAccessPassword = () => !!read()?.hash;
export const getAllowedRoles = () => {
  const s = read();
  return Array.isArray(s?.roles) ? s.roles : DEFAULT_ROLES;
};

async function verifierFor(password, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, 256);
  return new Uint8Array(bits);
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function setModAccessPassword(password, roles) {
  if (String(password || "").length < MIN_PASSWORD_LENGTH) {
    throw new ModAccessError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await verifierFor(password, salt, KDF_ITERATIONS);
  const prev = read();
  write({
    v: 1, iter: KDF_ITERATIONS, salt: bytesToBase64(salt), hash: bytesToBase64(hash),
    roles: Array.isArray(roles) ? roles : (prev?.roles || DEFAULT_ROLES),
    fails: 0, lockUntil: 0,
  });
}

// True/false for a password; throws when locked out for too many wrong tries.
export async function verifyModAccessPassword(password) {
  const s = read();
  if (!s?.hash) throw new ModAccessError("No mod access password is set. Set one in Settings → Storage & encryption.");
  if (s.lockUntil && Date.now() < s.lockUntil) {
    const mins = Math.ceil((s.lockUntil - Date.now()) / 60000);
    throw new ModAccessError(`Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  const got = await verifierFor(password, base64ToBytes(s.salt), s.iter || KDF_ITERATIONS);
  if (sameBytes(got, base64ToBytes(s.hash))) {
    if (s.fails) write({ ...s, fails: 0, lockUntil: 0 });
    return true;
  }
  const fails = (s.fails || 0) + 1;
  const lockUntil = fails >= MAX_FAILS ? Date.now() + Math.min(60, 2 ** (fails - MAX_FAILS + 1)) * 60000 : 0;
  write({ ...s, fails, lockUntil });
  return false;
}

// Change the password. Needs the current one; the caller issues a new recovery key.
export async function changeModAccessPassword(current, next) {
  if (!(await verifyModAccessPassword(current))) throw new ModAccessError("That isn't the current mod access password.");
  await setModAccessPassword(next);
}

export function setAllowedRoles(roles) {
  const s = read();
  if (!s?.hash) throw new ModAccessError("Set a mod access password first.");
  const clean = [...new Set((roles || []).map((r) => String(r).trim()).filter(Boolean))].slice(0, 20);
  write({ ...s, roles: clean });
}

export function removeModAccessPassword() {
  try { localStorage.removeItem(LS_KEY); } catch { /* storage off */ }
}

// ---- the role gate ---------------------------------------------------------

const norm = (r) => String(r || "").trim().toLowerCase();

// Alters allowed to open the gate who are {{fronting}} right now. When the
// allowed list is empty the role check is off and this returns null.
export async function gateKeepersFronting() {
  const roles = getAllowedRoles().map(norm).filter(Boolean);
  if (!roles.length) return null;
  const [alters, sessions] = await Promise.all([
    localEntities.Alter.list(),
    localEntities.FrontingSession.filter({ is_active: true }),
  ]);
  const live = new Set(
    sessions.filter((s) => !s.end_time).map((s) => s.alter_id || s.primary_alter_id).filter(Boolean),
  );
  return alters.filter((a) => live.has(a.id) && !a.is_archived && roles.includes(norm(a.role)));
}

// Error text may carry {{fronting}}-style placeholders: screens resolve them
// with applyModTerms; mods are only ever told the neutral broker message.
export async function assertRoleGate() {
  const keepers = await gateKeepersFronting();
  if (keepers === null) return;
  if (!keepers.length) {
    throw new ModAccessError(`Only ${getAllowedRoles().join(" / ")} can allow this, and none of them is {{fronting}} right now.`);
  }
}
