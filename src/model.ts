import type { ShapeStyle } from './shape'
import type { OpenedMedia } from './media'
import type { Look } from './look'
import { layoutText, type TextStyle } from './text'

// A file the user has opened. Clips point at it, they never copy it.
export type Source = {
  id: string; name: string; media: OpenedMedia; file?: { name: string; size: number; lastModified: number }
  proxy?: OpenedMedia // a small copy of the video, used only to play it in the editor
}

// Where a clip sits in the frame, in frame pixels. x and y are the centre of its box.
export type Transform = {
  x: number
  y: number
  w: number
  h: number
  rotation: number // degrees
  opacity: number // 0 to 1
  flipH: boolean
  flipV: boolean
  keepRatio: boolean
  crop: { t: number; b: number; l: number; r: number } // percent cut from each edge, 0 to 100
  feather: number // soft edge, in frame pixels
}

// A piece of media, a picture, a plain colour block, or text, on a track.
// in and out are times inside the source (for a colour block, 0 to its length).
// start is where it begins on the timeline. On the main track it is worked out by packing and not used.
export type Clip = {
  id: string
  kind: 'media' | 'image' | 'color' | 'text' | 'adjust' | 'shape' // adjust: an adjustment layer, its look and effects change everything under it
  imageId?: string // pictures: the decoded image in imageStore
  imageSize?: [number, number] // pictures: their own width and height
  label?: string // pictures: the file name shown on the timeline
  sourceId?: string
  color?: string
  shape?: ShapeStyle // shapes: what is drawn in the clip's box
  start: number
  in: number
  out: number
  look?: Look
  transform?: Transform
  volume?: number // 0 to 2, 1 = as recorded
  fadeIn?: number // sound fades up over this many seconds at the start of the clip
  fadeOut?: number // and down over this many at the end
  speed?: number // 0.25 to 10, 1 = as recorded (video and sound clips)
  keepPitch?: boolean // when sped up or slowed down, keep the voice at its own pitch (default yes)
  text?: TextStyle
  caption?: string // caption group: the lines made together by Captions share it
  anim?: Anim
  border?: Border
  group?: string // clips grouped together move and are deleted together
  // Added from "+ Add" in the side panel. Each is absent until added, and removed with its ×.
  fx?: Fx
  key?: Key
  blend?: Blend
  shade?: Shade
  lut?: LutUse
  sfx?: Sfx
  volPoints?: VolPoint[]
  words?: { text: string; start: number; end: number }[] // captions: when each word is said, in seconds into the clip
  keys?: KeyFrame[] // movement over time: where the box is at moments in the clip, in between worked out
  path?: 'straight' | 'curved' // between keyframes, the box moves in straight lines or a smooth curve
  tIn?: Transition // from the clip just before it on the same track into this one
  ramp?: Ramp // speed that changes within the clip; its length on the timeline stays the same
  mask?: Mask
  matte?: Matte // the layer straight above is used as this clip's shape, and is not shown itself
  lottieId?: string // a picture clip that is a Lottie animation (its data is in project.lotties)
  nest?: string // a nested clip: it shows this timeline (project.sequences), from a rendered copy of it
  // Motion tracking: a box drawn round something, and where its centre goes, per frame, in the file's own
  // times (fractions of the picture).
  track?: { box: { x: number; y: number; w: number; h: number }; points: [number, number, number][] }
  // Following a tracked object: this clip's centre sits ox, oy frame pixels from the tracked point.
  follow?: { clip: string; ox: number; oy: number }
  // Stabilised: per frame, the shift (fractions of the picture) and turn (radians) that undo the shake.
  stab?: { strength: number; zoom: number; data: [number, number, number, number][] }
  // Blurred fill: a soft, blurred copy of the same picture fills the whole frame behind it (0 to 100, how soft).
  fillBlur?: number
}


// A shape that keeps part of the picture. x, y, w, h are fractions of the clip's box (centre and size);
// pen points too. 'colour' keeps the whole picture and limits the colour changes to inside the shape.
export type Mask = {
  shape: 'rect' | 'round' | 'ellipse' | 'pen'
  x: number; y: number; w: number; h: number
  points?: [number, number][]
  feather: number // soft edge, in frame pixels
  invert: boolean
  mode: 'cut' | 'colour'
  followFrom?: [number, number] // moves with the clip's own tracked object, from where it was when attached
}
export const DEFAULT_MASK: Mask = { shape: 'ellipse', x: 0.5, y: 0.45, w: 0.6, h: 0.45, feather: 30, invert: false, mode: 'cut' }
export type Matte = 'alpha' | 'alphaInv' | 'luma' | 'lumaInv'

