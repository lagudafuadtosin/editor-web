import {
  AudioBufferSink, AudioBufferSource, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  MkvOutputFormat, MovOutputFormat, Mp4OutputFormat, Output, Quality, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH, StreamTarget,
  WavOutputFormat, WebMOutputFormat, canEncodeVideo,
  type AudioCodec, type OutputFormat, type StreamTargetChunk, type VideoCodec, type WrappedCanvas,
} from 'mediabunny'
import { compose, type Layer } from './compose'
import { pictureOf } from './images'
import { LookRenderer } from './look'
import { activeVideo, duration, layout, nextOf, shown, sourceAt, speedOf, transAt, type Frame, type Placed, type Project, type Source } from './model'
import { applyGain, musicLevel } from './sound'
import { sampleAt } from './motion'
import { trackedPoint } from './model'
import { buildChain, hasChain, pitchPlan, tailOf } from './sfx'
import { VoiceStretch } from './stretch'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'

export type Container = 'mp4' | 'mov' | 'webm' | 'mkv' | 'm4a' | 'wav' | 'gif'

export type ExportSettings = {
  container: Container
  fps: number | 'original'
  // Size of the short side: 480, 720, 1080, 1440 or 2160. The shape is the project's frame.
  resolution: number
  // "More options". All optional: an export without them is the same as before.
  quality?: 'low' | 'medium' | 'high' | 'best'
  codec?: 'auto' | 'avc' | 'hevc' | 'av1' | 'vp9'
  targetMB?: number | null // squeeze the file to about this size
  range?: [number, number] | null // only this part of the edit, in seconds
  transparent?: boolean // see-through where nothing is drawn (WebM or MKV with VP9), for titles and overlays
}

export const CONTAINERS: { id: Container; label: string; ext: string; mime: string; audioOnly?: boolean }[] = [
  { id: 'mp4', label: 'MP4 (TikTok, phones, everywhere)', ext: '.mp4', mime: 'video/mp4' },
  { id: 'mov', label: 'MOV (Apple)', ext: '.mov', mime: 'video/quicktime' },
  { id: 'webm', label: 'WebM (web)', ext: '.webm', mime: 'video/webm' },
  { id: 'mkv', label: 'MKV', ext: '.mkv', mime: 'video/x-matroska' },
  { id: 'm4a', label: 'Audio only, M4A', ext: '.m4a', mime: 'audio/mp4', audioOnly: true },
  { id: 'wav', label: 'Audio only, WAV', ext: '.wav', mime: 'audio/wav', audioOnly: true },
  { id: 'gif', label: 'GIF (short, no sound)', ext: '.gif', mime: 'image/gif' },
]

export const RESOLUTIONS = [480, 720, 1080, 1440, 2160]

function formatFor(c: Container): OutputFormat {
  switch (c) {
    case 'mp4': case 'm4a': return new Mp4OutputFormat()
    case 'mov': return new MovOutputFormat()
    case 'webm': return new WebMOutputFormat()
    case 'mkv': return new MkvOutputFormat()
    case 'wav': return new WavOutputFormat()
    case 'gif': throw new Error('a GIF is written by its own encoder')
  }
}

const VIDEO_PREF: Record<Container, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'], mov: ['avc', 'hevc'], mkv: ['avc', 'hevc', 'vp9', 'av1'], webm: ['vp9', 'vp8', 'av1'], m4a: [], wav: [], gif: [],
}
const AUDIO_PREF: Record<Container, AudioCodec[]> = {
  mp4: ['aac', 'opus'], mov: ['aac'], mkv: ['aac', 'opus'], webm: ['opus', 'vorbis'], m4a: ['aac'], wav: ['pcm-s16'], gif: [],
}
// Which codecs each format can hold, for the codec choice in More options.
export const CODECS_FOR: Record<Container, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'], mov: ['avc', 'hevc'], mkv: ['avc', 'hevc', 'av1', 'vp9'], webm: ['vp9', 'av1'], m4a: [], wav: [], gif: [],
}
const QUALITY = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, best: QUALITY_VERY_HIGH }
const AUDIO_KBPS = 128

