import type { Clip, Sfx } from './model'

// Sound effects for one clip, built from the browser's own sound engine, the same way for playback and export.
// Tone (bass, middle, treble), compressor, reverb and limiter are a chain of nodes. The gate and the volume line
// are part of the clip's loudness (sound.ts), and pitch is done where the sound is read (player and export).

export const hasChain = (s?: Sfx) => !!s && (s.low !== 0 || s.mid !== 0 || s.high !== 0 || s.compress > 0 || s.limit || s.reverb > 0)

// How fast a clip's sound is played back, and how much it is stretched first, so that its length on the timeline
// stays what the speed says and its pitch moves by `pitch` semitones on top.
export function pitchPlan(c: Clip): { playRate: number; stretch: number } | null {
  const speed = c.speed ?? 1
  const semis = c.sfx?.pitch ?? 0
  const keep = c.keepPitch !== false
  if (!semis) return null
  const r = Math.pow(2, semis / 12) * (keep ? 1 : speed)
  return { playRate: r, stretch: speed / r }
}

// A room's echo, made up: stereo noise dying away. A bigger room rings longer.
const impulses = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()
function impulse(ctx: BaseAudioContext, room: number): AudioBuffer {
  let byRoom = impulses.get(ctx)
  if (!byRoom) impulses.set(ctx, (byRoom = new Map()))
  const key = Math.round(room / 10)
  const cached = byRoom.get(key)
  if (cached) return cached
  const seconds = 0.4 + (key / 10) * 3.2
  const len = Math.round(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let seed = 12345
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = rand() * Math.pow(1 - i / len, 2.5)
  }
  byRoom.set(key, buf)
  return buf
}

// Builds the chain. Sound goes into `input` and comes out of `output`.
export function buildChain(ctx: BaseAudioContext, s: Sfx): { input: AudioNode; output: AudioNode; nodes: AudioNode[] } {
  const nodes: AudioNode[] = []
  const add = <T extends AudioNode>(n: T) => (nodes.push(n), n)
  const input = add(ctx.createGain())
  let last: AudioNode = input
  const chain = (n: AudioNode) => {
    last.connect(n)
    last = n
  }
  if (s.low) {
    const f = add(ctx.createBiquadFilter())
    f.type = 'lowshelf'
    f.frequency.value = 150
    f.gain.value = s.low
    chain(f)
  }
  if (s.mid) {
    const f = add(ctx.createBiquadFilter())
    f.type = 'peaking'
    f.frequency.value = 1200
    f.Q.value = 0.8
    f.gain.value = s.mid
    chain(f)
  }
  if (s.high) {
    const f = add(ctx.createBiquadFilter())
    f.type = 'highshelf'
    f.frequency.value = 6000
    f.gain.value = s.high
    chain(f)
  }
  if (s.compress > 0) {
    // More amount: a lower threshold and a higher ratio, then the level made back up.
    const c = add(ctx.createDynamicsCompressor())
    c.threshold.value = -10 - s.compress * 0.3
    c.ratio.value = 2 + s.compress * 0.08
    c.knee.value = 8
    c.attack.value = 0.005
    c.release.value = 0.2
    chain(c)
    const makeup = add(ctx.createGain())
    makeup.gain.value = Math.pow(10, (s.compress * 0.12) / 20)
    chain(makeup)
  }
  if (s.reverb > 0) {
    const dry = add(ctx.createGain())
    const wet = add(ctx.createGain())
    const conv = add(ctx.createConvolver())
    conv.buffer = impulse(ctx, s.room)
    const mixOut = add(ctx.createGain())
    dry.gain.value = 1 - s.reverb / 200
    wet.gain.value = (s.reverb / 100) * 0.6
    last.connect(dry)
    last.connect(conv)
    conv.connect(wet)
    dry.connect(mixOut)
    wet.connect(mixOut)
    last = mixOut
  }
  if (s.limit) {
    const l = add(ctx.createDynamicsCompressor())
    l.threshold.value = -1.5
    l.knee.value = 0
    l.ratio.value = 20
    l.attack.value = 0.001
    l.release.value = 0.08
    chain(l)
  }
  return { input, output: last, nodes }
}

// How long after a clip's sound stops the chain can still be heard (the reverb's tail).
export const tailOf = (s?: Sfx) => (s && s.reverb > 0 ? 0.4 + (Math.round(s.room / 10) / 10) * 3.2 : 0)
