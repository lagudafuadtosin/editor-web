import { layout, sourceAt, type Placed, type Project, type Track } from './model'
import { PEAKS_PER_SECOND, peaksStore } from './overview'

// How loud each clip's sound is from moment to moment: its volume, its fade in and out, and,
// on a track set to sit under the voice, dipping while the voice track has sound.
// Playback and export both use this, so what you hear is what you get.

const STEP = 0.05 // seconds between envelope points
const TALK = 0.3 // on the wave's 0 to 1 scale, louder than this counts as sound on the voice track
const BRIDGE = 0.6 // pauses shorter than this do not bring the music back up
const DOWN = 0.2 // seconds the music takes to dip before the voice starts
const UP = 0.5 // and to come back after it stops

export const trackOf = (p: Project, pl: Placed): Track | undefined => (pl.kind === 'video' ? p.video : p.audio)[pl.trackIndex]

export function findTrack(p: Project, id: string): Track | undefined {
  return p.video.find((t) => t.id === id) ?? p.audio.find((t) => t.id === id)
}

// The stretches of the timeline where a track has sound, from each file's wave.
const rangesCache = new WeakMap<Project, Map<string, [number, number][]>>()
export function soundRanges(p: Project, trackId: string): [number, number][] {
  let byTrack = rangesCache.get(p)
  if (!byTrack) rangesCache.set(p, (byTrack = new Map()))
  const cached = byTrack.get(trackId)
  if (cached) return cached
  const out: [number, number][] = []
  let complete = true
  for (const pl of layout(p)) {
    if (pl.clip.kind !== 'media' || (pl.clip.volume ?? 1) <= 0 || trackOf(p, pl)?.id !== trackId) continue
    const peaks = peaksStore.get(pl.clip.sourceId!)
    if (!peaks) {
      complete = false // its wave is still being read: work it out again next time
      continue
    }
    let open: number | null = null
    for (let t = pl.start; t < pl.end; t += 1 / PEAKS_PER_SECOND) {
      const v = peaks[Math.floor(sourceAt(pl.clip, t - pl.start) * PEAKS_PER_SECOND)] ?? 0
      if (v > TALK && open === null) open = t
      if (v <= TALK && open !== null) {
        out.push([open, t])
        open = null
      }
    }
    if (open !== null) out.push([open, pl.end])
  }
  out.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] - last[1] < BRIDGE) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  if (complete) byTrack.set(trackId, merged)
  return merged
}

function duckAt(t: number, ranges: [number, number][], level: number): number {
  let g = 1
  for (const [a, b] of ranges) {
    if (a - DOWN > t) break
    let f: number
    if (t < a) f = (a - t) / DOWN
    else if (t <= b) f = 0
    else f = (t - b) / UP
    if (f < 1) g = Math.min(g, level + (1 - level) * f)
  }
  return g
}

export function gainAt(p: Project, pl: Placed, t: number): number {
  const c = pl.clip
  const local = t - pl.start
  const len = pl.end - pl.start
  let g = 1
  if (c.fadeIn) g = Math.min(g, local / c.fadeIn)
  if (c.fadeOut) g = Math.min(g, (len - local) / c.fadeOut)
  g = Math.max(0, Math.min(1, g)) * (c.volume ?? 1)
  const duck = trackOf(p, pl)?.duck
  if (duck && duck.under !== trackOf(p, pl)?.id) g *= duckAt(t, soundRanges(p, duck.under), duck.level)
  return g
}

// Schedules a clip's loudness from timeline t0 to t1 on a gain, with `at` turning timeline time into the mixer's time.
export function applyGain(param: AudioParam, p: Project, pl: Placed, t0: number, t1: number, at: (t: number) => number) {
  const pts: [number, number][] = []
  for (let t = t0; t < t1; t += STEP) pts.push([t, gainAt(p, pl, t)])
  pts.push([t1, gainAt(p, pl, Math.max(t0, t1 - 1e-4))])
  param.setValueAtTime(pts[0][1], Math.max(0, at(pts[0][0])))
  for (let i = 1; i < pts.length; i++) {
    // Steady stretches need only their two ends.
    if (i < pts.length - 1 && pts[i][1] === pts[i - 1][1] && pts[i][1] === pts[i + 1][1]) continue
    param.linearRampToValueAtTime(pts[i][1], Math.max(0, at(pts[i][0])))
  }
}
