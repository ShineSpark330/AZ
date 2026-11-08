// Tests for what a mod is given by symphony.appData (src/lib/mods/appDataRules.js)
// and how a mod file's dataScopes are read (modPackage.parseModFile).
// Run: node scripts/test-mod-data-access.mjs
import assert from "node:assert/strict";
import { sanitizeRecord, isReadableEntity, ACCESSIBLE_ENTITIES as READABLE_DATA, isDataScope, visibleRows, countRows } from "../src/lib/mods/appDataRules.js";
import { parseModFile, MOD_FORMAT } from "../src/lib/mods/modPackage.js";

const sanitizeForMod = (entity, row) => sanitizeRecord(row, entity);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("whispers are masked, including inside nested payloads", () => {
  const row = {
    id: "j1",
    content: 'Hello <span class="whisper" data-whisper-for="a1">the secret</span> world',
    note: JSON.stringify([{ text: '<span class="whisper">hidden</span> shown' }]),
  };
  const out = sanitizeForMod("JournalEntry", row);
  assert.ok(!out.content.includes("the secret"));
  assert.ok(!out.note.includes("hidden"));
  assert.ok(out.note.includes("shown"));
});

t("locked journal entries keep their contents hidden", () => {
  const out = sanitizeForMod("JournalEntry", { id: "j2", title: "x", content: "CIPHERTEXT", is_encrypted: true });
  assert.equal(out.content, null);
  assert.equal(out.locked, true);
});

t("bookkeeping and secret-looking fields are left out", () => {
  const out = sanitizeForMod("Alter", { id: "a", name: "A", _ft: { name: 1 }, api_key: "k", relay_secret: "s", trashed_at: "t", nested: { password: "p", ok: 1 } });
  assert.deepEqual(Object.keys(out).sort(), ["id", "name", "nested"]);
  assert.deepEqual(out.nested, { ok: 1 });
});

t("the original row is not changed", () => {
  const row = { id: "x", _ft: {}, content: '<span class="whisper">s</span>' };
  sanitizeForMod("StatusNote", row);
  assert.ok("_ft" in row && row.content.includes(">s<"));
});

t("only catalogued kinds are readable", () => {
  for (const k of Object.keys(READABLE_DATA)) assert.ok(isReadableEntity(k));
  for (const k of ["SystemSettings", "FriendIdentity", "PushSubscription", "ModData", "ModPackage", "AlterMessage", "ChatMessage", "toString", "__proto__"]) {
    assert.equal(isReadableEntity(k), false, k);
  }
});

const file = (extra) => JSON.stringify({
  format: MOD_FORMAT, formatVersion: 1, id: "test-mod", name: "Test", version: "1.0.0",
  pages: [{ id: "main", title: "Main" }], code: "symphony.registerPage('main', () => {})", ...extra,
});

t("dataScopes are kept only with data:read, and only known kinds", () => {
  const a = parseModFile(file({ permissions: ["data:read"], dataScopes: ["JournalEntry", "SystemSettings", "JournalEntry", 5] }));
  assert.deepEqual(a.dataScopes, ["JournalEntry"]);
  const b = parseModFile(file({ permissions: [], dataScopes: ["JournalEntry"] }));
  assert.deepEqual(b.dataScopes, []);
});

t("pictures:save is a known permission", () => {
  assert.deepEqual(parseModFile(file({ permissions: ["pictures:save"] })).permissions, ["pictures:save"]);
});

t("files:save is a known permission", () => {
  assert.deepEqual(parseModFile(file({ permissions: ["files:save"] })).permissions, ["files:save"]);
});

t("count-only scopes are known, and private chat is never visible", () => {
  assert.equal(isDataScope("count:Alter"), true);
  assert.equal(isDataScope("count:SystemSettings"), false);
  const chans = [{ id: "c1", is_private: false }, { id: "c2", is_private: true }];
  assert.deepEqual(visibleRows("SystemChatChannel", chans).map((c) => c.id), ["c1"]);
  const msgs = [{ id: "m1", channel_id: "c1" }, { id: "m2", channel_id: "c2" }, { id: "m3", channel_id: "c1", deleted_at: "x" }];
  assert.deepEqual(visibleRows("SystemChatMessage", msgs, { privateChannelIds: new Set(["c2"]) }).map((m) => m.id), ["m1"]);
  assert.deepEqual(countRows([{ id: 1 }, { id: 2, is_archived: true }]), { total: 2, active: 1 });
});

t("apps:launch and templates are read from a mod file", () => {
  const m = parseModFile(file({ permissions: ["apps:launch"], template: [{ collection: "x", a: 1 }, { nope: 1 }] }));
  assert.deepEqual(m.permissions, ["apps:launch"]);
  assert.deepEqual(m.template, [{ collection: "x", a: 1 }]);
});

console.log(`\n${n} passed`);