// A speed ramp: how the clip's footage is spread over its time on the timeline. amount 0 to 100.
export type RampKind = 'montage' | 'hero' | 'bullet' | 'flashIn' | 'flashOut'
export type Ramp = { kind: RampKind; amount: number }
export const RAMPS: { id: RampKind; label: string }[] = [
  { id: 'montage', label: 'Montage (fast, slow, fast)' },
  { id: 'hero', label: 'Hero (slow, fast, slow)' },
  { id: 'bullet', label: 'Bullet time (stops in the middle)' },
  { id: 'flashIn', label: 'Flash in (fast, then normal)' },
  { id: 'flashOut', label: 'Flash out (normal, then fast)' },
]

// The speed at each point of the clip (x = 0 to 1 across its time on the timeline), before scaling.
function rampShape(r: Ramp, x: number): number {
  const a = Math.max(0, Math.min(100, r.amount)) / 100
  const bump = (c: number, w: number) => Math.exp(-((x - c) ** 2) / (2 * w * w))
  switch (r.kind) {
    case 'montage': return 1 + a * 3 * (1 - bump(0.5, 0.18)) - a * 0.6 * bump(0.5, 0.18)
    case 'hero': return 1 - a * 0.7 * (1 - bump(0.5, 0.2)) + a * 2 * bump(0.5, 0.2)
    case 'bullet': return Math.max(0.05, 1 - a * 0.95 * bump(0.5, 0.12))
    case 'flashIn': return 1 + a * 4 * Math.max(0, 1 - x / 0.3)
    case 'flashOut': return 1 + a * 4 * Math.max(0, (x - 0.7) / 0.3)
  }
}

// The ramp as a table: fraction of the clip's time -> fraction of its footage, rising from 0 to 1.
const rampTables = new Map<string, Float64Array>()
function rampTable(r: Ramp): Float64Array {
  const k = `${r.kind}:${r.amount}`
  const hit = rampTables.get(k)
  if (hit) return hit
  const n = 512
  const t = new Float64Array(n + 1)
  for (let i = 1; i <= n; i++) t[i] = t[i - 1] + (rampShape(r, (i - 0.5) / n) / n)
  for (let i = 0; i <= n; i++) t[i] /= t[n]
  rampTables.set(k, t)
  return t
}
function rampMap(r: Ramp, x: number): number {
  const t = rampTable(r)
  const n = t.length - 1
  // Outside the clip (a transition's lead-in or run-out) it carries on at the end speeds.
  if (x <= 0) return x * (t[1] - t[0]) * n
  if (x >= 1) return 1 + (x - 1) * (t[n] - t[n - 1]) * n
  const i = Math.floor(x * n)
  return t[i] + (t[i + 1] - t[i]) * (x * n - i)
}
function rampInverse(r: Ramp, y: number): number {
  const t = rampTable(r)
  const n = t.length - 1
  if (y <= 0) return y / ((t[1] - t[0]) * n)
  if (y >= 1) return 1 + (y - 1) / ((t[n] - t[n - 1]) * n)
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= y) lo = mid
    else hi = mid
  }
  return (lo + (y - t[lo]) / Math.max(1e-12, t[hi] - t[lo])) / n
}

// A transition across a cut. It is centred on the cut, so the edit's length never changes: the clip before
// plays on for half of it, this one starts half of it early. Sound always crossfades with it.
export type TransitionType = 'dissolve' | 'dip' | 'dipWhite' | 'wipeLeft' | 'wipeUp' | 'slideLeft' | 'slideUp' | 'push' | 'zoom' | 'spin' | 'blur' | 'circle'
export type Transition = { type: TransitionType; d: number }
export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'dissolve', label: 'Cross fade' },
  { id: 'dip', label: 'Dip to black' },
  { id: 'dipWhite', label: 'Dip to white' },
  { id: 'wipeLeft', label: 'Wipe' },
  { id: 'wipeUp', label: 'Wipe up' },
  { id: 'slideLeft', label: 'Slide in' },
  { id: 'slideUp', label: 'Slide up' },
  { id: 'push', label: 'Push' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'spin', label: 'Spin' },
  { id: 'blur', label: 'Blur' },
  { id: 'circle', label: 'Circle' },
]

// A keyframe: the box's place, size, turn and see-through at a moment (seconds into the clip),
// and how the movement eases into it from the keyframe before.
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'hold'
export type KeyFrame = { t: number; x: number; y: number; w: number; h: number; rotation: number; opacity: number; ease: Ease }

// Picture effects, each 0 (off) to 100.
export type Fx = { blur: number; sharpen: number; glow: number; vignette: number; grain: number; vhs: number; shake: number; mosaic: number; beat?: number }
export const NO_FX: Fx = { blur: 0, sharpen: 0, glow: 0, vignette: 0, grain: 0, vhs: 0, shake: 0, mosaic: 0, beat: 0 }

