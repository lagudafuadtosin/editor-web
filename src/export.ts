import {
  AudioBufferSink, AudioBufferSource, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  MkvOutputFormat, MovOutputFormat, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, WavOutputFormat, WebMOutputFormat,
  type AudioCodec, type OutputFormat, type StreamTargetChunk, type VideoCodec, type WrappedCanvas,
} from 'mediabunny'
import { compose, type Layer } from './compose'
import { imageStore } from './images'
import { LookRenderer } from './look'
import { activeVideo, duration, layout, sourceAt, speedOf, type Frame, type Placed, type Project, type Source } from './model'
import { applyGain } from './sound'
import { VoiceStretch } from './stretch'

export type Container = 'mp4' | 'mov' | 'webm' | 'mkv' | 'm4a' | 'wav'

export type ExportSettings = {
  container: Container
  fps: number | 'original'
  // Size of the short side: 480, 720, 1080, 1440 or 2160. The shape is the project's frame.
  resolution: number
}

export const CONTAINERS: { id: Container; label: string; ext: string; mime: string; audioOnly?: boolean }[] = [
  { id: 'mp4', label: 'MP4 (TikTok, phones, everywhere)', ext: '.mp4', mime: 'video/mp4' },
  { id: 'mov', label: 'MOV (Apple)', ext: '.mov', mime: 'video/quicktime' },
  { id: 'webm', label: 'WebM (web)', ext: '.webm', mime: 'video/webm' },
  { id: 'mkv', label: 'MKV', ext: '.mkv', mime: 'video/x-matroska' },
  { id: 'm4a', label: 'Audio only, M4A', ext: '.m4a', mime: 'audio/mp4', audioOnly: true },
  { id: 'wav', label: 'Audio only, WAV', ext: '.wav', mime: 'audio/wav', audioOnly: true },
]

export const RESOLUTIONS = [480, 720, 1080, 1440, 2160]

function formatFor(c: Container): OutputFormat {
  switch (c) {
    case 'mp4': case 'm4a': return new Mp4OutputFormat()
    case 'mov': return new MovOutputFormat()
    case 'webm': return new WebMOutputFormat()
    case 'mkv': return new MkvOutputFormat()
    case 'wav': return new WavOutputFormat()
  }
}

