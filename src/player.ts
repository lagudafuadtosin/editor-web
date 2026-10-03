import { AudioBufferSink, CanvasSink } from 'mediabunny'
import { compose, type Layer } from './compose'
import { imageStore } from './images'
import { LookRenderer } from './look'
import { activeVideo, duration, layout, sourceAt, speedOf, type Clip, type Placed, type Project, type Source } from './model'
import { applyGain } from './sound'
import { toBuffer, VoiceStretch } from './stretch'

type Img = HTMLCanvasElement | OffscreenCanvas | ImageBitmap
type Sinks = { canvas: CanvasSink | null; audio: AudioBufferSink | null }

// Plays the project: every layer at once, picture and sound locked together.
// The audio clock (AudioContext.currentTime) is the master. Each clip's sound is scheduled on it sample-exact,
// each clip's frames are decoded just ahead and parked, and every screen refresh draws the parked frames
// of the clips showing at that moment, bottom layer first.
export class Player {
  private ctx = new AudioContext()
  private master = this.ctx.createGain()
  private sinks = new Map<string, Sinks>()
  private sources: Source[] = []
  private project: Project | null = null
  private nodes = new Set<AudioBufferSourceNode>()
  private frames = new Map<string, Img>() // latest decoded frame per clip id, while playing
  private generation = 0
  private startCtx = 0
  private startPos = 0
  private pos = 0
  private raf = 0
  private starting = false
  private out: HTMLCanvasElement
  private onTime: (seconds: number, playing: boolean) => void
  private renderer: LookRenderer | null = null
  duration = 0
  playing = false
  // The last frame drawn for each clip (before any look), so Auto can measure it.
  lastRaw = new Map<string, Img>()

  constructor(out: HTMLCanvasElement, onTime: (seconds: number, playing: boolean) => void) {
    this.out = out
    this.onTime = onTime
    this.master.connect(this.ctx.destination)
    try { this.renderer = new LookRenderer() } catch { this.renderer = null }
  }

  get lookRenderer() {
    return this.renderer
  }

  // Preview size: the real frame scaled down to at most 960 pixels tall.
  get previewScale() {
    return this.project ? Math.min(1, 960 / this.project.frame.h) : 1
  }