// Green screen: take out one colour (or the dark parts, for luma) so the layers below show through.
export type Key = { mode: 'colour' | 'luma'; color: string; strength: number; softness: number; spill: number }
export const DEFAULT_KEY: Key = { mode: 'colour', color: '#00ff00', strength: 40, softness: 20, spill: 50 }

// How a layer mixes with what is under it (the browser's own blend modes).
export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' |
  'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

// A drop shadow and an outer glow that follow the picture's own shape (a cut-out casts a cut-out shadow).
export type Shade = { shadow: number; shadowColor: string; shadowBlur: number; distance: number; angle: number; glow: number; glowColor: string; glowSize: number }
export const DEFAULT_SHADE: Shade = { shadow: 60, shadowColor: '#000000', shadowBlur: 30, distance: 16, angle: 90, glow: 0, glowColor: '#f5e642', glowSize: 30 }

// A colour look: one of ours (id 'look:…') or a .cube file kept in the project (project.luts).
export type LutUse = { id: string; strength: number }
export type LutFile = { name: string; size: number; data: number[] } // r, g, b for every grid point, red fastest

// Sound effects for a clip with sound. EQ in decibels; the rest 0 (off) to 100; pitch in semitones.
export type Sfx = { low: number; mid: number; high: number; compress: number; limit: boolean; gate: number; reverb: number; room: number; pitch: number }
export const NO_SFX: Sfx = { low: 0, mid: 0, high: 0, compress: 0, limit: false, gate: 0, reverb: 0, room: 40, pitch: 0 }

// A point on a clip's volume line: seconds into the clip, and loudness (1 = as set).
export type VolPoint = { t: number; v: number }

// How a clip comes in and goes out.
export type Anim = {
  in: 'none' | 'fade' | 'pop' | 'slide' | 'typewriter' | 'zoom' | 'bounce' | 'spin'
  out: 'none' | 'fade' | 'pop' | 'slide' | 'zoom' | 'spin'
  duration: number
  during?: 'none' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'rollUp' // a slow move the whole time it is on screen (rollUp: credits)
}
export const NO_ANIM: Anim = { in: 'none', out: 'none', duration: 0.6 }

// A frame around a picture or video: line, rounded corners, drop shadow.
export type Border = { width: number; color: string; radius: number; shadow: boolean }
export const NO_BORDER: Border = { width: 0, color: '#ffffff', radius: 0, shadow: false }

// Video tracks are drawn bottom to top, so higher tracks cover lower ones. The main track (index 0) is
// magnetic: its clips play one after another with no gaps. Audio tracks only carry sound.
export type Track = {
  id: string
  kind: 'video' | 'audio'
  clips: Clip[]
  duck?: Duck
  locked?: boolean // its clips cannot be moved, trimmed or deleted
  muted?: boolean // its sound is not heard
  solo?: boolean // while any track is solo, only solo tracks are heard
  hidden?: boolean // its pictures are not shown (nor exported)
}

// Music under the voice: while the track named in `under` has sound, this track drops to `level` (0 to 1).
export type Duck = { under: string; level: number }
export const DEFAULT_DUCK_LEVEL = 0.25

export type Frame = { w: number; h: number }

// A placed clip with the extra time a transition gives it: `pre` before its start, `post` after its end.
export type Shown = Placed & { pre: number; post: number }
// Where a transition is at a moment, for drawing: how far through it (0 to 1), and which side this clip is on.
export type TransState = { type: TransitionType; u: number; side: 'in' | 'out' }

// The clips before and after each clip on the same track, touching it (the cut is shared).
function neighbours(placed: Placed[]): Map<string, { prev?: Placed; next?: Placed }> {
  const out = new Map<string, { prev?: Placed; next?: Placed }>()
  const byTrack = new Map<string, Placed[]>()
  for (const pl of placed) {
    const k = `${pl.kind}${pl.trackIndex}`
    if (!byTrack.has(k)) byTrack.set(k, [])
    byTrack.get(k)!.push(pl)
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 0; i < list.length; i++) {
      const prev = i > 0 && Math.abs(list[i - 1].end - list[i].start) < 1e-3 ? list[i - 1] : undefined
      const next = i < list.length - 1 && Math.abs(list[i].end - list[i + 1].start) < 1e-3 ? list[i + 1] : undefined
      out.set(list[i].clip.id, { prev, next })
    }
  }
  return out
}

// Half a transition, never more than half of either clip it joins.
function half(tr: Transition | undefined, a?: Placed, b?: Placed): number {
  if (!tr || !a || !b) return 0
  return Math.max(0, Math.min(tr.d / 2, (a.end - a.start) / 2, (b.end - b.start) / 2))
}

// Every clip with its transition time, video and sound alike.
export function shown(p: Project): Shown[] {
  const placed = layout(p)
  const nb = neighbours(placed)
  return placed.map((pl) => {
    const { prev, next } = nb.get(pl.clip.id) ?? {}
    return { ...pl, pre: half(pl.clip.tIn, prev, pl), post: next ? half(next.clip.tIn, pl, next) : 0 }
  })
}

