// 12-hour (standard) or 24-hour (military) clock — one app-wide preference.
// Set in Settings → Appearance → Layout. Stored in localStorage and listed in
// BACKUP_LS_KEYS so it rides backups and the local settings mirror.
import { useSyncExternalStore } from "react";

export const TIME_FORMAT_KEY = "symphony_time_format_v1";
const EVENT = "symphony-time-format-changed";

export function getTimeFormat() {
  try { return localStorage.getItem(TIME_FORMAT_KEY) === "24" ? "24" : "12"; } catch { return "12"; }
}

export function setTimeFormat(v) {
  try { localStorage.setItem(TIME_FORMAT_KEY, v === "24" ? "24" : "12"); } catch { /* storage off */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

const subscribe = (cb) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};

// Re-renders the caller when the preference changes.
export function useTimeFormat() {
  return useSyncExternalStore(subscribe, getTimeFormat, () => "12");
}

// Drop-in for toLocaleTimeString: pass any Intl options, the hour cycle follows the preference.
export function formatTime(date, opts = { hour: "2-digit", minute: "2-digit" }, format = getTimeFormat()) {
  return new Date(date).toLocaleTimeString([], { ...opts, hour12: format !== "24" });
}
