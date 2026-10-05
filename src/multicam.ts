import { PEAKS_PER_SECOND, peaksStore } from './overview'
import { addTrack, findPlaced, newId, placeOnLayer, removeClip, sourceAt, tidy, type Clip, type Project } from './model'

// Multicam: two to four recordings of the same moment, lined up by their sound, then cut between while it plays.

// How far B's sound is behind A's (in seconds): the shift that best matches their loudness over time.
// Looks up to a minute either way. Uses the sound waves already read for the timeline.
export function soundOffset(a: Float32Array, b: Float32Array, maxSeconds = 60): { lag: number; score: number } {
  const n = PEAKS_PER_SECOND
  const norm = (x: Float32Array) => {
    let m = 0
    for (const v of x) m += v
    m /= Math.max(1, x.length)
    return Float32Array.from(x, (v) => v - m)
  }
  const A = norm(a)
  const B = norm(b)
  const max = Math.min(maxSeconds * n, Math.max(A.length, B.length))
  let best = -Infinity
  let bestLag = 0
  for (let l = -max; l <= max; l++) {
    let s = 0
    let count = 0
    for (let i = Math.max(0, -l); i < A.length && i + l < B.length; i++) {
      s += A[i] * B[i + l]
      count++
    }
    if (count < n * 2) continue // at least two seconds overlapping
    s /= count
    if (s > best) {
      best = s
      bestLag = l
    }
  }
  return { lag: bestLag / n, score: best }
}

// Lines the clips up with the first one, by sound. The first stays put; the others go on layers above, starting
// where their sound matches. Returns null if a clip has no sound wave yet.
export function syncBySound(p: Project, ids: string[]): Project | null {
  const placed = ids.map((id) => findPlaced(p, id)).filter((x): x is NonNullable<typeof x> => !!x)
  if (placed.length < 2) return p
  const ref = placed[0]
  const refPeaks = peaksStore.get(ref.clip.sourceId!)
  if (!refPeaks) return null
  let next = p
  for (const other of placed.slice(1)) {
    const peaks = peaksStore.get(other.clip.sourceId!)
    if (!peaks) return null
    const { lag } = soundOffset(refPeaks, peaks)
    // A moment at the reference file's time ta is heard in this file at ta + lag.
    let start = ref.start - ref.clip.in + other.clip.in - lag
    let clip: Clip = { ...other.clip }
    if (start < 0) {
      clip = { ...clip, in: clip.in - start }
      start = 0
    }
    next = removeClip(next, other.clip.id)
    next = placeOnLayer(next, clip, 'video', Math.max(1, next.video.length), start)
  }
  return tidy(next)
}

export type Cut = { t: number; angle: number }

// Turns the angles and the cuts into plain clips: each angle keeps only the stretches where it was chosen, on
// layers above everything, and the first angle's sound plays all the way through on a sound track.
export function flattenMulticam(p: Project, ids: string[], cuts: Cut[]): Project {
  const angles = ids.map((id) => findPlaced(p, id)).filter((x): x is NonNullable<typeof x> => !!x)
  if (!angles.length) return p
  const from = Math.min(...angles.map((a) => a.start))
  const to = Math.max(...angles.map((a) => a.end))
  const list = [{ t: from, angle: cuts[0]?.angle ?? 0 }, ...cuts].filter((c) => c.t >= from && c.t < to).sort((a, b) => a.t - b.t)
  let next = p
  // Angles on layers are taken away (their chosen stretches come back on the new top layer). An angle on the main
  // track stays, silent, so nothing after it moves; the new layer covers it the whole time.
  for (const a of angles) {
    if (a.kind === 'video' && a.trackIndex === 0) next = { ...next, video: next.video.map((t, i) => (i ? t : { ...t, clips: t.clips.map((c) => (c.id === a.clip.id ? { ...c, volume: 0 } : c)) })) }
    else next = removeClip(next, a.clip.id)
  }
  // Layers the angles came from that are now empty go too.
  const emptied = new Set(angles.filter((a) => !(a.kind === 'video' && a.trackIndex === 0)).map((a) => p.video[a.trackIndex]?.id))
  next = { ...next, video: next.video.filter((t, i) => i === 0 || t.clips.length > 0 || !emptied.has(t.id)) }
  // The sound of the first angle, whole, on its own sound track.
  const first = angles[0]
  next = addTrack(next, 'audio')
  next = placeOnLayer(next, { ...first.clip, id: newId('c') }, 'audio', next.audio.length - 1, first.start)
  // One new layer on top for the picture, holding each chosen stretch in turn.
  next = addTrack(next, 'video')
  const layer = next.video.length - 1
  for (let i = 0; i < list.length; i++) {
    const a0 = list[i].t
    const a1 = i + 1 < list.length ? list[i + 1].t : to
    const ang = angles[list[i].angle]
    if (!ang || a1 - a0 < 0.05) continue
    const s0 = Math.max(a0, ang.start)
    const s1 = Math.min(a1, ang.end)
    if (s1 - s0 < 0.05) continue
    const piece: Clip = { ...ang.clip, id: newId('c'), in: sourceAt(ang.clip, s0 - ang.start), out: sourceAt(ang.clip, s1 - ang.start), volume: 0, fadeIn: 0, fadeOut: 0 }
    next = placeOnLayer(next, piece, 'video', layer, s0)
  }
  return tidy(next)
}