// Whether this PC can make each codec at a size, for greying out what it cannot do.
export async function encodableCodecs(width: number, height: number): Promise<Set<VideoCodec>> {
  const out = new Set<VideoCodec>()
  for (const c of ['avc', 'hevc', 'av1', 'vp9'] as VideoCodec[]) if (await canEncodeVideo(c, { width, height }).catch(() => false)) out.add(c)
  return out
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

// The short side gets the chosen size, the long side follows the project's frame shape.
export function outputSize(frame: Frame, resolution: number): [number, number] {
  const s = resolution / Math.min(frame.w, frame.h)
  return [even(frame.w * s), even(frame.h * s)]
}

const SAMPLE_RATE = 48000

export async function exportProject(
  sources: Source[],
  project: Project,
  settings: ExportSettings,
  writable: WritableStream<StreamTargetChunk>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const container = CONTAINERS.find((c) => c.id === settings.container)!
  // The stretch of the edit to export: all of it, or the part chosen in More options.
  const [t0, t1] = settings.range ?? [0, duration(project)]
  const total = Math.max(0.05, t1 - t0)
  if (settings.container === 'gif') return exportGif(sources, project, settings, t0, total, writable, onProgress, signal)
  const output = new Output({ format: formatFor(settings.container), target: new StreamTarget(writable, { chunked: true }) })

  let video: { source: { add: (t: number, d: number) => Promise<unknown> }; canvas: OffscreenCanvas; fps: number } | null = null
  if (!container.audioOnly) {
    const [width, height] = outputSize(project.frame, settings.resolution)
    const firstFps = sources.find((s) => s.media.info.video)?.media.info.video?.fps ?? 30
    const fps = settings.fps === 'original' ? Math.min(60, Math.max(24, Math.round(firstFps))) : settings.fps
    const wanted = settings.transparent ? ['vp9' as VideoCodec] : settings.codec && settings.codec !== 'auto' ? [settings.codec as VideoCodec] : VIDEO_PREF[settings.container]
    if (settings.transparent && settings.container !== 'webm' && settings.container !== 'mkv') throw new Error('a see-through export needs WebM or MKV')
    const codec = await getFirstEncodableVideoCodec(wanted, { width, height })
    if (!codec) {
      throw new Error(settings.codec && settings.codec !== 'auto'
        ? `this computer cannot make ${settings.codec.toUpperCase()} video at ${width} × ${height}. Choose Automatic or a smaller size`
        : `this computer cannot encode ${width} × ${height} video for ${container.ext}. Try a smaller size`)
    }
    // A target size sets the bitrate: the size in bits spread over the length, less the sound's share, held steady
    // (constant) so busy scenes cannot spend more than their share and overshoot it.
    const targetBits = settings.targetMB ? Math.max(250_000, Math.round(((settings.targetMB * 8_000_000 * 0.96) / total) - AUDIO_KBPS * 1000)) : 0
    const bitrate = targetBits ? new Quality({ bitrate: targetBits, bitrateMode: 'constant' }) : QUALITY[settings.quality ?? 'high']
    const canvas = new OffscreenCanvas(width, height)
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, ...(settings.transparent ? { alpha: 'keep' as const } : {}) })
    output.addVideoTrack(source, { frameRate: fps })
    video = { source, canvas, fps }
  }

  const hasSound = layout(project).some((pl) => pl.clip.kind === 'media' && sources.find((s) => s.id === pl.clip.sourceId)?.media.audioTrack)
  let audio: AudioBufferSource | null = null
  if (hasSound || container.audioOnly) {
    const codec = await getFirstEncodableAudioCodec(AUDIO_PREF[settings.container], { numberOfChannels: 2, sampleRate: SAMPLE_RATE })
    if (codec) {
      audio = new AudioBufferSource({ codec, bitrate: settings.targetMB ? AUDIO_KBPS * 1000 : QUALITY_HIGH })
      output.addAudioTrack(audio)
    } else if (container.audioOnly) {
      throw new Error(`this browser cannot encode audio for ${container.ext}`)
    }
  }

  await output.start()
  const progress = { video: video ? 0 : 1, audio: audio ? 0 : 1 }
  const report = () => onProgress(Math.min(progress.video, progress.audio))
  try {
    await Promise.all([
      video && renderVideo(video, project, sources, total, signal, (f) => { progress.video = f; report() }, t0, !!settings.transparent),
      audio && renderAudio(audio, project, sources, t1, signal, (f) => { progress.audio = f; report() }, t0),
    ])
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  }
}

