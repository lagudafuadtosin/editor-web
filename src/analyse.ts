import { AudioBufferSink, CanvasSink } from 'mediabunny'
import type { OpenedMedia } from './media'

// Reading a clip's own sound and picture: where the beats fall, and where the scene changes.
// Both run on this PC, on the clip's stretch of the file only.

// Beats: how loud the sound gets moment to moment, where it jumps up (onsets), the tempo that fits those jumps
// best, and the beat times on that tempo lined up with the strongest onsets. Times are in the file's seconds.
export async function findBeats(media: OpenedMedia, from: number, to: number): Promise<{ beats: number[]; bpm: number }> {
  const track = media.audioTrack
  if (!track) throw new Error('this clip has no sound')
  const HOP = 0.01 // seconds per step of the loudness curve
  const energy: number[] = []
  let acc = 0
  let n = 0
  let stepLen = 0
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(from, to)) {
    const rate = buffer.sampleRate
    stepLen = Math.round(rate * HOP)
    const a = Math.max(0, Math.round((from - timestamp) * rate))
    const b = Math.min(buffer.length, Math.round((to - timestamp) * rate))
    const ch = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))]
    for (let i = a; i < b; i++) {
      const v = (ch[0][i] + ch[1][i]) / 2
      acc += v * v
      if (++n === stepLen) {
        energy.push(Math.sqrt(acc / n))
        acc = 0
        n = 0
      }
    }
  }
  if (energy.length < 200) throw new Error('the clip is too short to find a beat (2 seconds at least)')
  // Onset strength: how much louder than a moment ago, in log terms so quiet and loud songs behave alike.
  const log = energy.map((e) => Math.log(1e-4 + e))
  const onset = log.map((v, i) => (i < 3 ? 0 : Math.max(0, v - Math.max(log[i - 1], log[i - 2], log[i - 3]))))
  // Tempo: the gap between beats (0.33 to 1 s, 60 to 180 BPM) at which the onsets repeat most.
  let best = 0
  let bestLag = 50
  for (let lag = 33; lag <= 100; lag++) {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag]
    // A small lean towards 90 to 140 BPM, where most music sits, so half and double tempos lose ties.
    const bpm = 60 / (lag * HOP)
    s *= 1 + 0.15 * Math.exp(-(((bpm - 115) / 40) ** 2))
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  // Phase: which offset into the first beat gap lines the beat grid up with the most onset strength.
  let bestPhase = 0
  let bestSum = -1
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0
    for (let i = ph; i < onset.length; i += bestLag) s += onset[i]
    if (s > bestSum) {
      bestSum = s
      bestPhase = ph
    }
  }
  const beats: number[] = []
  for (let i = bestPhase; i < onset.length; i += bestLag) beats.push(from + i * HOP)
  return { beats, bpm: Math.round(60 / (bestLag * HOP)) }
}

// Scene changes: small pictures five times a second, compared by their spread of brightness and colour.
// A jump much bigger than the usual frame-to-frame change is a cut. Times are in the file's seconds.
export async function findCuts(media: OpenedMedia, from: number, to: number, onProgress: (f: number) => void): Promise<number[]> {
  const track = media.videoTrack
  if (!track) throw new Error('this clip has no picture')
  const sink = new CanvasSink(track, { width: 48, height: 27, fit: 'fill' })
  const STEP = 0.2
  let next = from
  let prev: Float32Array | null = null
  const diffs: { t: number; d: number }[] = []
  for await (const f of sink.canvases(from, to)) {
    if (f.timestamp < next - 1e-6) continue
    next = f.timestamp + STEP
    const ctx = (f.canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
    const d = ctx.getImageData(0, 0, 48, 27).data
    // 8 brightness bins and 8 bins for each of red and blue.
    const h = new Float32Array(24)
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) >> 5
      h[l]++
      h[8 + (d[i] >> 5)]++
      h[16 + (d[i + 2] >> 5)]++
    }
    const total = d.length / 4
    for (let i = 0; i < 24; i++) h[i] /= total
    if (prev) {
      let s = 0
      for (let i = 0; i < 24; i++) s += Math.abs(h[i] - prev[i])
      diffs.push({ t: f.timestamp, d: s / 3 })
    }
    prev = h
    onProgress((f.timestamp - from) / Math.max(0.01, to - from))
  }
  const sorted = diffs.map((x) => x.d).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const cuts: number[] = []
  for (const x of diffs) {
    if (x.d > 0.35 && x.d > median * 4 && (!cuts.length || x.t - cuts[cuts.length - 1] > 0.6)) cuts.push(x.t)
  }
  onProgress(1)
  return cuts
}