export function transAt(s: Shown, t: number, next?: Shown): TransState | null {
  if (s.pre > 0 && t < s.start + s.pre && s.clip.tIn) return { type: s.clip.tIn.type, u: Math.max(0, Math.min(1, (t - (s.start - s.pre)) / (2 * s.pre))), side: 'in' }
  if (s.post > 0 && t >= s.end - s.post && next?.clip.tIn) return { type: next.clip.tIn.type, u: Math.max(0, Math.min(1, (t - (s.end - s.post)) / (2 * s.post))), side: 'out' }
  return null
}

// The clip that follows a shown clip on its track (for the transition out of it).
export function nextOf(all: Shown[], s: Shown): Shown | undefined {
  return all.find((x) => x.kind === s.kind && x.trackIndex === s.trackIndex && Math.abs(x.start - s.end) < 1e-3 && x.clip.id !== s.clip.id)
}

// A flag on the timeline at a moment, with an optional note.
export type Marker = { id: string; t: number; note: string }

export type Project = {
  frame: Frame; video: Track[]; audio: Track[]; script?: string; markers?: Marker[]; luts?: Record<string, LutFile>
  tags?: Record<string, string> // the media list: words the person put on each opened file, by source id
  lotties?: Record<string, unknown> // Lottie animations used in the edit, kept inside the project
  // More than one timeline: the others wait here, the one being edited is video/audio above.
  sequences?: { id: string; name: string; video: Track[]; audio: Track[] }[]
  seqId?: string
  seqName?: string
  // For each nested timeline, the fingerprint of what its rendered copy shows, and which source that copy is.
  nestRenders?: Record<string, { hash: string; sourceId: string }>
  // The Picture tab: its picture waits here while the edit is showing; while the picture is showing, the edit
  // waits in editStash (the editor's own screen then works on the picture).
  picture?: { frame: Frame; video: Track[] }
  editStash?: { frame: Frame; video: Track[]; audio: Track[] }
} // script: the teleprompter's words

export const FRAMES: { id: string; label: string; frame: Frame }[] = [
  { id: '9:16', label: '9:16 (TikTok, Reels, Shorts)', frame: { w: 1080, h: 1920 } },
  { id: '1:1', label: '1:1 (square)', frame: { w: 1080, h: 1080 } },
  { id: '4:5', label: '4:5 (Instagram post)', frame: { w: 1080, h: 1350 } },
  { id: '16:9', label: '16:9 (YouTube)', frame: { w: 1920, h: 1080 } },
]

export const MIN_CLIP = 0.1
export const COLOR_MAX = 3600

let nextId = 1
export const newId = (prefix: string) => `${prefix}${nextId++}`
// After a saved edit is reopened, new ids must start above every id in it, so nothing clashes.
export function reserveIdsIn(anything: unknown) {
  for (const m of JSON.stringify(anything).matchAll(/"[a-z]+(\d+)"/g)) nextId = Math.max(nextId, Number(m[1]) + 1)
}

export function emptyProject(): Project {
  return tidy({ frame: FRAMES[0].frame, video: [{ id: newId('v'), kind: 'video', clips: [] }], audio: [] })
}

export const speedOf = (c: Clip) => c.speed ?? 1
// How long a clip lasts on the timeline: its stretch of source, played at its speed.
export const clipLength = (c: Clip) => (c.out - c.in) / speedOf(c)
// The source time shown at a moment that is `local` seconds into the clip on the timeline.
export const sourceAt = (c: Clip, local: number) =>
  c.ramp ? c.in + (c.out - c.in) * rampMap(c.ramp, local / Math.max(1e-6, clipLength(c))) : c.in + local * speedOf(c)
// And back: how far into the clip on the timeline a source time is shown.
export const localAt = (c: Clip, src: number) =>
  c.ramp ? clipLength(c) * rampInverse(c.ramp, (src - c.in) / Math.max(1e-6, c.out - c.in)) : (src - c.in) / speedOf(c)

// Where every clip is on the timeline.
export type Placed = { clip: Clip; start: number; end: number; trackIndex: number; kind: 'video' | 'audio' }

export function layout(p: Project): Placed[] {
  const out: Placed[] = []
  p.video.forEach((track, trackIndex) => {
    let t = 0
    for (const clip of track.clips) {
      const start = trackIndex === 0 ? t : clip.start
      const end = start + clipLength(clip)
      if (trackIndex === 0) t = end
      out.push({ clip, start, end, trackIndex, kind: 'video' })
    }
  })
  p.audio.forEach((track, trackIndex) => {
    for (const clip of track.clips) out.push({ clip, start: clip.start, end: clip.start + clipLength(clip), trackIndex, kind: 'audio' })
  })
  return out
}