// Every output frame: the layers showing at that moment, each from its own decoder, drawn bottom up.
async function renderVideo(
  v: { source: { add: (t: number, d: number) => Promise<unknown> }; canvas: OffscreenCanvas; fps: number },
  project: Project,
  sources: Source[],
  total: number,
  signal: AbortSignal,
  onProgress: (f: number) => void,
  from = 0, // where on the timeline the export starts; frames are stamped from 0
  transparent = false,
) {
  const ctx = v.canvas.getContext('2d')!
  const scale = v.canvas.width / project.frame.w
  const renderer = new LookRenderer()
  const byId = new Map(sources.map((s) => [s.id, s]))
  type Reader = { frames: AsyncGenerator<WrappedCanvas, void, unknown>; current: WrappedCanvas | null; next: WrappedCanvas | null }
  const readers = new Map<string, Reader>()
  const count = Math.max(1, Math.round(total * v.fps))
  const all = shown(project)
  // A source time kept inside its file: a transition reaching past either end holds the first or last frame.
  const clampSrc = (sourceId: string, s: number) => Math.max(0, Math.min(s, (byId.get(sourceId)?.media.info.duration ?? Infinity) - 0.001))

  for (let i = 0; i < count; i++) {
    if (signal.aborted) break
    const t = from + i / v.fps
    const active = activeVideo(project, t)
    // Close readers for clips that have finished.
    for (const [id, r] of readers) {
      if (!active.some((pl) => pl.clip.id === id)) {
        await r.frames.return(undefined)
        readers.delete(id)
      }
    }
    const layers: Layer[] = []
    for (const pl of active) {
      const timing = { local: t - pl.start, length: pl.end - pl.start, trans: transAt(pl, t, nextOf(all, pl)), level: musicLevel(project, t),
        follow: pl.clip.follow ? trackedPoint(project, sources, pl.clip.follow.clip, t, sampleAt) : null }
      if (pl.clip.kind === 'image') {
        layers.push({ clip: pl.clip, img: pictureOf(pl.clip, t - pl.start), ...timing })
        continue
      }
      if (pl.clip.kind !== 'media') {
        layers.push({ clip: pl.clip, img: null, ...timing })
        continue
      }
      const track = byId.get(pl.clip.sourceId!)?.media.videoTrack
      if (!track) continue
      const srcT = clampSrc(pl.clip.sourceId!, sourceAt(pl.clip, t - pl.start))
      let r = readers.get(pl.clip.id)
      if (!r) {
        const frames = new CanvasSink(track).canvases(srcT, clampSrc(pl.clip.sourceId!, sourceAt(pl.clip, pl.end - pl.start + pl.post)))
        r = { frames, current: null, next: (await frames.next()).value ?? null }
        readers.set(pl.clip.id, r)
      }
      // Advance to the last source frame that starts at or before this moment.
      while (r.next && r.next.timestamp <= srcT + 1e-6) {
        r.current = r.next
        r.next = (await r.frames.next()).value ?? null
      }
      layers.push({ clip: pl.clip, img: (r.current ?? r.next)?.canvas ?? null, ...timing })
    }
    compose(ctx, project.frame, scale, layers, sources, renderer, project.luts, transparent)
    await v.source.add(i / v.fps, 1 / v.fps)
    onProgress(i / count)
  }
  for (const r of readers.values()) await r.frames.return(undefined)
  onProgress(1)
}

