// One sound at a time. Every audio / video player (chat attachments, the Assets
// viewer, the home-screen song widget) registers its element here. When one
// starts playing, every other registered element is paused, so two tracks never
// talk over each other. Playback only — nothing is ever changed in the files.
//
// "Quiet" includes other apps (see otherAudio.js).
//
// The song widget can also ask to be told when the app goes quiet
// (`subscribeIdle`) so its "play when there's no sound playing" option can
// start it once the other audio / video stops, pauses or ends.

import { isOtherAudioPlaying, waitForOtherAudioQuiet } from "@/lib/otherAudio";

const playing = new Set();
const all = new Set();
const idleListeners = new Set();

// "Play inside the app only" (Settings → Accessibility): while the app is away
// (Home, Recents) nothing is allowed to make sound. playInsideOnly.js turns
// this on when the app is left and off when it comes back.
let blocked = false;
export const setPlaybackBlocked = (v) => { blocked = !!v; };
export const isPlaybackBlocked = () => blocked;

const notifyIdleIfQuiet = () => {
  if (playing.size || blocked) return;
  // Defer: a track ending and the next one starting in the same tick shouldn't
  // let the widget sneak in between.
  setTimeout(() => {
    if (playing.size || blocked || !idleListeners.size) return;
    // "Quiet" means the whole phone, not just this app: if Facebook, the
    // Gallery or a music player is playing, wait for it to stop (the app
    // may be in the background by then) and try again.
    isOtherAudioPlaying().then((busy) => {
      if (playing.size) return;
      if (busy) { waitForOtherAudioQuiet().then(notifyIdleIfQuiet); return; }
      for (const fn of [...idleListeners]) { try { fn(); } catch { /* listener failed */ } }
    });
  }, 250);
};

// Chat, bulletin and Assets players: when another app (Facebook, the Gallery, a
// music player) takes the sound and the phone pauses ours, carry on from the
// same spot once that app has stopped. A pause the person made themselves (a
// tap just before) or that we made so one sound plays at a time is left alone.
// Songs are handled by the idle listeners above, so detached elements skip this.
let lastTouchAt = 0;
if (typeof window !== "undefined") {
  const touched = () => { lastTouchAt = Date.now(); };
  window.addEventListener("pointerdown", touched, true);
  window.addEventListener("keydown", touched, true);
}
const ourPause = new Set();
const interrupted = new Set();
let resuming = false;
const resumeInterrupted = () => {
  resuming = false;
  const list = [...interrupted];
  interrupted.clear();
  if (playing.size) return; // something else is playing now — leave it
  for (const el of list) {
    if (all.has(el) && el.paused && !el.ended) { el.play().catch(() => {}); break; }
  }
};

// Pause every registered player that is sounding right now. These pauses are
// ours, so the "another app took the sound — carry on later" logic ignores them.
export function pauseAllMedia() {
  for (const el of [...all]) {
    try { if (!el.paused) { ourPause.add(el); el.pause(); } } catch { /* already gone */ }
  }
}

// Back in the app: let a song set to start when nothing is playing do so now.
export const resumeIdleSongs = () => notifyIdleIfQuiet();

export function registerMedia(el, { exclusive = true } = {}) {
  if (!el) return () => {};
  all.add(el);
  const onPlay = () => {
    // The app is away and the person asked for sound to stay inside it: stop
    // whatever tried to start (a song waiting for quiet, a resume, a loop).
    if (blocked) { ourPause.add(el); try { el.pause(); } catch { /* already gone */ } return; }
    playing.add(el);
    interrupted.delete(el);
    if (!exclusive) return;
    for (const other of [...playing]) {
      if (other !== el) { ourPause.add(other); try { other.pause(); } catch { /* already gone */ } }
    }
  };
  const onPauseEv = () => {
    if (ourPause.delete(el) || el.ended || !el.isConnected) return;
    if (Date.now() - lastTouchAt < 1000) return; // the person paused it
    setTimeout(() => {
      if (!all.has(el) || !el.paused || el.ended || playing.size) return;
      isOtherAudioPlaying().then((busy) => {
        if (!busy || !all.has(el) || !el.paused) return;
        interrupted.add(el);
        if (!resuming) { resuming = true; waitForOtherAudioQuiet().then(resumeInterrupted); }
      });
    }, 300);
  };
  const onStop = () => { playing.delete(el); notifyIdleIfQuiet(); };
  el.addEventListener("play", onPlay);
  el.addEventListener("playing", onPlay);
  el.addEventListener("pause", onStop);
  el.addEventListener("pause", onPauseEv);
  el.addEventListener("ended", onStop);
  if (!el.paused) onPlay();
  return () => {
    el.removeEventListener("play", onPlay);
    el.removeEventListener("playing", onPlay);
    el.removeEventListener("pause", onStop);
    el.removeEventListener("pause", onPauseEv);
    el.removeEventListener("ended", onStop);
    all.delete(el);
    interrupted.delete(el);
    if (playing.delete(el)) notifyIdleIfQuiet();
  };
}

// True when some registered element other than `except` is playing right now.
export const isOtherPlaying = (except) => [...playing].some((el) => el !== except);

// Called whenever everything has gone quiet. Returns an unsubscribe.
export function subscribeIdle(fn) {
  idleListeners.add(fn);
  // A song that is waiting while another app is already playing has nothing
  // in this app to wait on — watch the phone's audio so it starts when that stops.
  isOtherAudioPlaying().then((busy) => {
    if (busy && idleListeners.has(fn)) waitForOtherAudioQuiet().then(notifyIdleIfQuiet);
  });
  return () => idleListeners.delete(fn);
}