const VIDEO_PREF: Record<Container, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'], mov: ['avc', 'hevc'], mkv: ['avc', 'hevc', 'vp9', 'av1'], webm: ['vp9', 'vp8', 'av1'], m4a: [], wav: [],
}
const AUDIO_PREF: Record<Container, AudioCodec[]> = {
  mp4: ['aac', 'opus'], mov: ['aac'], mkv: ['aac', 'opus'], webm: ['opus', 'vorbis'], m4a: ['aac'], wav: ['pcm-s16'],
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
  const output = new Output({ format: formatFor(settings.container), target: new StreamTarget(writable, { chunked: true }) })
  const total = duration(project)

  let video: { source: CanvasSource; canvas: OffscreenCanvas; fps: number } | null = null
  if (!container.audioOnly) {
    const [width, height] = outputSize(project.frame, settings.resolution)
    const firstFps = sources.find((s) => s.media.info.video)?.media.info.video?.fps ?? 30
    const fps = settings.fps === 'original' ? Math.min(60, Math.max(24, Math.round(firstFps))) : settings.fps
    const codec = await getFirstEncodableVideoCodec(VIDEO_PREF[settings.container], { width, height })
    if (!codec) throw new Error(`this computer cannot encode ${width} × ${height} video for ${container.ext}. Try a smaller size`)
    const canvas = new OffscreenCanvas(width, height)
    const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 })
    output.addVideoTrack(source, { frameRate: fps })
    video = { source, canvas, fps }
  }

  const hasSound = layout(project).some((pl) => pl.clip.kind === 'media' && sources.find((s) => s.id === pl.clip.sourceId)?.media.audioTrack)
  let audio: AudioBufferSource | null = null
  if (hasSound || container.audioOnly) {
    const codec = await getFirstEncodableAudioCodec(AUDIO_PREF[settings.container], { numberOfChannels: 2, sampleRate: SAMPLE_RATE })
    if (codec) {
      audio = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH })
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
      video && renderVideo(video, project, sources, total, signal, (f) => { progress.video = f; report() }),
      audio && renderAudio(audio, project, sources, total, signal, (f) => { progress.audio = f; report() }),
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
  v: { source: CanvasSource; canvas: OffscreenCanvas; fps: number },
  project: Project,
  sources: Source[],
  total: number,
  signal: AbortSignal,
  onProgress: (f: number) => void,
) {
  const ctx = v.canvas.getContext('2d')!
  const scale = v.canvas.width / project.frame.w
  const renderer = new LookRenderer()
  const byId = new Map(sources.map((s) => [s.id, s]))
  type Reader = { frames: AsyncGenerator<WrappedCanvas, void, unknown>; current: WrappedCanvas | null; next: WrappedCanvas | null }
  const readers = new Map<string, Reader>()
  const count = Math.max(1, Math.round(total * v.fps))

  for (let i = 0; i < count; i++) {
    if (signal.aborted) break
    const t = i / v.fps
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
      const timing = { local: t - pl.start, length: pl.end - pl.start }
      if (pl.clip.kind === 'image') {
        layers.push({ clip: pl.clip, img: pl.clip.imageId ? imageStore.get(pl.clip.imageId) ?? null : null, ...timing })
        continue
      }
      if (pl.clip.kind !== 'media') {
        layers.push({ clip: pl.clip, img: null, ...timing })
        continue
      }
      const track = byId.get(pl.clip.sourceId!)?.media.videoTrack
      if (!track) continue
      const srcT = sourceAt(pl.clip, t - pl.start)
      let r = readers.get(pl.clip.id)
      if (!r) {
        const frames = new CanvasSink(track).canvases(srcT, pl.clip.out)
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
    compose(ctx, project.frame, scale, layers, sources, renderer)
    await v.source.add(t, 1 / v.fps)
    onProgress(i / count)
  }
  for (const r of readers.values()) await r.frames.return(undefined)
  onProgress(1)
}

// Mixes every clip's sound, a few seconds at a time, with the browser's own mixer (OfflineAudioContext),
// which also converts any sample rate to the file's rate.
async function renderAudio(
  out: AudioBufferSource,
  project: Project,
  sources: Source[],
  total: number,
  signal: AbortSignal,
  onProgress: (f: number) => void,
) {
  const CHUNK = 4
  const byId = new Map(sources.map((s) => [s.id, s]))
  const sounding = layout(project).filter(
    (pl): pl is Placed => pl.clip.kind === 'media' && !!byId.get(pl.clip.sourceId!)?.media.audioTrack && (pl.clip.volume ?? 1) > 0,
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
      if (!s.stretch) s.stretch = new VoiceStretch(speedOf(pl.clip), buffer.sampleRate)
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
  for (let c0 = 0; c0 < total - 1e-6; c0 += CHUNK) {
    if (signal.aborted) return
    const c1 = Math.min(total, c0 + CHUNK)
    const frames = Math.max(1, Math.round((c1 - c0) * SAMPLE_RATE))
    const mix = new OfflineAudioContext(2, frames, SAMPLE_RATE)
    for (const pl of sounding) {
      if (pl.end <= c0 || pl.start >= c1) continue
      const speed = speedOf(pl.clip)
      if (speed !== 1 && pl.clip.keepPitch !== false) {
        // The part of this clip inside the chunk, taken in order from its continuous stretch.
        const from = Math.max(c0, pl.start)
        const to = Math.min(c1, pl.end)
        const rate = stretched.get(pl.clip.id)?.rate ?? byId.get(pl.clip.sourceId!)!.media.audioTrack!.sampleRate
        const piece = await readStretched(pl, Math.round(to * rate) - Math.round(from * rate))
        if (piece) {
          const g = mix.createGain()
          applyGain(g.gain, project, pl, from, to, (t) => t - c0)
          g.connect(mix.destination)
          const node = mix.createBufferSource()
          node.buffer = piece
          node.connect(g)
          node.start(from - c0)
        }
        continue
      }
      const srcFrom = sourceAt(pl.clip, Math.max(0, c0 - pl.start))
      const srcTo = sourceAt(pl.clip, Math.min(c1, pl.end) - pl.start)
      let sink = sinks.get(pl.clip.sourceId!)
      if (!sink) {
        sink = new AudioBufferSink(byId.get(pl.clip.sourceId!)!.media.audioTrack!)
        sinks.set(pl.clip.sourceId!, sink)
      }
      const gain = mix.createGain()
      applyGain(gain.gain, project, pl, Math.max(c0, pl.start), Math.min(c1, pl.end), (t) => t - c0)
      gain.connect(mix.destination)
      for await (const { buffer, timestamp, duration: d } of sink.buffers(srcFrom, srcTo)) {
        const cutStart = Math.max(timestamp, srcFrom)
        const cutEnd = Math.min(timestamp + d, srcTo)
        if (cutEnd <= cutStart) continue
        const node = mix.createBufferSource()
        node.buffer = buffer
        node.playbackRate.value = speed // plain speed change: pitch moves with it
        node.connect(gain)
        node.start(pl.start + (cutStart - pl.clip.in) / speed - c0, cutStart - timestamp, cutEnd - cutStart)
      }
    }
    await out.add(await mix.startRendering())
    onProgress(c1 / total)
  }
  onProgress(1)
}