// Mixes every clip's sound, a few seconds at a time, with the browser's own mixer (OfflineAudioContext),
// which also converts any sample rate to the file's rate.
// Also used to measure loudness: `out` only has to take the mixed sound a few seconds at a time.
export async function renderAudio(
  out: { add: (b: AudioBuffer) => Promise<unknown> },
  project: Project,
  sources: Source[],
  total: number, // where the mix ends on the timeline
  signal: AbortSignal,
  onProgress: (f: number) => void,
  start = 0, // and where it starts
) {
  const CHUNK = 4
  // Reverb and compressors carry sound over from one moment to the next. Each chunk is mixed from a little
  // earlier and the extra is thrown away, so nothing is cut short where two chunks meet.
  const PAD = layout(project).reduce((m, pl) => Math.max(m, hasChain(pl.clip.sfx) ? Math.max(0.5, tailOf(pl.clip.sfx)) : 0), 0)
  const byId = new Map(sources.map((s) => [s.id, s]))
  const sounding = shown(project).filter(
    (pl) => pl.clip.kind === 'media' && !pl.clip.ramp && !!byId.get(pl.clip.sourceId!)?.media.audioTrack && (pl.clip.volume ?? 1) > 0,
  )
  const sinks = new Map<string, AudioBufferSink>()
  // Clips sped up with the voice kept at its pitch are stretched in one continuous run each, across the chunks.
  type Stretched = { stretch: VoiceStretch | null; reader: AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }, void, unknown>; done: boolean; rate: number }
  const stretched = new Map<string, Stretched>()
  async function readStretched(pl: Placed, frames: number): Promise<AudioBuffer | null> {
    let s = stretched.get(pl.clip.id)
    if (!s) {
      const sink = new AudioBufferSink(byId.get(pl.clip.sourceId!)!.media.audioTrack!)
      s = { stretch: null, reader: sink.buffers(pl.clip.in, pl.clip.out), done: false, rate: byId.get(pl.clip.sourceId!)!.media.audioTrack!.sampleRate }
      stretched.set(pl.clip.id, s)
    }
    while ((s.stretch?.available ?? 0) < frames && !s.done) {
      const next = await s.reader.next()
      if (next.done) {
        s.done = true
        s.stretch?.flush()
        break
      }
      const { buffer, timestamp } = next.value
      if (!s.stretch) s.stretch = new VoiceStretch(pitchPlan(pl.clip)?.stretch ?? speedOf(pl.clip), buffer.sampleRate)
      s.rate = buffer.sampleRate
      const a = Math.max(0, Math.round((pl.clip.in - timestamp) * buffer.sampleRate))
      const b = Math.min(buffer.length, Math.round((pl.clip.out - timestamp) * buffer.sampleRate))
      if (b > a) s.stretch.push(buffer, a, b)
    }
    const [l, r] = s.stretch ? s.stretch.pull(frames) : [new Float32Array(0), new Float32Array(0)]
    const out = new AudioBuffer({ length: Math.max(1, frames), numberOfChannels: 2, sampleRate: s.rate })
    out.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
    out.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
    return out
  }
  for (let c0 = start; c0 < total - 1e-6; c0 += CHUNK) {
    if (signal.aborted) return
    const c1 = Math.min(total, c0 + CHUNK)
    const frames = Math.max(1, Math.round((c1 - c0) * SAMPLE_RATE))
    // The mix starts `pad` seconds early (never before 0); m0 is where it starts on the timeline.
    const m0 = Math.max(0, c0 - PAD)
    const lead = Math.round((c0 - m0) * SAMPLE_RATE)
    const mix = new OfflineAudioContext(2, frames + lead, SAMPLE_RATE)
    // Where a clip's sound goes: through its effects if it has any, straight to the mix if not.
    const outFor = (pl: Placed): AudioNode => {
      if (!hasChain(pl.clip.sfx)) return mix.destination
      const chain = buildChain(mix, pl.clip.sfx!)
      chain.output.connect(mix.destination)
      return chain.input
    }
    for (const pl of sounding) {
      if (pl.end + pl.post + tailOf(pl.clip.sfx) <= m0 || pl.start - pl.pre >= c1) continue
      if (pl.end + pl.post <= m0) continue // only its tail would reach this chunk, and the earlier chunk already has it
      const speed = speedOf(pl.clip)
      const plan = pitchPlan(pl.clip)
      if ((speed !== 1 && pl.clip.keepPitch !== false) || plan) {
        // Stretched clips are read once, in order, so each chunk takes only its own part (no lead-in).
        const from = Math.max(c0, pl.start)
        const to = Math.min(c1, pl.end)
        if (to <= from) continue
        const playRate = plan?.playRate ?? 1
        const rate = stretched.get(pl.clip.id)?.rate ?? byId.get(pl.clip.sourceId!)!.media.audioTrack!.sampleRate
        // An export that starts part way into this clip: the stretch is read from its beginning, so the part
        // before the start is read and dropped first.
        if (!stretched.has(pl.clip.id) && from > pl.start + 1e-6) await readStretched(pl, Math.round((from - pl.start) * rate * playRate))
        const piece = await readStretched(pl, Math.round((Math.round(to * rate) - Math.round(from * rate)) * playRate))
        if (piece) {
          const g = mix.createGain()
          applyGain(g.gain, project, pl, from, to, (t) => t - m0)
          g.connect(outFor(pl))
          const node = mix.createBufferSource()
          node.buffer = piece
          node.playbackRate.value = playRate
          node.connect(g)
          node.start(Math.max(0, from - m0)) // rounding can leave a start a hair below 0, which the browser refuses
        }
        continue
      }
      // Plain clips sound across their transitions (the crossfade): from the lead-in to the run-out.
      const dur = byId.get(pl.clip.sourceId!)!.media.info.duration
      const srcFrom = Math.max(0, sourceAt(pl.clip, Math.max(-pl.pre, m0 - pl.start)))
      const srcTo = Math.min(dur, sourceAt(pl.clip, Math.min(c1, pl.end + pl.post) - pl.start))
      if (srcTo <= srcFrom) continue
      let sink = sinks.get(pl.clip.sourceId!)
      if (!sink) {
        sink = new AudioBufferSink(byId.get(pl.clip.sourceId!)!.media.audioTrack!)
        sinks.set(pl.clip.sourceId!, sink)
      }
      const gain = mix.createGain()
      applyGain(gain.gain, project, pl, Math.max(m0, pl.start - pl.pre), Math.min(c1, pl.end + pl.post), (t) => t - m0)
      gain.connect(outFor(pl))
      for await (const { buffer, timestamp, duration: d } of sink.buffers(srcFrom, srcTo)) {
        const cutStart = Math.max(timestamp, srcFrom)
        const cutEnd = Math.min(timestamp + d, srcTo)
        if (cutEnd <= cutStart) continue
        const node = mix.createBufferSource()
        node.buffer = buffer
        node.playbackRate.value = speed // plain speed change: pitch moves with it
        node.connect(gain)
        node.start(Math.max(0, pl.start + (cutStart - pl.clip.in) / speed - m0), Math.max(0, cutStart - timestamp), cutEnd - cutStart)
      }
    }
    const rendered = await mix.startRendering()
    if (lead === 0) await out.add(rendered)
    else {
      // Keep only this chunk's own stretch; the lead-in was there to warm the effects up.
      const kept = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
      for (let ch = 0; ch < 2; ch++) kept.copyToChannel(rendered.getChannelData(ch).subarray(lead, lead + frames), ch)
      await out.add(kept)
    }
    onProgress((c1 - start) / Math.max(1e-6, total - start))
  }
  onProgress(1)
}

