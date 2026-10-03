import type { OpenedMedia } from './media'
import type { Look } from './look'
import { layoutText, type TextStyle } from './text'

// A file the user has opened. Clips point at it, they never copy it.
export type Source = { id: string; name: string; media: OpenedMedia; file?: { name: string; size: number; lastModified: number } }

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
  kind: 'media' | 'image' | 'color' | 'text'
  imageId?: string // pictures: the decoded image in imageStore
  imageSize?: [number, number] // pictures: their own width and height
  label?: string // pictures: the file name shown on the timeline
  sourceId?: string
  color?: string
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
}

// How a clip comes in and goes out.
export type Anim = { in: 'none' | 'fade' | 'pop' | 'slide' | 'typewriter'; out: 'none' | 'fade' | 'pop' | 'slide'; duration: number }
export const NO_ANIM: Anim = { in: 'none', out: 'none', duration: 0.4 }

// A frame around a picture or video: line, rounded corners, drop shadow.
export type Border = { width: number; color: string; radius: number; shadow: boolean }
export const NO_BORDER: Border = { width: 0, color: '#ffffff', radius: 0, shadow: false }

// Video tracks are drawn bottom to top, so higher tracks cover lower ones. The main track (index 0) is
// magnetic: its clips play one after another with no gaps. Audio tracks only carry sound.
export type Track = { id: string; kind: 'video' | 'audio'; clips: Clip[]; duck?: Duck }

// Music under the voice: while the track named in `under` has sound, this track drops to `level` (0 to 1).
export type Duck = { under: string; level: number }
export const DEFAULT_DUCK_LEVEL = 0.25

export type Frame = { w: number; h: number }

export type Project = { frame: Frame; video: Track[]; audio: Track[]; script?: string } // script: the teleprompter's words

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
export const sourceAt = (c: Clip, local: number) => c.in + local * speedOf(c)

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
export function activeVideo(p: Project, t: number): Placed[] {
  return layout(p).filter((pl) => pl.kind === 'video' && t >= pl.start - 1e-9 && t < pl.end - 1e-9)
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
