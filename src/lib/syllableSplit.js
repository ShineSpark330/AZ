// Splits ONE word into two readable halves at a syllable boundary, so a
// narrow tab can show "Head-" / "space" instead of "Headsp-" / "ace".
// Rules (so each half still sounds like a word piece):
//   • never cut inside a vowel group (ea, ou, oo…) or a digraph/blend (th, sh,
//     ch, ck, ng, st, sp, tr, pl…) — blends stay glued to the vowel after them
//   • a trailing silent "e" (space, note) isn't its own syllable
//   • every half keeps a vowel and has ≥2 letters
//   • of the legal cuts, the one closest to the middle wins
// Compounds and irregular words go in OVERRIDES (lowercase key → cut index).
const VOWELS = "aeiouy";
const OVERRIDES = {
  headspace: 4, headspaces: 4, checkin: 5, checkins: 5, journals: 4, journal: 4,
  history: 3, contacts: 3, contact: 3, reminders: 2, reminder: 2, analytics: 3, activities: 2, safety: 4,
  timeline: 4, settings: 3, calendar: 3, planner: 4, tracking: 5,
};
const BLENDS = new Set([
  "th", "sh", "ch", "ph", "wh", "ck", "ng", "gh",
  "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "tw",
  "sc", "sk", "sl", "sm", "sn", "sp", "st", "sw", "str", "spr", "spl", "scr", "thr", "shr",
]);

const isV = (c) => VOWELS.includes(c.toLowerCase());

export function syllableSplit(word) {
  if (!word || word.length < 5 || /[^A-Za-z]/.test(word)) return null;
  const lower = word.toLowerCase();
  if (OVERRIDES[lower] != null) {
    const i = OVERRIDES[lower];
    return [word.slice(0, i), word.slice(i)];
  }
  // Mark syllable-carrying vowel letters (silent final "e" doesn't count).
  const n = lower.length;
  const silentE = lower.endsWith("e") && n > 2 && !isV(lower[n - 2]);
  const isNucleus = (i) => isV(lower[i]) && !(silentE && i === n - 1);
  // Legal cuts: after index i-1 | before index i, between two nuclei groups.
  const cuts = [];
  let i = 0;
  while (i < n) {
    if (!isNucleus(i)) { i++; continue; }
    let j = i;
    while (j + 1 < n && isNucleus(j + 1)) j++;      // end of this vowel group
    let k = j + 1;
    while (k < n && !isNucleus(k) && !(silentE && k === n - 1 && isV(lower[k]))) k++;
    if (k >= n || !isNucleus(k)) { i = j + 1; if (k >= n) break; continue; }
    const cons = lower.slice(j + 1, k);              // consonants between groups
    let cut;
    if (cons.length === 0) cut = j + 1;              // vowel-vowel: cut between
    else if (cons.length === 1) cut = j + 1;         // V-CV
    else {
      // keep a trailing blend with the next vowel, otherwise split VC-CV
      let keep = 1;
      for (const len of [3, 2]) if (cons.length >= len && BLENDS.has(cons.slice(-len))) { keep = len; break; }
      cut = k - keep;
      if (cut <= j) cut = j + 1;
    }
    cuts.push(cut);
    i = k;
  }
  const ok = cuts.filter((c) => c >= 2 && n - c >= 2);
  if (!ok.length) return null;
  const best = ok.reduce((a, b) => (Math.abs(a - n / 2) <= Math.abs(b - n / 2) ? a : b));
  return [word.slice(0, best), word.slice(best)];
}
