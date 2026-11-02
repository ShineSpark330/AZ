// Recovery keys — a way back in when a password is forgotten.
//
// One small scheme shared by every password in the app (the app's storage
// password, the mod data-access password, a locked journal entry, the backup
// password). For each "scope" the app makes a random RECOVERY KEY, shows it
// once, and keeps only a sealed envelope: the password, encrypted with a key
// derived from the recovery key (PBKDF2-SHA256 + AES-256-GCM). The recovery
// key is never stored. Typing it later opens the envelope and hands back the
// password, which then unlocks things exactly as if the person had typed it.
//
// Honest limits (also said in the UI):
//   • The recovery key is as powerful as the password. Whoever holds it can
//     open the data. Keep it somewhere safe and separate from the device.
//   • The envelope lives on this device (localStorage), so the key recovers
//     things on this device. A recovery FILE (exportRecoveryFile) carries the
//     envelope too, so it can be used after a browser wipe or on a new device.
//   • Changing a password makes the old envelope useless, so callers clear it
//     and issue a new key (see StorageModeSettings).
//   • 25 random characters from a 32-letter alphabet = 125 bits, so the
//     envelope can't be brute-forced even though it's stored beside the data.

import { KDF_ITERATIONS } from "@/lib/localEncryption";
import { bytesToBase64, base64ToBytes } from "@/lib/base64";

const LS_PREFIX = "symphony_recovery_v1_";
// No 0/O/1/I/L/U so a key read off paper can't be mistyped as a lookalike.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_CHARS = 25;

export class RecoveryError extends Error {
  constructor(message) { super(message); this.name = "RecoveryError"; }
}

// Human-readable: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
export function generateRecoveryKey() {
  const out = [];
  // Rejection sampling so every letter is equally likely (no modulo bias).
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < KEY_CHARS) {
    const buf = crypto.getRandomValues(new Uint8Array(KEY_CHARS * 2));
    for (const b of buf) {
      if (b < limit && out.length < KEY_CHARS) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("").replace(/(.{5})(?=.)/g, "$1-");
}

// Forgiving input: case, spaces, dashes and the easy lookalikes are fixed.
export function normalizeRecoveryKey(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1")
    // ALPHABET has no 0/1, so lookalikes can't be valid characters; map them
    // to a neighbouring valid letter-free form that simply won't match, which
    // keeps a mistyped key failing cleanly rather than throwing.
    .replace(/U/g, "V");
}

async function deriveRecoveryKey(recoveryKey, salt, iterations) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalizeRecoveryKey(recoveryKey)), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

// Seal `secret` (a password) under `recoveryKey`. Returns the envelope.
export async function sealRecoveryEnvelope(secret, recoveryKey) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveRecoveryKey(recoveryKey, salt, KDF_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(String(secret)),
  ));
  return {
    v: 1,
    iter: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}

export async function openRecoveryEnvelope(envelope, recoveryKey) {
  try {
    if (!envelope || envelope.v !== 1) throw new Error("bad envelope");
    const key = await deriveRecoveryKey(recoveryKey, base64ToBytes(envelope.salt), Number(envelope.iter) || KDF_ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, key, base64ToBytes(envelope.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new RecoveryError("That recovery key doesn't match.");
  }
}

// ---- per-scope storage on this device -------------------------------------

export function getRecoveryEnvelope(scope) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + scope);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export const hasRecovery = (scope) => !!getRecoveryEnvelope(scope);

export function clearRecovery(scope) {
  try { localStorage.removeItem(LS_PREFIX + scope); } catch { /* storage off */ }
}

// Make a new recovery key for `scope`, replacing any earlier one. The caller
// must show the returned key to the person — it is not kept anywhere.
export async function createRecovery(scope, password) {
  const recoveryKey = generateRecoveryKey();
  const envelope = await sealRecoveryEnvelope(password, recoveryKey);
  try { localStorage.setItem(LS_PREFIX + scope, JSON.stringify(envelope)); }
  catch { throw new RecoveryError("Couldn't save the recovery data on this device."); }
  return recoveryKey;
}

// Recovery key in, password out. Throws RecoveryError if there's no recovery
// set up for the scope or the key is wrong.
export async function recoverPassword(scope, recoveryKey, envelopeOverride = null) {
  const envelope = envelopeOverride || getRecoveryEnvelope(scope);
  if (!envelope) throw new RecoveryError("No recovery key was set up on this device for this. If you saved a recovery file, choose it instead.");
  return openRecoveryEnvelope(envelope, recoveryKey);
}

// ---- recovery file (for a wiped browser or a new device) -------------------

export function buildRecoveryFile(scope, label, recoveryKey, envelopeOverride = null) {
  const envelope = envelopeOverride || getRecoveryEnvelope(scope);
  const lines = [
    "Apeiron Zetta — recovery key",
    `For: ${label}`,
    `Made: ${new Date().toISOString().slice(0, 10)}`,
    "",
    `RECOVERY KEY:  ${recoveryKey}`,
    "",
    "Keep this somewhere safe and separate from your device. Anyone who has this key",
    "can open what it protects. The app doesn't keep a copy, and nobody can recover it for you.",
    "",
    "--- recovery data (needed only if the app's saved data was wiped) ---",
    JSON.stringify({ scope, envelope }),
  ];
  return new Blob([lines.join("\n")], { type: "text/plain" });
}

// Reads a recovery file's text and returns { scope, envelope } or null.
export function parseRecoveryFile(text) {
  const m = String(text || "").split("\n").find((l) => l.startsWith('{"scope"'));
  if (!m) return null;
  try {
    const o = JSON.parse(m);
    return o && o.envelope && o.envelope.v === 1 ? o : null;
  } catch { return null; }
}
