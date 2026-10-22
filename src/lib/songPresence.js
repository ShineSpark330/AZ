// "Play this song everywhere" support for the Song widget.
//
// A song picked on a widget page, a profile or a page background registers
// here while it's on screen (`registerPageSong`). The app-wide song
// (GlobalSongHost) only plays when NO page song is on screen, so a page with
// its own song always keeps it — the everywhere song never overrides it.
//
// The play position is carried across too, so moving between a page with the
// song widget and the rest of the app doesn't restart the track. Playback
// only — nothing is written to the user's data.

let pageSongs = 0;
const listeners = new Set();
const lastTime = new Map(); // ref -> seconds

const emit = () => { for (const fn of [...listeners]) { try { fn(pageSongs); } catch { /* listener failed */ } } };

export function registerPageSong() {
  pageSongs += 1; emit();
  let done = false;
  return () => { if (done) return; done = true; pageSongs = Math.max(0, pageSongs - 1); emit(); };
}

export const pageSongCount = () => pageSongs;

export function subscribePageSongs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const saveSongTime = (ref, t) => { if (ref && Number.isFinite(t) && t > 0) lastTime.set(ref, t); };
export const takeSongTime = (ref) => (ref && lastTime.has(ref) ? lastTime.get(ref) : 0);

// The first Song widget (on any page of any board) set to play everywhere.
// Reads the stored boards as plain data, so it works from any screen.
export function findEverywhereSong(settingsRow) {
  if (!settingsRow || typeof settingsRow !== "object") return null;
  for (const field of ["ui_v2_home", "experimental_home", "classic_home", "ui_v2_home_desktop"]) {
    const pages = settingsRow[field]?.pages;
    if (!Array.isArray(pages)) continue;
    for (const p of pages) {
      for (const w of Array.isArray(p?.widgets) ? p.widgets : []) {
        const s = w?.widgetId === "song" ? w.settings?.song : null;
        if (s?.ref && s.everywhere === true) return s;
      }
    }
  }
  return null;
}