export function duration(p: Project): number {
  return layout(p).reduce((m, pl) => Math.max(m, pl.end), 0)
}

export function findPlaced(p: Project, id: string | null): Placed | null {
  return id ? layout(p).find((pl) => pl.clip.id === id) ?? null : null
}

// The clip showing on each video track at a moment, bottom to top.
// The clips showing at a moment, bottom layer first; on one track the earlier clip comes first, so during a
// transition the incoming clip is drawn over the outgoing one.
export function activeVideo(p: Project, t: number): Shown[] {
  return shown(p).filter((pl) => pl.kind === 'video' && !p.video[pl.trackIndex]?.hidden && t >= pl.start - pl.pre - 1e-9 && t < pl.end + pl.post - 1e-9)
}

export const trackOfPlaced = (p: Project, pl: Placed): Track | undefined => (pl.kind === 'video' ? p.video : p.audio)[pl.trackIndex]
export const isLocked = (p: Project, id: string | null) => {
  const pl = findPlaced(p, id)
  return !!pl && !!trackOfPlaced(p, pl)?.locked
}

// Whether a track's sound is heard: not muted, and either no track is solo or this one is.
export function audible(p: Project, t: Track | undefined): boolean {
  if (!t || t.muted) return false
  const anySolo = p.video.some((x) => x.solo) || p.audio.some((x) => x.solo)
  return !anySolo || !!t.solo
}

// The default box: the whole picture fitted inside the frame and centred (the anime-in-portrait look).
export function fitTransform(frame: Frame, srcW: number, srcH: number, mode: 'fit' | 'fill' = 'fit'): Transform {
  const s = mode === 'fit' ? Math.min(frame.w / srcW, frame.h / srcH) : Math.max(frame.w / srcW, frame.h / srcH)
  return {
    x: frame.w / 2, y: frame.h / 2, w: srcW * s, h: srcH * s,
    rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true,
    crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0,
  }
}

export function sourceSize(sources: Source[], clip: Clip): [number, number] | null {
  if (clip.kind === 'image') return clip.imageSize ?? null
  if (clip.kind !== 'media') return null
  const v = sources.find((s) => s.id === clip.sourceId)?.media.info.video
  return v ? [v.width, v.height] : null
}

export function transformOf(frame: Frame, sources: Source[], clip: Clip): Transform {
  if (clip.kind === 'text' && clip.text) {
    // Text: the box width is set by the person, the height always fits the words.
    const t = clip.transform ?? { ...fitTransform(frame, frame.w, frame.h), y: frame.h * 0.75, w: frame.w * 0.8 }
    return { ...t, h: layoutText(clip.text, t.w).height, keepRatio: true }
  }
  if (clip.transform) return clip.transform
  const size = sourceSize(sources, clip)
  if (size) return fitTransform(frame, size[0], size[1])
  return fitTransform(frame, frame.w, frame.h) // colour block: the whole frame
}

// ---- Edits. Each returns a new project and never changes the old one, so undo can keep the old ones. ----

function mapTracks(p: Project, fn: (t: Track) => Track): Project {
  return { ...p, video: p.video.map(fn), audio: p.audio.map(fn) }
}

// Keeps the main track and at least one sound track. Layers are only added or removed by the user
// (the + and − buttons), or added when a clip is dropped where there is no room.
export function tidy(p: Project): Project {
  const audio = p.audio.length ? p.audio : [{ id: newId('a'), kind: 'audio' as const, clips: [] }]
  return { ...p, audio }
}

// Adds an empty track. With an index, it goes right after that one: above it for a layer, below it for sound.
export function addTrack(p: Project, kind: 'video' | 'audio', after?: number): Project {
  const t: Track = { id: newId(kind === 'video' ? 'v' : 'a'), kind, clips: [] }
  const list = (kind === 'video' ? p.video : p.audio).slice()
  list.splice(after === undefined ? list.length : after + 1, 0, t)
  return kind === 'video' ? { ...p, video: list } : { ...p, audio: list }
}

// Removes a layer or sound track and everything on it. The main track cannot be removed.
export function removeTrack(p: Project, kind: 'video' | 'audio', index: number): Project {
  if (kind === 'video') return index === 0 ? p : { ...p, video: p.video.filter((_, i) => i !== index) }
  return tidy({ ...p, audio: p.audio.filter((_, i) => i !== index) })
}

export function updateTrack(p: Project, id: string, patch: Partial<Track>): Project {
  return mapTracks(p, (t) => (t.id === id ? { ...t, ...patch } : t))
}

