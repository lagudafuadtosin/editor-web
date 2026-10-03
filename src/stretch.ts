// Our own time-stretch: changes the speed of sound without changing the pitch of the voice.
// Method: WSOLA (waveform-similarity overlap-add). The sound is cut into short overlapping slices; slices are
// taken from the input spaced by the speed and laid down in the output at a fixed spacing. Each slice is nudged
// a few milliseconds to where it best matches the end of the previous one, so voices stay smooth.
// Streaming: sound goes in as AudioBuffers in order, stretched sound comes out in order. One per clip.

const FRAME_S = 0.04 // slice length
const SEARCH_S = 0.012 // how far a slice may be nudged to match
const DECIMATE = 4 // the rough match search looks at every 4th sample, then the result is refined

export class VoiceStretch {
  readonly rate: number
  private speed: number
  private n: number // slice length in samples
  private ha: number // output spacing (half a slice)
  private hs: number // input spacing = ha * speed
  private delta: number
  private win: Float32Array
  // Input kept so far: samples from absolute index inStart, inLen of them.
  private inL = new Float32Array(1 << 16)
  private inR = new Float32Array(1 << 16)
  private inStart = 0
  private inLen = 0
  private pos = 0 // where the next slice should come from, in absolute input samples (fractional)
  private prev = -1 // where the previous slice actually came from
  // Overlap-add area for the slice being built, and finished output waiting to be pulled.
  private accL: Float32Array
  private accR: Float32Array
  private outL: number[] = []
  private outR: number[] = []
  private flushed = false

  constructor(speed: number, sampleRate: number) {
    this.rate = sampleRate
    this.speed = speed
    this.n = Math.round(FRAME_S * sampleRate) & ~1
    this.ha = this.n / 2
    this.hs = this.ha * speed
    this.delta = Math.round(SEARCH_S * sampleRate)
    this.win = new Float32Array(this.n)
    for (let i = 0; i < this.n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.n) // Hann: two at half overlap add up to 1
    this.accL = new Float32Array(this.n)
    this.accR = new Float32Array(this.n)
  }

  // Feeds part of a buffer (frames from..to). Mono is treated as stereo.
  push(buffer: AudioBuffer, from = 0, to = buffer.length) {
    const count = Math.max(0, to - from)
    if (!count) return
    this.append(buffer.getChannelData(0).subarray(from, to), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).subarray(from, to))
    this.run()
  }

  // Feeds a little silence so the last of the sound comes out at the end of a clip.
  flush() {
    if (this.flushed) return
    this.flushed = true
    const pad = new Float32Array(this.n * 2 + this.delta * 2)
    this.append(pad, pad)
    this.run()
    for (let i = 0; i < this.ha; i++) {
      this.outL.push(this.accL[i])
      this.outR.push(this.accR[i])
    }
  }

  get available() {
    return this.outL.length
  }

  // Takes up to n frames of stretched sound out, as two channels.
  pull(n = this.available): [Float32Array, Float32Array] {
    const take = Math.min(n, this.available)
    const l = Float32Array.from(this.outL.splice(0, take))
    const r = Float32Array.from(this.outR.splice(0, take))
    return [l, r]
  }

  private append(l: Float32Array, r: Float32Array) {
    const need = this.inLen + l.length
    if (need > this.inL.length) {
      let size = this.inL.length
      while (size < need) size *= 2
      const nl = new Float32Array(size)
      const nr = new Float32Array(size)
      nl.set(this.inL.subarray(0, this.inLen))
      nr.set(this.inR.subarray(0, this.inLen))
      this.inL = nl
      this.inR = nr
    }
    this.inL.set(l, this.inLen)
    this.inR.set(r, this.inLen)
    this.inLen += l.length
  }

  // Mono sample at an absolute input index.
  private mono(i: number) {
    const k = i - this.inStart
    return this.inL[k] + this.inR[k]
  }

  // How alike two stretches of input are (higher is better), comparing every step-th sample.
  private similarity(a: number, b: number, len: number, step: number) {
    let s = 0
    for (let i = 0; i < len; i += step) s += this.mono(a + i) * this.mono(b + i)
    return s
  }

  private run() {
    const end = () => this.inStart + this.inLen
    // Make slices while there is enough input for the slice and its search room.
    while (Math.round(this.pos) + this.delta + this.n + this.ha <= end()) {
      let chosen: number
      const nominal = Math.round(this.pos)
      if (this.prev < 0 || this.speed === 1) {
        chosen = nominal
      } else {
        // The natural continuation of the previous slice, which the new slice should line up with.
        const target = this.prev + this.ha
        const len = this.ha
        const lo = Math.max(this.inStart, nominal - this.delta)
        const hi = nominal + this.delta
        let best = nominal
        let bestScore = -Infinity
        for (let k = lo; k <= hi; k += DECIMATE) {
          const s = this.similarity(target, k, len, DECIMATE)
          if (s > bestScore) {
            bestScore = s
            best = k
          }
        }
        // Refine around the rough best, one sample at a time.
        const center = best
        for (let k = Math.max(lo, center - DECIMATE); k <= Math.min(hi, center + DECIMATE); k++) {
          const s = this.similarity(target, k, len, 2)
          if (s > bestScore) {
            bestScore = s
            best = k
          }
        }
        chosen = best
      }
      // Lay the windowed slice over the overlap area; the first half is then finished.
      const off = chosen - this.inStart
      for (let i = 0; i < this.n; i++) {
        this.accL[i] += this.inL[off + i] * this.win[i]
        this.accR[i] += this.inR[off + i] * this.win[i]
      }
      for (let i = 0; i < this.ha; i++) {
        this.outL.push(this.accL[i])
        this.outR.push(this.accR[i])
      }
      this.accL.copyWithin(0, this.ha)
      this.accR.copyWithin(0, this.ha)
      this.accL.fill(0, this.n - this.ha)
      this.accR.fill(0, this.n - this.ha)
      this.prev = chosen
      this.pos += this.hs
      // Forget input that no future slice or search can reach.
      const keepFrom = Math.min(this.prev, Math.round(this.pos) - this.delta) - DECIMATE
      const drop = keepFrom - this.inStart
      if (drop > 4096) {
        this.inL.copyWithin(0, drop, this.inLen)
        this.inR.copyWithin(0, drop, this.inLen)
        this.inLen -= drop
        this.inStart += drop
      }
    }
  }
}

export function toBuffer([l, r]: [Float32Array, Float32Array], sampleRate: number): AudioBuffer | null {
  if (!l.length) return null
  const b = new AudioBuffer({ length: l.length, numberOfChannels: 2, sampleRate })
  b.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
  b.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
  return b
}
