import {
  AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  Mp4OutputFormat, Output, QUALITY_HIGH,
} from 'mediabunny'
import type { OpenedMedia } from './media'

// Reverse: a new file, on this PC only, with the clip's stretch of video and sound playing backwards.
// Played backwards live, video stutters (frames are stored to be read forwards), so the reversed copy is made once.
// It works a second at a time from the end, so memory stays small however long the clip is.

export const REVERSE_LIMIT = 180 // seconds

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export async function reverseRange(media: OpenedMedia, from: number, to: number, onProgress: (f: number) => void): Promise<Blob> {
  const length = to - from
  if (length > REVERSE_LIMIT) throw new Error(`reverse works on up to ${REVERSE_LIMIT / 60} minutes at a time; split the clip first`)
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })

  const v = media.videoTrack
  let video: { source: CanvasSource; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; fps: number; sink: CanvasSink } | null = null
  if (v) {
    const scale = Math.min(1, 1920 / Math.max(v.displayWidth, v.displayHeight))
    const width = even(v.displayWidth * scale)
    const height = even(v.displayHeight * scale)
    const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9'], { width, height })
    if (!codec) throw new Error('this computer cannot encode video at this size')
    const canvas = new OffscreenCanvas(width, height)
    const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 1 })
    const fps = Math.min(60, Math.max(15, Math.round(media.info.video?.fps || 30)))
    output.addVideoTrack(source, { frameRate: fps })
    video = { source, canvas, ctx: canvas.getContext('2d')!, fps, sink: new CanvasSink(v, { width, height, fit: 'fill' }) }
  }

  let audio: { source: AudioBufferSource; sink: AudioBufferSink } | null = null
  if (media.audioTrack) {
    const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 })
    if (codec) {
      const source = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH })
      output.addAudioTrack(source)
      audio = { source, sink: new AudioBufferSink(media.audioTrack) }
    }
  }
  await output.start()

  // Sound: read the stretch, turn it round, and hand it over a second at a time.
  if (audio) {
    const chunks: { data: Float32Array[]; rate: number; at: number }[] = []
    let rate = 48000
    for await (const { buffer, timestamp } of audio.sink.buffers(from, to)) {
      rate = buffer.sampleRate
      const a = Math.max(0, Math.round((from - timestamp) * rate))
      const b = Math.min(buffer.length, Math.round((to - timestamp) * rate))
      if (b <= a) continue
      const chans = [0, 1].map((c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice(a, b))
      chunks.push({ data: chans, rate, at: timestamp + a / rate })
    }
    const total = chunks.reduce((n, c) => n + c.data[0].length, 0)
    const all = [new Float32Array(total), new Float32Array(total)]
    let o = 0
    for (const c of chunks) {
      all[0].set(c.data[0], o)
      all[1].set(c.data[1], o)
      o += c.data[0].length
    }
    all[0].reverse()
    all[1].reverse()
    for (let i = 0; i < total; i += rate) {
      const n = Math.min(rate, total - i)
      const b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: rate })
      b.copyToChannel(all[0].subarray(i, i + n), 0)
      b.copyToChannel(all[1].subarray(i, i + n), 1)
      await audio.source.add(b)
    }
  }

  // Picture: one second at a time from the end. Output frame k shows the source frame at (to - k / fps).
  if (video) {
    const step = 1 / video.fps
    const count = Math.max(1, Math.round(length * video.fps))
    let k = 0
    for (let s1 = to; s1 > from + 1e-6 && k < count; s1 -= 1) {
      const s0 = Math.max(from, s1 - 1)
      const frames: { t: number; img: ImageBitmap }[] = []
      for await (const f of video.sink.canvases(Math.max(0, s0 - step), s1)) frames.push({ t: f.timestamp, img: await createImageBitmap(f.canvas) })
      while (k < count) {
        const want = to - k * step - 1e-6
        if (want < s0 - 1e-6) break
        // The last frame that starts at or before this moment.
        let pick = frames[0]
        for (const fr of frames) if (fr.t <= want) pick = fr
        if (pick) {
          video.ctx.drawImage(pick.img, 0, 0, video.canvas.width, video.canvas.height)
          await video.source.add(k * step, step)
        }
        k++
        onProgress(k / count)
      }
      for (const fr of frames) fr.img.close()
    }
  }
  await output.finalize()
  onProgress(1)
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' })
}