export function updateClip(p: Project, id: string, patch: Partial<Clip>): Project {
  return mapTracks(p, (t) => (t.clips.some((c) => c.id === id) ? { ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : t))
}

// Puts these clips where one clip was, in its place on the same track.
export function replaceClip(p: Project, id: string, clips: Clip[]): Project {
  return tidy(mapTracks(p, (t) => {
    const i = t.clips.findIndex((c) => c.id === id)
    if (i < 0) return t
    const next = t.clips.slice()
    next.splice(i, 1, ...clips)
    return { ...t, clips: next }
  }))
}

export function removeClip(p: Project, id: string): Project {
  return tidy(mapTracks(p, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) })))
}

export function appendToMain(p: Project, clip: Clip): Project {
  return tidy({ ...p, video: p.video.map((t, i) => (i === 0 ? { ...t, clips: [...t.clips, clip] } : t)) })
}

const overlaps = (clips: Clip[], start: number, end: number, ignore?: string) =>
  clips.some((c) => c.id !== ignore && start < c.start + clipLength(c) - 1e-6 && end > c.start + 1e-6)

// Puts a clip on a layer at a time. If that spot is taken, it goes up to the first layer with room.
export function placeOnLayer(p: Project, clip: Clip, kind: 'video' | 'audio', trackIndex: number, start: number): Project {
  const tracks = (kind === 'video' ? p.video : p.audio).slice()
  let i = Math.max(kind === 'video' ? 1 : 0, trackIndex)
  const s = Math.max(0, start)
  while (i < tracks.length && overlaps(tracks[i].clips, s, s + clipLength(clip), clip.id)) i++
  if (i >= tracks.length) tracks.push({ id: newId(kind === 'video' ? 'v' : 'a'), kind, clips: [] })
  tracks[i] = { ...tracks[i], clips: [...tracks[i].clips, { ...clip, start: s }].sort((a, b) => a.start - b.start) }
  return tidy(kind === 'video' ? { ...p, video: tracks } : { ...p, audio: tracks })
}

// Moves a clip to a track: to a time on a layer, or to a slot on the main track.
export function moveClip(p: Project, id: string, kind: 'video' | 'audio', trackIndex: number, start: number, mainIndex: number): Project {
  const placed = findPlaced(p, id)
  if (!placed || placed.kind !== kind) return p // video stays on video layers, sound-only on audio tracks
  const clip = placed.clip
  const without = mapTracks(p, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) }))
  if (kind === 'video' && trackIndex === 0) {
    const clips = without.video[0].clips.slice()
    clips.splice(Math.max(0, Math.min(mainIndex, clips.length)), 0, clip)
    return tidy({ ...without, video: without.video.map((t, i) => (i === 0 ? { ...t, clips } : t)) })
  }
  return placeOnLayer(without, clip, kind, trackIndex, start)
}

// Splits a clip at a timeline time into two pieces.
export function splitClip(p: Project, id: string, t: number): Project {
  const pl = findPlaced(p, id)
  if (!pl || t - pl.start < MIN_CLIP || pl.end - t < MIN_CLIP) return p
  const cut = sourceAt(pl.clip, t - pl.start)
  // A fade in stays on the first piece and a fade out on the second, so the cut itself plays at full sound.
  const left: Clip = { ...pl.clip, id: newId('c'), out: cut, fadeOut: 0 }
  const right: Clip = { ...pl.clip, id: newId('c'), in: cut, start: t, fadeIn: 0 }
  return mapTracks(p, (tr) => {
    const i = tr.clips.findIndex((c) => c.id === id)
    if (i < 0) return tr
    const clips = tr.clips.slice()
    clips.splice(i, 1, left, right)
    return { ...tr, clips }
  })
}

// The clips that go with this one: its group, or just itself.
export function groupOf(p: Project, id: string): string[] {
  const c = findPlaced(p, id)?.clip
  if (!c?.group) return [id]
  return layout(p).filter((pl) => pl.clip.group === c.group).map((pl) => pl.clip.id)
}

export function setGroup(p: Project, ids: string[], group: string | undefined): Project {
  const set = new Set(ids)
  return mapTracks(p, (t) => (t.clips.some((c) => set.has(c.id)) ? { ...t, clips: t.clips.map((c) => (set.has(c.id) ? { ...c, group } : c)) } : t))
}

// Deletes a clip and pulls everything after it on the same track left by its length, so no gap is left.
// The main track already closes up by itself.
export function rippleDelete(p: Project, id: string): Project {
  const pl = findPlaced(p, id)
  if (!pl) return p
  if (pl.kind === 'video' && pl.trackIndex === 0) return removeClip(p, id)
  const len = pl.end - pl.start
  return tidy(mapTracks(p, (t) => {
    if (!t.clips.some((c) => c.id === id)) return t
    return { ...t, clips: t.clips.filter((c) => c.id !== id).map((c) => (c.start >= pl.end - 1e-6 ? { ...c, start: Math.max(0, c.start - len) } : c)) }
  }))
}

