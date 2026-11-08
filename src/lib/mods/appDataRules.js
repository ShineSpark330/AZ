// What a mod with data:read may see, and how it is cleaned first. Pure (no app
// imports) so it can be tested on its own in node: scripts/test-mod-data-access.mjs.
//
// Rules, whatever a mod asks for:
//   • only the kinds in ACCESSIBLE_ENTITIES, and only the ones the person ticked;
//   • read-only; whispers are masked, locked journal entries keep their
//     contents hidden, device secrets and bookkeeping fields are left out;
//   • System chat: private channels and everything said in them are left out
//     entirely, and so are messages that were deleted.

import { redactWhispers } from "../whisperRedact.js";

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

// Fields that are never handed to a mod even inside an allowed record
// (device secrets and the app's own bookkeeping, plus trash markers).
const STRIP_FIELD = /(^_)|secret|token|password|passphrase|private_key|api_?key|recovery|endpoint|trash|removed_at/i;
const MAX_DEPTH = 6;

function clean(value, depth) {
  if (typeof value === "string") return redactWhispers(value);
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (STRIP_FIELD.test(k)) continue;
    out[k] = clean(v, depth + 1);
  }
  return out;
}

// The copy of one record a mod is given: whispers are masked, secrets and
// bookkeeping fields are left out, and a locked journal entry keeps its
// contents hidden. The original row is never changed.
export function sanitizeRecord(row, entity) {
  if (!row || typeof row !== "object") return row;
  const out = clean(row, 0);
  if (entity === "JournalEntry" && row.is_encrypted) {
    out.content = null;
    out.locked = true;
  }
  return out;
}

// Only kinds in the catalogue above are readable (count-only scopes aside).
export const isReadableEntity = (key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(ACCESSIBLE_ENTITIES, key);

export function privateChannelIdSet(channels) {
  return new Set((channels || []).filter((c) => c && c.is_private).map((c) => c.id));
}

export function visibleRows(entity, rows, { privateChannelIds } = {}) {
  if (entity === "SystemChatChannel") return rows.filter((c) => !c.is_private);
  if (entity === "SystemChatMessage") {
    const hidden = privateChannelIds || new Set();
    return rows.filter((m) => !m.deleted_at && !hidden.has(m.channel_id));
  }
  return rows;
}

// For count-only access: how many records, and how many of them are still
// "live" (not archived or deleted).
export function countRows(rows) {
  const live = rows.filter((r) => !r.is_archived && !r.deleted_at);
  return { total: rows.length, active: live.length };
}
