import { BufferTarget, CanvasSink, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_MEDIUM } from 'mediabunny'
import type { OpenedMedia } from './media'

// Preview copies (proxies): a small, easy-to-decode copy of a big video, used only to play it in the editor.
// Frames keep their own times, so a cut lands on the same frame in the copy and in the original. Export always
// reads the original. No sound: playback takes the sound from the original as before.

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

// Worth making for anything bigger than 1080 on its short side, or very high bitrate.
export function wantsProxy(m: OpenedMedia): boolean {
  const v = m.info.video
  if (!v) return false
  return Math.min(v.width, v.height) > 1080 || (m.info.fileSize * 8) / Math.max(1, m.info.duration) > 25_000_000
}

export async function makeProxy(m: OpenedMedia, onProgress: (f: number) => void): Promise<Blob> {
  const v = m.videoTrack
  if (!v) throw new Error('no picture to copy')
  const scale = 540 / Math.min(v.displayWidth, v.displayHeight)
  const width = even(v.displayWidth * Math.min(1, scale))
  const height = even(v.displayHeight * Math.min(1, scale))
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width, height })
  if (!codec) throw new Error('this computer cannot encode the copy')
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_MEDIUM, keyFrameInterval: 1 })
  output.addVideoTrack(source, { frameRate: Math.min(60, Math.round(m.info.video?.fps || 30)) })
  await output.start()
  const dur = m.info.duration
  for await (const f of new CanvasSink(v, { width, height, fit: 'fill' }).canvases()) {
    ctx.drawImage(f.canvas, 0, 0)
    await source.add(f.timestamp, f.duration)
    onProgress(f.timestamp / Math.max(0.01, dur))
  }
  await output.finalize()
  onProgress(1)
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' })
}