// The empty stretch on a layer or sound track around a time, or null if a clip is there.
export function gapAt(p: Project, kind: 'video' | 'audio', trackIndex: number, t: number): [number, number] | null {
  if (kind === 'video' && trackIndex === 0) return null
  const track = (kind === 'video' ? p.video : p.audio)[trackIndex]
  if (!track) return null
  let a = 0
  let b = Infinity
  for (const c of track.clips) {
    const s = c.start
    const e = c.start + clipLength(c)
    if (t >= s && t < e) return null
    if (e <= t) a = Math.max(a, e)
    if (s > t) b = Math.min(b, s)
  }
  return b === Infinity ? null : [a, b]
}

// Closes the gap at a time: everything after it on that track moves left to meet what is before it.
export function closeGap(p: Project, kind: 'video' | 'audio', trackIndex: number, t: number): Project {
  const gap = gapAt(p, kind, trackIndex, t)
  if (!gap) return p
  const d = gap[1] - gap[0]
  const list = (kind === 'video' ? p.video : p.audio).map((tr, i) =>
    i === trackIndex ? { ...tr, clips: tr.clips.map((c) => (c.start >= gap[1] - 1e-6 ? { ...c, start: c.start - d } : c)) } : tr)
  return kind === 'video' ? { ...p, video: list } : { ...p, audio: list }
}

// Pushes everything on a track that starts at or after `from` later by `by` seconds (or earlier, if negative).
export function shiftAfter(p: Project, kind: 'video' | 'audio', trackIndex: number, from: number, by: number, except?: string): Project {
  if (kind === 'video' && trackIndex === 0) return p
  const list = (kind === 'video' ? p.video : p.audio).map((tr, i) =>
    i === trackIndex ? { ...tr, clips: tr.clips.map((c) => (c.id !== except && c.start >= from - 1e-6 ? { ...c, start: Math.max(0, c.start + by) } : c)) } : tr)
  return kind === 'video' ? { ...p, video: list } : { ...p, audio: list }
}

// Puts a clip right after another one on the same track: next in line on the main track, at its end on a layer.
// Everything later on a layer moves along to make room.
export function insertAfter(p: Project, afterId: string, clip: Clip): Project {
  const pl = findPlaced(p, afterId)
  if (!pl) return p
  const len = clipLength(clip)
  if (pl.kind === 'video' && pl.trackIndex === 0) {
    return { ...p, video: p.video.map((t, i) => {
      if (i !== 0) return t
      const clips = t.clips.slice()
      clips.splice(clips.findIndex((c) => c.id === afterId) + 1, 0, clip)
      return { ...t, clips }
    }) }
  }
  const moved = shiftAfter(p, pl.kind, pl.trackIndex, pl.end, len)
  const list = (pl.kind === 'video' ? moved.video : moved.audio).map((t, i) =>
    i === pl.trackIndex ? { ...t, clips: [...t.clips, { ...clip, start: pl.end }].sort((a, b) => a.start - b.start) } : t)
  return pl.kind === 'video' ? { ...moved, video: list } : { ...moved, audio: list }
}

export function addMarker(p: Project, t: number, note = ''): Project {
  return { ...p, markers: [...(p.markers ?? []), { id: newId('m'), t, note }].sort((a, b) => a.t - b.t) }
}
export function updateMarker(p: Project, id: string, patch: Partial<Marker>): Project {
  return { ...p, markers: (p.markers ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t) }
}
export function removeMarker(p: Project, id: string): Project {
  return { ...p, markers: (p.markers ?? []).filter((m) => m.id !== id) }
}

// ---- Keyframes ----

const easeFn: Record<Ease, (u: number) => number> = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u * u,
  out: (u) => 1 - Math.pow(1 - u, 3),
  hold: () => 0,
}

// Catmull-Rom: a smooth curve through the points, so a curved path passes exactly through every keyframe.
function curve(p0: number, p1: number, p2: number, p3: number, u: number): number {
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
}