  // restart: the clips or their timing changed, so playback restarts from the same spot.
  // Without it (a look, a box moved), playback carries on and the change shows on the next refresh.
  setProject(sources: Source[], project: Project, restart: boolean) {
    const wasPlaying = this.playing
    if (restart && wasPlaying) this.stopAll()
    for (const s of sources) {
      if (this.sinks.has(s.id)) continue
      const v = s.media.videoTrack
      this.sinks.set(s.id, {
        // Decode at most 1280 pixels on the long side for the preview. Export decodes full size.
        canvas: v ? new CanvasSink(v, v.displayWidth >= v.displayHeight ? { width: Math.min(1280, v.displayWidth) } : { height: Math.min(1280, v.displayHeight) }) : null,
        audio: s.media.audioTrack ? new AudioBufferSink(s.media.audioTrack) : null,
      })
    }
    this.sources = sources
    this.project = project
    const s = this.previewScale
    const w = Math.round(project.frame.w * s)
    const h = Math.round(project.frame.h * s)
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w
      this.out.height = h
    }
    this.duration = duration(project)
    this.pos = Math.min(this.pos, this.duration)
    if (restart) {
      this.onTime(this.pos, false)
      if (wasPlaying) this.play()
      else this.drawAt(this.pos)
    } else if (!this.playing) {
      this.drawAt(this.pos)
    }
  }

  now(): number {
    if (!this.playing) return this.pos
    return Math.min(this.duration, this.startPos + (this.ctx.currentTime - this.startCtx))
  }

  async play() {
    if (this.playing || this.starting || this.duration === 0 || !this.project) return
    if (this.pos >= this.duration - 0.01) this.pos = 0
    // The context starts suspended until a click. Resume it inside the click, and make sure a second click
    // while it is waiting cannot start a second copy of the loops.
    const gen = ++this.generation
    this.starting = true
    if (this.ctx.state !== 'running') await this.ctx.resume()
    this.starting = false
    if (gen !== this.generation) return
    this.playing = true
    this.startPos = this.pos
    this.startCtx = this.ctx.currentTime + 0.12 // small lead so the first sounds are scheduled in time
    this.frames.clear()
    for (const pl of layout(this.project)) {
      if (pl.end <= this.startPos || pl.clip.kind !== 'media') continue
      this.audioLoop(gen, pl)
      if (pl.kind === 'video') this.videoLoop(gen, pl)
    }
    this.tick()
  }

  pause() {
    if (!this.playing) return
    this.pos = this.now()
    this.stopAll()
    this.onTime(this.pos, false)
    this.drawAt(this.pos)
  }

  async seek(seconds: number) {
    const wasPlaying = this.playing
    if (wasPlaying) this.stopAll()
    this.pos = Math.max(0, Math.min(this.duration, seconds))
    this.onTime(this.pos, false)
    await this.drawAt(this.pos)
    if (wasPlaying) this.play()
  }

  setVolume(v: number) {
    this.master.gain.value = v
  }

  dispose() {
    this.stopAll()
    this.ctx.close()
  }

  // Frames spread across a clip, for Auto to measure.
  async framesOf(clip: Clip, count = 5): Promise<Img[]> {
    if (clip.kind === 'image') {
      const bmp = clip.imageId ? imageStore.get(clip.imageId) : undefined
      return bmp ? [bmp] : []
    }
    const sink = clip.sourceId ? this.sinks.get(clip.sourceId)?.canvas : null
    if (!sink) return []
    const out: Img[] = []
    for (let i = 0; i < count; i++) {
      const f = await sink.getCanvas(clip.in + ((i + 0.5) / count) * (clip.out - clip.in))
      if (f) out.push(f.canvas)
    }
    return out
  }

  // Draws the still frame at a time (when paused, after a seek or an edit).
  async drawAt(t: number) {
    if (!this.project) return
    const gen = this.generation
    const active = activeVideo(this.project, t)
    const imgs = await Promise.all(
      active.map(async (pl) => {
        if (pl.clip.kind === 'image') return pl.clip.imageId ? imageStore.get(pl.clip.imageId) ?? null : null
        if (pl.clip.kind !== 'media') return null
        const sink = this.sinks.get(pl.clip.sourceId!)?.canvas
        if (!sink) return null
        const f = await sink.getCanvas(Math.min(sourceAt(pl.clip, t - pl.start), pl.clip.out - 0.001))
        return f?.canvas ?? null
      }),
    )
    if (gen !== this.generation || this.playing) return
    active.forEach((pl, i) => { if (imgs[i]) this.lastRaw.set(pl.clip.id, imgs[i]!) })
    this.paint(active.map((pl, i) => ({ clip: pl.clip, img: imgs[i], local: t - pl.start, length: pl.end - pl.start })))
  }

  private paint(layers: Layer[]) {
    if (!this.project) return
    compose(this.out.getContext('2d')!, this.project.frame, this.previewScale, layers, this.sources, this.renderer)
  }

  private stopAll() {
    this.playing = false
    this.generation++
    cancelAnimationFrame(this.raf)
    for (const n of this.nodes) {
      try { n.stop() } catch { /* already stopped */ }
    }
    this.nodes.clear()
  }

  // Every screen refresh: draw what is showing now from the parked frames.
  private tick = () => {
    if (!this.playing || !this.project) return
    const t = this.now()
    this.onTime(t, true)
    if (t >= this.duration) {
      this.pos = this.duration
      this.stopAll()
      this.onTime(this.pos, false)
      return
    }
    // Read the live project, so a box moved or a look changed while playing shows at once.
    const active = activeVideo(this.project, t)
    this.paint(active.map((pl) => ({
      clip: pl.clip,
      img: pl.clip.kind === 'image' ? (pl.clip.imageId ? imageStore.get(pl.clip.imageId) ?? null : null) : this.frames.get(pl.clip.id) ?? null,
      local: t - pl.start,
      length: pl.end - pl.start,
    })))
    this.raf = requestAnimationFrame(this.tick)
  }

  // Source time where playback enters a clip: its in point, or later if the playhead starts inside it.
  private entry(pl: Placed): number {
    return sourceAt(pl.clip, Math.max(0, this.startPos - pl.start))
  }

  private async waitUntil(gen: number, t: number) {
    while (gen === this.generation && this.now() < t) await sleep(Math.min(200, Math.max(10, (t - this.now()) * 500)))
  }

  private async audioLoop(gen: number, pl: Placed) {
    const sink = this.sinks.get(pl.clip.sourceId!)?.audio
    if (!sink) return
    await this.waitUntil(gen, pl.start - 1.5) // start reading a little before the clip begins
    if (gen !== this.generation) return
    const gain = this.ctx.createGain()
    applyGain(gain.gain, this.project!, pl, Math.max(pl.start, this.startPos), pl.end, (t) => this.startCtx + t - this.startPos)
    gain.connect(this.master)
    const from = this.entry(pl)
    const speed = speedOf(pl.clip)
    // Where a source time lands on the audio clock.
    const clockAt = (src: number) => this.startCtx + (pl.start + (src - pl.clip.in) / speed - this.startPos)
    if (speed !== 1 && pl.clip.keepPitch !== false) {
      // Sped up or slowed down, voice kept at its own pitch: stretched by our own time-stretch, in order.
      let stretch: VoiceStretch | null = null
      let at = clockAt(from)
      const schedule = (b: AudioBuffer | null) => {
        if (!b) return
        let offset = 0
        const late = this.ctx.currentTime - at
        if (late > 0) offset = Math.min(b.duration, late)
        if (offset < b.duration) {
          const node = this.ctx.createBufferSource()
          node.buffer = b
          node.connect(gain)
          node.start(at + offset, offset)
          this.nodes.add(node)
          node.onended = () => this.nodes.delete(node)
        }
        at += b.duration
      }
      for await (const { buffer, timestamp, duration: d } of sink.buffers(from, pl.clip.out)) {
        if (gen !== this.generation) return
        if (!stretch) stretch = new VoiceStretch(speed, buffer.sampleRate)
        const a = Math.max(0, Math.round((from - timestamp) * buffer.sampleRate))
        const b = Math.min(buffer.length, Math.round((pl.clip.out - timestamp) * buffer.sampleRate))
        if (b > a) stretch.push(buffer, a, b)
        schedule(toBuffer(stretch.pull(), buffer.sampleRate))
        // Keep about one second of sound queued, no more.
        while (gen === this.generation && at - this.ctx.currentTime > 1) await sleep(50)
        void d
      }
      if (stretch && gen === this.generation) {
        stretch.flush()
        schedule(toBuffer(stretch.pull(), stretch.rate))
      }
      return
    }
    for await (const { buffer, timestamp, duration: d } of sink.buffers(from, pl.clip.out)) {
      if (gen !== this.generation) return
      // Keep only the part of this buffer inside the clip, so cuts land on the exact sample.
      const cutStart = Math.max(timestamp, from)
      const cutEnd = Math.min(timestamp + d, pl.clip.out)
      if (cutEnd <= cutStart) continue
      // Plain speed change (pitch moves with it, like a tape): the buffer plays faster or slower.
      let at = clockAt(cutStart)
      let offset = cutStart - timestamp
      let len = cutEnd - cutStart
      const late = this.ctx.currentTime - at
      if (late > 0) {
        if (late * speed >= len) continue
        at += late
        offset += late * speed
        len -= late * speed
      }
      const node = this.ctx.createBufferSource()
      node.buffer = buffer
      node.playbackRate.value = speed
      node.connect(gain)
      node.start(at, offset, len)
      this.nodes.add(node)
      node.onended = () => this.nodes.delete(node)
      // Keep about one second of sound queued, no more.
      const queuedTo = pl.start + (cutEnd - pl.clip.in) / speed
      while (gen === this.generation && queuedTo - this.now() > 1) await sleep(50)
    }
  }

  private async videoLoop(gen: number, pl: Placed) {
    const sink = this.sinks.get(pl.clip.sourceId!)?.canvas
    if (!sink) return
    await this.waitUntil(gen, pl.start - 0.5) // start decoding just before the clip appears
    if (gen !== this.generation) return
    let first = true
    for await (const frame of sink.canvases(this.entry(pl), pl.clip.out)) {
      if (gen !== this.generation) return
      const speed = speedOf(pl.clip)
      const at = pl.start + Math.max(0, frame.timestamp - pl.clip.in) / speed
      const until = pl.start + (frame.timestamp + frame.duration - pl.clip.in) / speed
      // Park the very first frame straight away, so the clip never flashes black as it starts.
      if (first) {
        this.frames.set(pl.clip.id, frame.canvas)
        first = false
      }
      while (gen === this.generation && at > this.now()) await nextFrame()
      if (gen !== this.generation) return
      if (until < this.now()) continue // already late: skip it, so the picture catches up with the sound
      this.frames.set(pl.clip.id, frame.canvas)
      this.lastRaw.set(pl.clip.id, frame.canvas)
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