// A GIF: no sound, at most 15 frames a second and 540 pixels on the short side (GIFs get big quickly),
// each frame given its own 256-colour palette.
async function exportGif(
  sources: Source[], project: Project, settings: ExportSettings, from: number, total: number,
  writable: WritableStream<StreamTargetChunk>, onProgress: (f: number) => void, signal: AbortSignal,
) {
  const [width, height] = outputSize(project.frame, Math.min(540, settings.resolution))
  const fps = Math.min(15, settings.fps === 'original' ? 15 : settings.fps)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const gif = GIFEncoder()
  let index = 0
  const sink = {
    add: async () => {
      const { data } = ctx.getImageData(0, 0, width, height)
      const palette = quantize(data, 256)
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.round(1000 / fps), repeat: index === 0 ? 0 : undefined })
      index++
    },
  }
  await renderVideo({ source: sink, canvas, fps }, project, sources, total, signal, onProgress, from)
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
  gif.finish()
  const w = writable.getWriter()
  await w.write({ type: 'write', data: gif.bytes(), position: 0 } as unknown as StreamTargetChunk)
  w.releaseLock()
}

// ---- A picture of the edit at one moment (the playhead), drawn exactly like a video frame ----

export type StillType = 'png' | 'jpg' | 'webp'
export const STILLS: { id: StillType; label: string; ext: string; mime: string }[] = [
  { id: 'png', label: 'PNG picture (sharpest)', ext: '.png', mime: 'image/png' },
  { id: 'jpg', label: 'JPG picture (smaller file)', ext: '.jpg', mime: 'image/jpeg' },
  { id: 'webp', label: 'WebP picture (smallest file)', ext: '.webp', mime: 'image/webp' },
]

export async function exportStill(sources: Source[], project: Project, t: number, resolution: number, type: StillType, transparent = false): Promise<Blob> {
  const [w, h] = outputSize(project.frame, resolution)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  const byId = new Map(sources.map((s) => [s.id, s]))
  const all = shown(project)
  const layers: Layer[] = []
  for (const pl of activeVideo(project, t)) {
    const timing = { local: t - pl.start, length: pl.end - pl.start, trans: transAt(pl, t, nextOf(all, pl)), level: musicLevel(project, t),
      follow: pl.clip.follow ? trackedPoint(project, sources, pl.clip.follow.clip, t, sampleAt) : null }
    if (pl.clip.kind === 'image') {
      layers.push({ clip: pl.clip, img: pictureOf(pl.clip, t - pl.start), ...timing })
      continue
    }
    if (pl.clip.kind !== 'media') {
      layers.push({ clip: pl.clip, img: null, ...timing })
      continue
    }
    const src = byId.get(pl.clip.sourceId!)
    const track = src?.media.videoTrack
    if (!track) continue
    const at = Math.max(0, Math.min(sourceAt(pl.clip, t - pl.start), src.media.info.duration - 0.001))
    const frame = await new CanvasSink(track).getCanvas(at)
    layers.push({ clip: pl.clip, img: frame?.canvas ?? null, ...timing })
  }
  // A JPG cannot be see-through, so it always gets the black background.
  compose(ctx, project.frame, w / project.frame.w, layers, sources, new LookRenderer(), project.luts, transparent && type !== 'jpg')
  const mime = STILLS.find((s) => s.id === type)!.mime
  return canvas.convertToBlob(type === 'png' ? { type: mime } : { type: mime, quality: 0.92 })
}
