import { newId, type Clip, type Frame, type Project, type Track } from './model'

// The Picture tab. A picture is a frame and its layers, kept in the project. Opening the tab swaps it in where the
// edit's tracks are, so the same preview, handles and panels work on it; the edit waits in editStash until the tab
// is left. Nothing in a picture moves: it is always seen at its first moment.

export const inPicture = (p: Project) => !!p.editStash

const emptyTracks = (): Track[] => [{ id: newId('v'), kind: 'video', clips: [] }]

export function toPicture(p: Project): Project {
  if (p.editStash) return p
  const pic = p.picture ?? { frame: { ...p.frame }, video: emptyTracks() }
  return {
    ...p,
    editStash: { frame: p.frame, video: p.video, audio: p.audio },
    picture: undefined,
    frame: pic.frame,
    video: pic.video,
    audio: [{ id: newId('a'), kind: 'audio', clips: [] }],
  }
}

export function toEdit(p: Project): Project {
  if (!p.editStash) return p
  const s = p.editStash
  return { ...p, picture: { frame: p.frame, video: p.video }, editStash: undefined, frame: s.frame, video: s.video, audio: s.audio }
}

// Every clip in the picture and the edit, wherever each is waiting (for saving the pictures they use).
export function allClips(p: Project): Clip[] {
  const tracks = [...p.video, ...p.audio, ...(p.picture?.video ?? []), ...(p.editStash ? [...p.editStash.video, ...p.editStash.audio] : [])]
  return tracks.flatMap((t) => t.clips)
}

// The photo's own shape for the picture, at most 4096 pixels on its long side.
export function frameOf(w: number, h: number): Frame {
  const s = Math.min(1, 4096 / Math.max(w, h))
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

// Straighten: turns a photo by a few degrees and makes it just big enough that its own box has no empty corners.
// The zoom for a turn of a degrees on a box of shape r (long side over short side) is cos a + r sin a.
export function straighten<T extends { w: number; h: number; rotation: number }>(t: T, angle: number): T {
  const r = Math.max(t.w / t.h, t.h / t.w)
  const k = (deg: number) => Math.cos((Math.abs(deg) * Math.PI) / 180) + r * Math.sin((Math.abs(deg) * Math.PI) / 180)
  const a = Math.max(-20, Math.min(20, angle))
  const grow = k(a) / k(t.rotation)
  return { ...t, rotation: a, w: t.w * grow, h: t.h * grow }
}

// Moves a layer up (+1) or down (-1) among the layers above the background.
export function moveLayer(p: Project, index: number, dir: 1 | -1): Project {
  const to = index + dir
  if (index < 1 || to < 1 || to >= p.video.length) return p
  const video = p.video.slice()
  ;[video[index], video[to]] = [video[to], video[index]]
  return { ...p, video }
}
