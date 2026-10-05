import { AudioBufferSink, CanvasSink } from 'mediabunny'
import { compose, type Layer } from './compose'
import { imageStore, pictureOf } from './images'
import { LookRenderer } from './look'
import { activeVideo, duration, localAt, nextOf, shown, sourceAt, speedOf, transAt, type Clip, type Placed, type Project, type Shown, type Source } from './model'
import { applyGain, musicLevel } from './sound'
import { sampleAt } from './motion'
import { trackedPoint } from './model'
import { buildChain, hasChain, pitchPlan } from './sfx'
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
  private sinkProxy = new Map<string, boolean>()
  private sources: Source[] = []
  private project: Project | null = null
  private nodes = new Set<AudioBufferSourceNode>()
  private chains = new Set<AudioNode>() // effect chains' last nodes, cut off when playback stops
  private frames = new Map<string, Img>() // latest decoded frame per clip id, while playing
  private generation = 0
  private drawId = 0 // the newest still-frame request; an older one that finishes later is not shown
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
  useProxies = true
  // A rendered stretch of the edit, played instead of drawing each frame, for as long as the edit is unchanged.
  private cache: { project: Project; from: number; to: number; sink: CanvasSink } | null = null
  private cacheFrame: { t: number; img: Img } | null = null

  setCache(c: { project: Project; from: number; to: number; media: { videoTrack: import('mediabunny').InputVideoTrack | null } } | null) {
    this.cache = c && c.media.videoTrack ? { project: c.project, from: c.from, to: c.to, sink: new CanvasSink(c.media.videoTrack) } : null
    this.cacheFrame = null
  }
  get cachedRange(): [number, number] | null {
    return this.cache && this.cache.project === this.project ? [this.cache.from, this.cache.to] : null
  }

  // Preview copies on or off: the decoders are made again from the right files.
  setUseProxies(on: boolean) {
    if (on === this.useProxies) return
    this.useProxies = on
    const was = this.playing
    this.stopAll()
    this.sinks.clear()
    if (this.project) this.setProject(this.sources, this.project, false)
    if (was) this.play()
  }

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
      // Made again when a preview copy arrives (or goes), so playback switches to it.
      const wantProxy = !!(this.useProxies && s.proxy?.videoTrack)
      if (this.sinks.has(s.id) && this.sinkProxy.get(s.id) === wantProxy) continue
      this.sinkProxy.set(s.id, wantProxy)
      // A preview copy, if there is one and it is wanted, is what playback decodes. Its frames keep the original's times.
      const v = (this.useProxies && s.proxy?.videoTrack) || s.media.videoTrack
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
    if (this.cache && this.cache.project === this.project && this.startPos < this.cache.to) this.cacheLoop(gen)
    for (const pl of shown(this.project)) {
      if (pl.end + pl.post <= this.startPos || pl.clip.kind !== 'media') continue
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
    const id = ++this.drawId
    const active = activeVideo(this.project, t)
    const all = shown(this.project)
    const imgs = await Promise.all(
      active.map(async (pl) => {
        if (pl.clip.kind === 'image') return pictureOf(pl.clip, t - pl.start)
        if (pl.clip.kind !== 'media') return null
        const sink = this.sinks.get(pl.clip.sourceId!)?.canvas
        if (!sink) return null
        const f = await sink.getCanvas(this.srcClamp(pl.clip, sourceAt(pl.clip, t - pl.start)))
        return f?.canvas ?? null
      }),
    )
    // Two quick jumps decode at the same time; only the newest one is drawn, whichever finishes last.
    if (gen !== this.generation || id !== this.drawId || this.playing) return
    active.forEach((pl, i) => { if (imgs[i]) this.lastRaw.set(pl.clip.id, imgs[i]!) })
    const level = musicLevel(this.project, t)
    const proj = this.project
    this.paint(active.map((pl, i) => ({ clip: pl.clip, img: imgs[i], local: t - pl.start, length: pl.end - pl.start, trans: transAt(pl, t, nextOf(all, pl)), level,
      follow: pl.clip.follow ? trackedPoint(proj, this.sources, pl.clip.follow.clip, t, sampleAt) : null })))
  }

  private paint(layers: Layer[]) {
    if (!this.project) return
    compose(this.out.getContext('2d')!, this.project.frame, this.previewScale, layers, this.sources, this.renderer, this.project.luts)
  }

  private stopAll() {
    this.playing = false
    this.generation++
    cancelAnimationFrame(this.raf)
    for (const n of this.nodes) {
      try { n.stop() } catch { /* already stopped */ }
    }
    this.nodes.clear()
    // A reverb tail would ring on after a pause: cut it off.
    for (const n of this.chains) n.disconnect()
    this.chains.clear()
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
    // Inside a rendered stretch of an unchanged edit: show the rendered frame instead of drawing it.
    const c = this.cache
    if (c && c.project === this.project && t >= c.from && t < c.to) {
      if (this.cacheFrame && this.cacheFrame.t <= t + 1e-3) {
        const ctx = this.out.getContext('2d')!
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(this.cacheFrame.img, 0, 0, this.out.width, this.out.height)
      }
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    // Read the live project, so a box moved or a look changed while playing shows at once.
    const active = activeVideo(this.project, t)
    const all = shown(this.project)
    this.paint(active.map((pl) => ({
      clip: pl.clip,
      img: pl.clip.kind === 'image' ? pictureOf(pl.clip, t - pl.start) : this.frames.get(pl.clip.id) ?? null,
      local: t - pl.start,
      length: pl.end - pl.start,
      trans: transAt(pl, t, nextOf(all, pl)),
      level: musicLevel(this.project!, t),
      follow: pl.clip.follow ? trackedPoint(this.project!, this.sources, pl.clip.follow.clip, t, sampleAt) : null,
    })))
    this.raf = requestAnimationFrame(this.tick)
  }

  // Source time where playback enters a clip: its in point (less any transition lead-in), or later if the playhead
  // starts inside it. Never before the start of the file.
  private entry(pl: Placed, pre = 0): number {
    return this.srcClamp(pl.clip, sourceAt(pl.clip, Math.max(-pre, this.startPos - pl.start)))
  }

  // A source time kept inside the file: a transition reaching past either end holds the first or last frame.
  private srcClamp(c: Clip, src: number): number {
    const dur = c.sourceId ? this.sources.find((s) => s.id === c.sourceId)?.media.info.duration ?? Infinity : Infinity
    return Math.max(0, Math.min(src, dur - 0.001))
  }

  private async waitUntil(gen: number, t: number) {
    while (gen === this.generation && this.now() < t) await sleep(Math.min(200, Math.max(10, (t - this.now()) * 500)))
  }

  private async audioLoop(gen: number, sp: Shown) {
    const sink = this.sinks.get(sp.clip.sourceId!)?.audio
    // A speed ramp plays without its own sound (it would warble). Music goes on a sound track.
    if (!sink || sp.clip.ramp) return
    await this.waitUntil(gen, sp.start - sp.pre - 1.5) // start reading a little before the clip begins
    if (gen !== this.generation) return
    // Plain clips with a transition play their sound over the transition too (the crossfade); stretched ones do not.
    const stretchy = (speedOf(sp.clip) !== 1 && sp.clip.keepPitch !== false) || !!pitchPlan(sp.clip)
    const pre = stretchy ? 0 : sp.pre
    const post = stretchy ? 0 : sp.post
    const pl: Placed = sp
    const outSrc = this.srcClamp(pl.clip, sourceAt(pl.clip, pl.end - pl.start + post))
    const gain = this.ctx.createGain()
    applyGain(gain.gain, this.project!, pl, Math.max(pl.start - pre, this.startPos), pl.end + post, (t) => this.startCtx + t - this.startPos)
    if (hasChain(pl.clip.sfx)) {
      const chain = buildChain(this.ctx, pl.clip.sfx!)
      gain.connect(chain.input)
      chain.output.connect(this.master)
      this.chains.add(chain.output)
    } else gain.connect(this.master)
    const from = this.entry(pl, pre)
    const speed = speedOf(pl.clip)
    // Where a source time lands on the audio clock.
    const clockAt = (src: number) => this.startCtx + (pl.start + (src - pl.clip.in) / speed - this.startPos)
    // Pitch moved: stretched first, then played faster or slower by the same amount, so the length stays right.
    const plan = pitchPlan(pl.clip)
    if ((speed !== 1 && pl.clip.keepPitch !== false) || plan) {
      // Sped up or slowed down, voice kept at its own pitch: stretched by our own time-stretch, in order.
      const playRate = plan?.playRate ?? 1
      let stretch: VoiceStretch | null = null
      let at = clockAt(from)
      const schedule = (b: AudioBuffer | null) => {
        if (!b) return
        const dur = b.duration / playRate
        let offset = 0
        const late = this.ctx.currentTime - at
        if (late > 0) offset = Math.min(dur, late)
        if (offset < dur) {
          const node = this.ctx.createBufferSource()
          node.buffer = b
          node.playbackRate.value = playRate
          node.connect(gain)
          node.start(at + offset, offset * playRate)
          this.nodes.add(node)
          node.onended = () => this.nodes.delete(node)
        }
        at += dur
      }
      for await (const { buffer, timestamp, duration: d } of sink.buffers(from, pl.clip.out)) {
        if (gen !== this.generation) return
        if (!stretch) stretch = new VoiceStretch(plan?.stretch ?? speed, buffer.sampleRate)
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
    for await (const { buffer, timestamp, duration: d } of sink.buffers(from, outSrc)) {
      if (gen !== this.generation) return
      // Keep only the part of this buffer inside the clip, so cuts land on the exact sample.
      const cutStart = Math.max(timestamp, from)
      const cutEnd = Math.min(timestamp + d, outSrc)
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

  // Decodes the rendered stretch in step with the clock, keeping the latest frame for tick() to show.
  private async cacheLoop(gen: number) {
    const c = this.cache!
    const from = Math.max(c.from, this.startPos)
    for await (const f of c.sink.canvases(from - c.from, c.to - c.from)) {
      if (gen !== this.generation) return
      const at = c.from + f.timestamp
      while (gen === this.generation && at > this.now()) await nextFrame()
      if (gen !== this.generation) return
      this.cacheFrame = { t: at, img: f.canvas }
    }
  }

  private async videoLoop(gen: number, pl: Shown) {
    const sink = this.sinks.get(pl.clip.sourceId!)?.canvas
    if (!sink) return
    await this.waitUntil(gen, pl.start - pl.pre - 0.5) // start decoding just before the clip appears
    if (gen !== this.generation) return
    let first = true
    const outSrc = this.srcClamp(pl.clip, sourceAt(pl.clip, pl.end - pl.start + pl.post))
    for await (const frame of sink.canvases(this.entry(pl, pl.pre), outSrc)) {
      if (gen !== this.generation) return
      // Frames before the in point (a transition's lead-in) land before the clip's start, where they belong.
      const at = pl.start + localAt(pl.clip, frame.timestamp)
      const until = pl.start + localAt(pl.clip, frame.timestamp + frame.duration)
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
