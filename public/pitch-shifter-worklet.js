// Pitch shifter for the audio / video players (Web Audio AudioWorklet).
//
// PLAYBACK ONLY — it only changes the sound coming out of the speakers right
// now; the stored file is never touched.
//
// How it works (WSOLA time-stretch + resample):
//   1. Stretch the sound in time by `ratio` WITHOUT changing its pitch — short
//      overlapping grains are laid down on a fixed grid, each taken from the
//      input at the spot that best lines up with the one before it (so the
//      waves join smoothly instead of buzzing).
//   2. Read the stretched sound back at `ratio`× speed. That brings the
//      duration back to normal and multiplies every pitch by `ratio`.
// The player's own playbackRate then supplies the tempo, with the browser's
// built-in pitch correction OFF — tempo and pitch are each made by one clean
// step instead of the phone's built-in speed-change.
//
// The core class has no Web Audio dependency so it can be tested in Node.

class WsolaShifter {
  constructor(sampleRate, channels) {
    const k = sampleRate / 48000;
    this.channels = channels;
    this.N = Math.max(256, Math.round((1536 * k) / 2) * 2); // grain length
    this.Hs = this.N / 2;                                    // synthesis hop (50% overlap)
    this.D = Math.max(32, Math.round(384 * k));               // search reach either side
    this.XL = 1 << 15;
    this.YL = 1 << 14;
    this.x = []; this.y = [];
    for (let c = 0; c < channels; c++) { this.x.push(new Float32Array(this.XL)); this.y.push(new Float32Array(this.YL)); }
    this.mono = new Float32Array(this.XL);
    this.win = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N); // periodic Hann
    this.inPos = 0;        // input samples received
    this.frame = 0;        // grains laid down
    this.anaPos = 0;       // nominal start of the next grain in the input
    this.prevP = 0;        // where the last grain actually started
    this.finalized = 0;    // y samples that are complete (no more overlap to add)
    this.r = this.Hs;      // read position in y
    this.started = false;
  }

  // Score how well x[cand..] continues from the template, over `len` samples.
  _score(tStart, cand, len, stride) {
    const m = this.mono, mask = this.XL - 1;
    let dot = 0, e = 0;
    for (let i = 0; i < len; i += stride) {
      const a = m[(tStart + i) & mask], b = m[(cand + i) & mask];
      dot += a * b; e += b * b;
    }
    return dot / Math.sqrt(e + 1e-9);
  }

  _grain(s) {
    const { N, Hs, D, XL, YL } = this;
    const nominal = Math.round(this.anaPos);
    if (this.inPos < nominal + D + N + 4) return false; // wait for enough input
    let p = nominal;
    if (this.frame > 0) {
      const tStart = this.prevP + Hs;
      const lo = Math.max(-D, -nominal), hi = D;
      let best = -Infinity, bestD = 0;
      for (let d = lo; d <= hi; d += 4) {
        const sc = this._score(tStart, nominal + d, Hs, 4);
        if (sc > best) { best = sc; bestD = d; }
      }
      let best2 = -Infinity, bestD2 = bestD;
      for (let d = Math.max(lo, bestD - 3); d <= Math.min(hi, bestD + 3); d++) {
        const sc = this._score(tStart, nominal + d, Hs, 2);
        if (sc > best2) { best2 = sc; bestD2 = d; }
      }
      p = nominal + bestD2;
    }
    const yBase = this.frame * Hs, ym = YL - 1, xm = XL - 1;
    for (let c = 0; c < this.channels; c++) {
      const y = this.y[c], x = this.x[c];
      // The second half is brand new; the first half already holds the last grain's tail.
      for (let i = Hs; i < N; i++) y[(yBase + i) & ym] = 0;
      for (let i = 0; i < N; i++) y[(yBase + i) & ym] += this.win[i] * x[(p + i) & xm];
    }
    this.prevP = p;
    this.finalized = (this.frame + 1) * Hs;
    this.frame += 1;
    this.anaPos += Hs / s;
    return true;
  }

  // inChans: array of Float32Array (may be empty = silence); outChans: array to fill.
  process(inChans, outChans, ratio) {
    const n = outChans[0].length;
    const s = Math.min(5, Math.max(0.2, ratio || 1));
    const xm = this.XL - 1;
    const nIn = inChans ? inChans.length : 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < this.channels; c++) {
        const src = nIn ? inChans[Math.min(c, nIn - 1)] : null;
        const v = src ? src[i] : 0;
        this.x[c][(this.inPos + i) & xm] = v;
        sum += v;
      }
      this.mono[(this.inPos + i) & xm] = sum / this.channels;
    }
    this.inPos += n;
    while (this._grain(s)) { /* lay down every grain the input now allows */ }

    const ym = this.YL - 1;
    if (!this.started && this.finalized - this.r >= this.Hs) this.started = true;
    for (let i = 0; i < n; i++) {
      const i0 = Math.floor(this.r);
      if (!this.started || i0 + 2 >= this.finalized) {
        for (let c = 0; c < outChans.length; c++) outChans[c][i] = 0;
        continue;
      }
      const f = this.r - i0;
      for (let c = 0; c < outChans.length; c++) {
        const y = this.y[Math.min(c, this.channels - 1)];
        const a = y[(i0 - 1) & ym], b = y[i0 & ym], cc = y[(i0 + 1) & ym], d = y[(i0 + 2) & ym];
        // Catmull-Rom between b and cc.
        outChans[c][i] = b + 0.5 * f * (cc - a + f * (2 * a - 5 * b + 4 * cc - d + f * (3 * (b - cc) + d - a)));
      }
      this.r += s;
    }
  }
}

if (typeof registerProcessor === "function") {
  class PitchShifterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: "ratio", defaultValue: 1, minValue: 0.2, maxValue: 5, automationRate: "k-rate" }];
    }
    constructor() {
      super();
      this.core = new WsolaShifter(sampleRate, 2);
    }
    process(inputs, outputs, parameters) {
      const out = outputs[0];
      if (!out || !out.length) return true;
      this.core.process(inputs[0] || [], out, parameters.ratio[0]);
      return true;
    }
  }
  registerProcessor("pitch-shifter", PitchShifterProcessor);
}

if (typeof module !== "undefined" && module.exports) module.exports = { WsolaShifter };
