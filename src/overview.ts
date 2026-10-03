import { AudioBufferSink, CanvasSink } from 'mediabunny'
import type { Source } from './model'

// What the timeline draws inside a clip: small pictures along it and the sound wave under them.
export type Overview = {
  peaksPerSecond: number
  peaks: Float32Array | null // loudest sample in each slice, 0 to 1
  thumbs: { t: number; img: ImageBitmap | HTMLCanvasElement | OffscreenCanvas }[] // source time and picture, in time order
  thumbAspect: number // width over height
}

export const PEAKS_PER_SECOND = 50

// Each file's sound wave, kept by source id so playback and export can tell when someone is talking.
export const peaksStore = new Map<string, Float32Array>()
export const THUMB_HEIGHT = 48

// Reads the whole file once. Pictures come first so the strip fills in quickly, then the sound.
export async function buildOverview(source: Source, onUpdate: (o: Overview) => void): Promise<void> {
  const { videoTrack, audioTrack, info } = source.media
  const duration = info.duration
  const o: Overview = {
    peaksPerSecond: PEAKS_PER_SECOND,
    peaks: null,
    thumbs: [],
    thumbAspect: info.video ? info.video.width / info.video.height : 16 / 9,
  }

  if (videoTrack) {
    // About one picture every 2 seconds, never more than 300.
    const count = Math.min(300, Math.max(2, Math.ceil(duration / 2)))
    const times = Array.from({ length: count }, (_, i) => (i + 0.5) * (duration / count))
    const sink = new CanvasSink(videoTrack, { height: THUMB_HEIGHT * 2 })
    let i = 0
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (frame) o.thumbs.push({ t: times[i], img: await createImageBitmap(frame.canvas) })
      i++
      if (i % 10 === 0) onUpdate({ ...o, thumbs: o.thumbs.slice() })
    }
    onUpdate({ ...o, thumbs: o.thumbs.slice() })
  }

  if (audioTrack) {
    const peaks = new Float32Array(Math.ceil(duration * PEAKS_PER_SECOND) + 1)
    for await (const { buffer, timestamp } of new AudioBufferSink(audioTrack).buffers()) {
      const rate = buffer.sampleRate
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch)
        for (let s = 0; s < data.length; s++) {
          const slot = Math.floor((timestamp + s / rate) * PEAKS_PER_SECOND)
          const v = Math.abs(data[s])
          if (slot >= 0 && slot < peaks.length && v > peaks[slot]) peaks[slot] = v
        }
      }
    }
    // Scale so the loudest moment fills the band: quiet speech is still easy to read.
    let max = 0
    for (const v of peaks) if (v > max) max = v
    if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = Math.sqrt(peaks[i] / max)
    o.peaks = peaks
    peaksStore.set(source.id, peaks)
    onUpdate({ ...o })
  }
}

// Draws one clip's strip: pictures across the top, the sound wave across the bottom.
export function drawStrip(
  canvas: HTMLCanvasElement,
  o: Overview | undefined,
  inPoint: number,
  outPoint: number,
  cssWidth: number,
  cssHeight: number,
) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.min(8000, Math.round(cssWidth * dpr)))
  const h = Math.round(cssHeight * dpr)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  if (!o) return
  const span = outPoint - inPoint
  // With no pictures (a sound-only track), the wave gets the whole height.
  const thumbH = o.thumbs.length ? Math.round(h * 0.62) : 0
  const waveTop = thumbH
  const waveH = h - thumbH

  // Pictures: one tile per slot, each showing the frame nearest the middle of its slot.
  if (o.thumbs.length) {
    const tileW = Math.max(8, thumbH * o.thumbAspect)
    for (let x = 0; x < w; x += tileW) {
      const t = inPoint + ((x + tileW / 2) / w) * span
      let best = o.thumbs[0]
      for (const th of o.thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th
      ctx.drawImage(best.img, x, 0, tileW, thumbH)
    }
  }

  // Sound wave, centred in the bottom band.
  if (o.peaks) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    const mid = waveTop + waveH / 2
    for (let x = 0; x < w; x++) {
      const t0 = inPoint + (x / w) * span
      const t1 = inPoint + ((x + 1) / w) * span
      let peak = 0
      for (let s = Math.floor(t0 * o.peaksPerSecond); s <= Math.floor(t1 * o.peaksPerSecond); s++) {
        if (s >= 0 && s < o.peaks.length && o.peaks[s] > peak) peak = o.peaks[s]
      }
      const half = Math.max(0.5, peak * (waveH / 2 - 1))
      ctx.fillRect(x, mid - half, 1, half * 2)
    }
  }
}
