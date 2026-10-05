// How loud a mix is, the way TikTok, YouTube and Spotify measure it: integrated loudness in LUFS (ITU-R BS.1770-4).
// K-weighting (a high shelf and a low cut), mean square in 400 ms blocks that overlap by 75%,
// then two gates: blocks quieter than -70 LUFS, and blocks 10 LU below the average, are left out.

export type Meter = { push: (b: AudioBuffer) => void; result: () => { lufs: number; peak: number } }

// The two K-weighting filters as plain biquads, for 48 kHz (the coefficients from the standard).
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] }
const HIGHPASS = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] }

function biquad(c: { b: number[]; a: number[] }) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number) => {
    const y = c.b[0] * x + c.b[1] * x1 + c.b[2] * x2 - c.a[1] * y1 - c.a[2] * y2
    x2 = x1; x1 = x
    y2 = y1; y1 = y
    return y
  }
}

export function loudnessMeter(sampleRate = 48000): Meter {
  if (sampleRate !== 48000) throw new Error('the meter expects 48 kHz')
  const filters = [0, 1].map(() => [biquad(SHELF), biquad(HIGHPASS)])
  const step = Math.round(sampleRate * 0.1) // 100 ms: blocks of four steps, moving one step at a time
  const steps: number[] = [] // sum of squares per 100 ms, both channels added
  let acc = 0
  let n = 0
  let peak = 0
  return {
    push(b: AudioBuffer) {
      const chans = [b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)]
      for (let i = 0; i < b.length; i++) {
        for (let ch = 0; ch < 2; ch++) {
          const x = chans[ch][i]
          peak = Math.max(peak, Math.abs(x))
          const [f1, f2] = filters[ch]
          const y = f2(f1(x))
          acc += y * y
        }
        if (++n === step) {
          steps.push(acc)
          acc = 0
          n = 0
        }
      }
    },
    result() {
      const blocks: number[] = []
      for (let i = 0; i + 4 <= steps.length; i++) blocks.push((steps[i] + steps[i + 1] + steps[i + 2] + steps[i + 3]) / (4 * step))
      const toLufs = (ms: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms))
      const loud = blocks.filter((z) => toLufs(z) > -70)
      if (!loud.length) return { lufs: -Infinity, peak }
      const rel = toLufs(loud.reduce((s, z) => s + z, 0) / loud.length) - 10
      const kept = loud.filter((z) => toLufs(z) > rel)
      return { lufs: toLufs(kept.reduce((s, z) => s + z, 0) / Math.max(1, kept.length)), peak }
    },
  }
}