// Where the box is `local` seconds into the clip: its keyframes worked out in between, or its plain place if it has none.
export function transformAt(frame: Frame, sources: Source[], clip: Clip, local: number): Transform {
  const base = transformOf(frame, sources, clip)
  const keys = clip.keys
  if (!keys?.length) return base
  const ks = keys.slice().sort((a, b) => a.t - b.t)
  const pick = (k: KeyFrame) => ({ ...base, x: k.x, y: k.y, w: k.w, h: clip.kind === 'text' ? base.h : k.h, rotation: k.rotation, opacity: k.opacity })
  if (local <= ks[0].t) return pick(ks[0])
  const last = ks[ks.length - 1]
  if (local >= last.t) return pick(last)
  let i = ks.findIndex((k) => k.t > local) - 1
  if (i < 0) i = 0
  const a = ks[i]
  const b = ks[i + 1]
  const u = easeFn[b.ease]((local - a.t) / Math.max(1e-6, b.t - a.t))
  const lerp = (p: number, q: number) => p + (q - p) * u
  let x = lerp(a.x, b.x)
  let y = lerp(a.y, b.y)
  if (clip.path === 'curved' && ks.length > 2) {
    const p0 = ks[Math.max(0, i - 1)]
    const p3 = ks[Math.min(ks.length - 1, i + 2)]
    x = curve(p0.x, a.x, b.x, p3.x, u)
    y = curve(p0.y, a.y, b.y, p3.y, u)
  }
  return {
    ...base, x, y, w: lerp(a.w, b.w), h: clip.kind === 'text' ? base.h : lerp(a.h, b.h),
    rotation: lerp(a.rotation, b.rotation), opacity: lerp(a.opacity, b.opacity),
  }
}

const SAME_MOMENT = 1 / 50

// A change to the box at a moment: with keyframes, it goes into the keyframe there (made if there is none);
// without, it changes the box itself.
export function placeAt(clip: Clip, local: number, t: Transform): Partial<Clip> {
  if (!clip.keys?.length) return { transform: t }
  const k = { t: local, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation, opacity: t.opacity }
  const at = clip.keys.findIndex((x) => Math.abs(x.t - local) < SAME_MOMENT)
  const keys = at >= 0 ? clip.keys.map((x, i) => (i === at ? { ...x, ...k, t: x.t } : x)) : [...clip.keys, { ...k, ease: 'smooth' as Ease }].sort((a, b) => a.t - b.t)
  // The parts keyframes do not move (crop, flip, soft edge) still change on the box itself.
  return { keys, transform: { ...(clip.transform ?? t), crop: t.crop, flipH: t.flipH, flipV: t.flipV, feather: t.feather, keepRatio: t.keepRatio } }
}

export function addKeyAt(frame: Frame, sources: Source[], clip: Clip, local: number): Partial<Clip> {
  const t = transformAt(frame, sources, clip, local)
  const k: KeyFrame = { t: local, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation, opacity: t.opacity, ease: 'smooth' }
  const keys = (clip.keys ?? []).filter((x) => Math.abs(x.t - local) >= SAME_MOMENT)
  return { keys: [...keys, k].sort((a, b) => a.t - b.t) }
}

// ---- Putting a part of a file on the main track at the playhead ----

const mainPlaced = (p: Project) => layout(p).filter((pl) => pl.kind === 'video' && pl.trackIndex === 0)

// Cuts the main track at a time, if a clip is there (not at an edge).
function cutMainAt(p: Project, t: number): Project {
  const at = mainPlaced(p).find((pl) => t > pl.start + MIN_CLIP && t < pl.end - MIN_CLIP)
  return at ? splitClip(p, at.clip.id, t) : p
}

// Insert: everything on the main track from the playhead on moves along to make room.
export function insertOnMain(p: Project, clip: Clip, t: number): Project {
  const cut = cutMainAt(p, t)
  const index = mainPlaced(cut).filter((pl) => pl.start < t - 1e-6).length
  return { ...cut, video: cut.video.map((tr, i) => (i ? tr : { ...tr, clips: [...tr.clips.slice(0, index), clip, ...tr.clips.slice(index)] })) }
}

// Overwrite: the clip replaces whatever was on the main track for its length, from the playhead.
export function overwriteOnMain(p: Project, clip: Clip, t: number): Project {
  const len = clipLength(clip)
  let next = cutMainAt(cutMainAt(p, t), t + len)
  const gone = new Set(mainPlaced(next).filter((pl) => pl.start >= t - 1e-6 && pl.end <= t + len + 1e-6).map((pl) => pl.clip.id))
  next = { ...next, video: next.video.map((tr, i) => (i ? tr : { ...tr, clips: tr.clips.filter((c) => !gone.has(c.id)) })) }
  return insertOnMain(next, clip, t)
}

// ---- Following a tracked object ----

// Where a tracked clip's tracked point is on the frame at timeline time t, or null when it is not showing.
export function trackedPoint(p: Project, sources: Source[], id: string, t: number, sample: (list: [number, number, number][], at: number) => [number, number, number] | null): { x: number; y: number } | null {
  const pl = layout(p).find((x) => x.clip.id === id)
  if (!pl || !pl.clip.track?.points.length || t < pl.start || t >= pl.end) return null
  const pt = sample(pl.clip.track.points, sourceAt(pl.clip, t - pl.start))
  if (!pt) return null
  const tr = transformAt(p.frame, sources, pl.clip, t - pl.start)
  return { x: tr.x - tr.w / 2 + pt[1] * tr.w, y: tr.y - tr.h / 2 + pt[2] * tr.h }
}
