import { useEffect, useRef, useState } from 'react'
import { SHAPES } from './shape'
import { IS_WEB } from './edition' // web version: ripple, roll, slip and slide drags are in the free app
import { COLOR_MAX, layout, MIN_CLIP, shiftAfter, updateClip, type Clip, type Placed, type Project, type Source, type VolPoint } from './model'
import { EyeOff, Lock, MoreHorizontal, VolumeX } from 'lucide-react'
import { drawStrip, type Overview } from './overview'
import { imageStore } from './images'

type Props = {
  project: Project
  sources: Source[]
  time: number
  duration: number
  pxPerSec: number
  selectedId: string | null
  overviews: Map<string, Overview>
  onSeek: (t: number) => void
  onSelect: (id: string | null) => void
  // Live trim while dragging (not saved to undo), then onCommit once the drag ends.
  onTrimLive: (id: string, patch: Partial<Clip>) => void
  onCommit: () => void
  onMove: (id: string, kind: 'video' | 'audio', trackIndex: number, start: number, mainIndex: number) => void
  onRemoveTrack: (kind: 'video' | 'audio', index: number) => void
  onAddTrack: (kind: 'video' | 'audio', after: number) => void
  // Clips picked with Ctrl+click as well as the selected one.
  extraIds: string[]
  onToggleSelect: (id: string) => void
  // A whole-project change while dragging (ripple, roll, slip, slide), worked out from the project as it was.
  onLive: (next: Project) => void
  onClipMenu: (id: string, x: number, y: number) => void
  onRowMenu: (kind: 'video' | 'audio', index: number, t: number, x: number, y: number) => void
  onTrackMenu: (kind: 'video' | 'audio', index: number, x: number, y: number) => void
  onMarkerMenu: (id: string, x: number, y: number) => void
  // A one-shot change to a clip, saved to undo at once (adding or deleting a volume point).
  onSetClip: (id: string, patch: Partial<Clip>) => void
  cached?: [number, number] | null // a rendered stretch, shown as a green line under the ruler
}

type Row = { kind: 'video' | 'audio'; index: number; height: number; label: string }

type Drag =
  | { kind: 'trim'; id: string; side: 'in' | 'out'; x0: number; in0: number; out0: number; start0: number; max: number; main: boolean; speed: number }
  | { kind: 'move'; id: string; x0: number; y0: number; start0: number; moved: boolean; x: number; y: number }
  | { kind: 'fade'; id: string; side: 'in' | 'out'; x0: number; v0: number; max: number }
  | { kind: 'scrub' }
  // A point on a clip's volume line: left and right moves it in time, up and down makes it louder or quieter.
  | { kind: 'vol'; id: string; index: number; x0: number; y0: number; points: VolPoint[]; len: number; h: number }
  // Shift on a layer's edge: everything after it on the track moves with it.
  | { kind: 'ripple'; id: string; side: 'in' | 'out'; x0: number; base: Project; pl: Placed; max: number }
  // Alt on an edge where two clips touch: one gets longer, the other shorter, the cut moves.
  | { kind: 'roll'; id: string; x0: number; base: Project; a: Clip; b: Clip; maxA: number }
  // Alt on a clip: a different part of the same video, in the same place and length.
  | { kind: 'slip'; id: string; x0: number; base: Project; c: Clip; max: number }
  // Alt+Shift on a main-track clip: it stays as it is and moves along, the clips either side give and take.
  | { kind: 'slide'; id: string; x0: number; base: Project; prev: Clip; next: Clip; maxPrev: number }

const COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#ea580c', '#db2777']
// Each layer's height says what is on it: video tallest, pictures medium, text and captions slim.
const VIDEO_ROW = 84
const IMAGE_ROW = 62
const TEXT_ROW = 40
const EMPTY_ROW = 48
const AUDIO_ROW = 52

function videoRowHeight(clips: Clip[], main: boolean): number {
  if (main) return VIDEO_ROW
  if (!clips.length) return EMPTY_ROW
  if (clips.some((c) => c.kind === 'media')) return VIDEO_ROW
  if (clips.some((c) => c.kind === 'image')) return IMAGE_ROW
  return TEXT_ROW
}
const SNAP_PX = 8

// Keeps the pointer on the dragged element even outside it. A test's made-up pointer cannot be captured, and that is fine.
function capture(e: React.PointerEvent) {
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
}

function niceStep(pxPerSec: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pxPerSec >= 70) return s
  return 600
}

function label(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.round(t - m * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function Timeline(p: Props) {
  const innerRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  // Handlers read the ref, not the state: a fast drag can fire move and up before React re-renders.
  const dragRef = useRef<Drag | null>(null)
  function setDrag(d: Drag | null) {
    dragRef.current = d
    setDragState(d)
  }

  // Where an edge has locked on: a guide line is drawn there while dragging.
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const placed = layout(p.project)
  // Top to bottom on screen: the highest layer first, the main track, then the sound tracks.
  const rows: Row[] = [
    ...p.project.video.map((t, i) => ({ kind: 'video' as const, index: i, height: videoRowHeight(t.clips, i === 0), label: i === 0 ? 'Main' : `Layer ${i}` })).reverse(),
    ...p.project.audio.map((_, i) => ({ kind: 'audio' as const, index: i, height: AUDIO_ROW, label: `Sound ${i + 1}` })),
  ]
  const track = (r: Row) => (r.kind === 'video' ? p.project.video : p.project.audio)[r.index]
  const rowTop = (r: Row) => {
    let y = 0
    for (const x of rows) {
      if (x.kind === r.kind && x.index === r.index) return y
      y += x.height
    }
    return y
  }
  const width = Math.max(p.duration * p.pxPerSec + 400, 600)
  const step = niceStep(p.pxPerSec)
  const sourceIndex = new Map(p.sources.map((s, i) => [s.id, i]))

  function timeAtClientX(clientX: number): number {
    const rect = innerRef.current!.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left) / p.pxPerSec)
  }

  function rowAtClientY(clientY: number): Row {
    const rect = rowsRef.current!.getBoundingClientRect()
    let y = clientY - rect.top
    if (y < 0) return rows[0]
    for (const r of rows) {
      if (y < r.height) return r
      y -= r.height
    }
    return rows[rows.length - 1]
  }

  // Snaps a time to the playhead, the start, or another clip's edge when close enough.
  function snap(t: number, ignoreId: string): number {
    // The playhead, the start, every other clip's edges, and every marker (beats, notes).
    const targets = [p.time, 0, ...placed.filter((pl) => pl.clip.id !== ignoreId).flatMap((pl) => [pl.start, pl.end]), ...(p.project.markers ?? []).map((m) => m.t)]
    let best = t
    let bestPx = SNAP_PX
    for (const s of targets) {
      const d = Math.abs(s - t) * p.pxPerSec
      if (d < bestPx) {
        best = s
        bestPx = d
      }
    }
    return best
  }

  // Where a moved clip would land: its row, its start time, and its slot if the row is the main track.
  function dropTarget(d: Extract<Drag, { kind: 'move' }>) {
    const pl = placed.find((x) => x.clip.id === d.id)!
    const row = rowAtClientY(d.y)
    const len = pl.end - pl.start
    const raw = Math.max(0, d.start0 + (d.x - d.x0) / p.pxPerSec)
    // Snap the start, or failing that the end, to whatever is nearby.
    let start = snap(raw, d.id)
    let snapAt: number | null = start !== raw ? start : null
    if (start === raw) {
      const end = snap(raw + len, d.id)
      if (end !== raw + len) {
        start = Math.max(0, end - len)
        snapAt = end
      }
    }
    let mainIndex = 0
    if (row.kind === 'video' && row.index === 0) {
      const t = timeAtClientX(d.x)
      for (const m of placed) if (m.kind === 'video' && m.trackIndex === 0 && m.clip.id !== d.id && t > (m.start + m.end) / 2) mainIndex++
    }
    return { row, start, mainIndex, len, pl, snapAt }
  }

  const scrubX = useRef<number | null>(null)
  function scrubTo(clientX: number) {
    const first = scrubX.current === null
    scrubX.current = clientX
    if (!first) return
    requestAnimationFrame(() => {
      if (scrubX.current !== null) p.onSeek(Math.min(p.duration, timeAtClientX(scrubX.current)))
      scrubX.current = null
    })
  }
  function startScrub(e: React.PointerEvent) {
    if (e.button !== 0) return
    capture(e)
    setDrag({ kind: 'scrub' })
    p.onSeek(Math.min(p.duration, timeAtClientX(e.clientX)))
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'scrub') scrubTo(e.clientX)
    else if (d.kind === 'fade') {
      // The fade in grows as its dot is pulled right, the fade out as its dot is pulled left.
      const dx = (e.clientX - d.x0) / p.pxPerSec
      const v = Math.max(0, Math.min(d.max, d.v0 + (d.side === 'in' ? dx : -dx)))
      p.onTrimLive(d.id, d.side === 'in' ? { fadeIn: Math.round(v * 10) / 10 } : { fadeOut: Math.round(v * 10) / 10 })
    } else if (d.kind === 'trim') {
      // Work in timeline seconds; a sped-up clip uses more (or less) of its source per timeline second.
      const sp = d.speed
      const len0 = (d.out0 - d.in0) / sp
      let ts = (e.clientX - d.x0) / p.pxPerSec
      // The edge being dragged locks onto any clip edge or cut above or below, or the playhead.
      let line: number | null = null
      if (d.side === 'in') {
        if (d.main) {
          // On the main track the clip's start stays put and its end moves, so the end is what snaps.
          const endT = d.start0 + len0 - ts
          const snapped = snap(endT, d.id)
          if (snapped !== endT) {
            ts = d.start0 + len0 - snapped
            line = snapped
          }
        } else {
          const edge = d.start0 + ts
          const snapped = snap(edge, d.id)
          if (snapped !== edge) {
            ts = snapped - d.start0
            line = snapped
          }
        }
        // Never before the start of the source, nor before 0 on the timeline for a layer.
        ts = Math.max(-d.in0 / sp, Math.min(len0 - MIN_CLIP, ts))
        if (!d.main) ts = Math.max(ts, -d.start0)
        p.onTrimLive(d.id, d.main ? { in: d.in0 + ts * sp } : { in: d.in0 + ts * sp, start: d.start0 + ts })
      } else {
        const endT = d.start0 + len0 + ts
        const snapped = snap(endT, d.id)
        if (snapped !== endT) {
          ts = snapped - d.start0 - len0
          line = snapped
        }
        p.onTrimLive(d.id, { out: Math.min(d.max, Math.max(d.in0 + MIN_CLIP * sp, d.out0 + ts * sp)) })
      }
      setSnapLine(line)
    } else if (d.kind === 'vol') {
      const pts = d.points.map((q) => ({ ...q }))
      const q = pts[d.index]
      const first = d.index === 0
      const last = d.index === pts.length - 1
      // The two end points stay at the clip's ends; the ones between move freely between their neighbours.
      if (!first && !last) {
        const t = q.t + (e.clientX - d.x0) / p.pxPerSec
        q.t = Math.max(pts[d.index - 1].t + 0.02, Math.min(pts[d.index + 1].t - 0.02, t))
      }
      q.v = Math.round(Math.max(0, Math.min(2, q.v - ((e.clientY - d.y0) / d.h) * 2)) * 100) / 100
      p.onTrimLive(d.id, { volPoints: pts })
    } else if (d.kind === 'ripple') {
      const c = d.pl.clip
      const sp = c.speed ?? 1
      const len0 = d.pl.end - d.pl.start
      let ts = (e.clientX - d.x0) / p.pxPerSec
      if (d.side === 'out') {
        ts = Math.max(MIN_CLIP - len0, Math.min((d.max - c.out) / sp, ts))
        const moved = shiftAfter(d.base, d.pl.kind, d.pl.trackIndex, d.pl.end, ts, c.id)
        p.onLive(updateClip(moved, c.id, { out: c.out + ts * sp }))
      } else {
        // The start stays where it is on the timeline; the clip loses (or gains) from its front and the rest follows.
        ts = Math.max(-c.in / sp, Math.min(len0 - MIN_CLIP, ts))
        const moved = shiftAfter(d.base, d.pl.kind, d.pl.trackIndex, d.pl.end, -ts, c.id)
        p.onLive(updateClip(moved, c.id, { in: c.in + ts * sp }))
      }
    } else if (d.kind === 'roll') {
      // a is the clip before the cut, b the one after it. Pulling right lengthens a and shortens b.
      const spA = d.a.speed ?? 1
      const spB = d.b.speed ?? 1
      // A picture, block or text has no earlier footage: it grows or shrinks from its end instead.
      const bMedia = d.b.kind === 'media'
      let ts = (e.clientX - d.x0) / p.pxPerSec
      ts = Math.min(ts, (d.maxA - d.a.out) / spA, (d.b.out - d.b.in) / spB - MIN_CLIP)
      ts = Math.max(ts, -((d.a.out - d.a.in) / spA - MIN_CLIP), bMedia ? -d.b.in / spB : -Infinity)
      let next = updateClip(d.base, d.a.id, { out: d.a.out + ts * spA })
      next = updateClip(next, d.b.id, bMedia ? { in: d.b.in + ts * spB, start: d.b.start + ts } : { out: d.b.out - ts, start: d.b.start + ts })
      p.onLive(next)
    } else if (d.kind === 'slip') {
      const sp = d.c.speed ?? 1
      // Dragging right shows earlier footage, as if pulling the film along under a fixed window.
      let ds = -((e.clientX - d.x0) / p.pxPerSec) * sp
      ds = Math.max(-d.c.in, Math.min(d.max - d.c.out, ds))
      p.onLive(updateClip(d.base, d.c.id, { in: d.c.in + ds, out: d.c.out + ds }))
    } else if (d.kind === 'slide') {
      const spP = d.prev.speed ?? 1
      const spN = d.next.speed ?? 1
      let ts = (e.clientX - d.x0) / p.pxPerSec
      ts = Math.min(ts, (d.maxPrev - d.prev.out) / spP, (d.next.out - d.next.in) / spN - MIN_CLIP)
      ts = Math.max(ts, -((d.prev.out - d.prev.in) / spP - MIN_CLIP), -d.next.in / spN)
      let next = updateClip(d.base, d.prev.id, { out: d.prev.out + ts * spP })
      next = updateClip(next, d.next.id, { in: d.next.in + ts * spN })
      p.onLive(next)
    } else {
      const moved = d.moved || Math.abs(e.clientX - d.x0) > 5 || Math.abs(e.clientY - d.y0) > 5
      setDrag({ ...d, moved, x: e.clientX, y: e.clientY })
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'scrub') scrubTo(e.clientX)
    else if (d.kind === 'trim' || d.kind === 'fade' || d.kind === 'vol' || d.kind === 'ripple' || d.kind === 'roll' || d.kind === 'slip' || d.kind === 'slide') p.onCommit()
    else {
      const final = { ...d, x: e.clientX, y: e.clientY }
      if (d.moved || Math.abs(e.clientX - d.x0) > 5 || Math.abs(e.clientY - d.y0) > 5) {
        const t = dropTarget(final)
        p.onMove(d.id, t.row.kind, t.row.index, t.start, t.mainIndex)
      } else {
        p.onSeek(Math.min(p.duration, timeAtClientX(e.clientX)))
      }
    }
    setDrag(null)
    setSnapLine(null)
  }

  const ticks: number[] = []
  for (let t = 0; t <= p.duration + 20; t += step) ticks.push(t)

  const ghost = drag?.kind === 'move' && drag.moved ? dropTarget(drag) : null
  const ghostLeft = ghost
    ? ghost.row.kind === 'video' && ghost.row.index === 0
      ? placed
          .filter((m) => m.kind === 'video' && m.trackIndex === 0 && m.clip.id !== ghost.pl.clip.id)
          .slice(0, ghost.mainIndex)
          .reduce((s, m) => s + (m.end - m.start), 0)
      : ghost.start
    : 0

  // How far into its source a clip can reach: the length of its video, or as long as wanted for a block, text or picture.
  function maxOut(c: Clip): number {
    if (c.kind !== 'media') return COLOR_MAX
    return p.sources.find((s) => s.id === c.sourceId)?.media.info.duration ?? c.out
  }

  function clipBox(pl: Placed, row: Row, index: number) {
    const c = pl.clip
    const src = c.sourceId ? p.sources.find((s) => s.id === c.sourceId) : undefined
    const color = c.kind === 'color' ? c.color ?? '#000000' : c.kind === 'text' ? '#d97706' : c.kind === 'image' ? '#0d9488' : c.kind === 'adjust' ? '#6d28d9' : c.kind === 'shape' ? '#0e7490' : COLORS[(sourceIndex.get(c.sourceId!) ?? 0) % COLORS.length]
    const dragging = drag?.kind === 'move' && drag.moved && drag.id === c.id
    const w = Math.max(4, (pl.end - pl.start) * p.pxPerSec - 2)
    const main = row.kind === 'video' && row.index === 0
    const max = maxOut(c)
    const locked = !!track(row)?.locked
    const startTrim = (side: 'in' | 'out') => (e: React.PointerEvent) => {
      e.stopPropagation()
      if (e.button !== 0) return
      p.onSelect(c.id)
      if (locked) return
      capture(e)
      if (e.altKey && !IS_WEB) {
        // Roll: the clip on the other side of this edge, if it touches.
        const same = placed.filter((x) => x.kind === pl.kind && x.trackIndex === pl.trackIndex && x.clip.id !== c.id)
        const other = side === 'out' ? same.find((x) => Math.abs(x.start - pl.end) < 1e-3) : same.find((x) => Math.abs(x.end - pl.start) < 1e-3)
        if (other) {
          const a = side === 'out' ? pl : other
          const b = side === 'out' ? other : pl
          setDrag({ kind: 'roll', id: c.id, x0: e.clientX, base: p.project, a: a.clip, b: { ...b.clip, start: b.start }, maxA: maxOut(a.clip) })
          return
        }
      }
      if (e.shiftKey && !main && !IS_WEB) {
        setDrag({ kind: 'ripple', id: c.id, side, x0: e.clientX, base: p.project, pl, max })
        return
      }
      setDrag({ kind: 'trim', id: c.id, side, x0: e.clientX, in0: c.in, out0: c.out, start0: pl.start, max, main, speed: c.speed ?? 1 })
    }
    // Sound fades: a dot on the top edge at each end, pulled inwards; the faded part is shaded.
    const hasSound = c.kind === 'media' && !!src?.media.audioTrack
    const fi = (c.fadeIn ?? 0) * p.pxPerSec
    const fo = (c.fadeOut ?? 0) * p.pxPerSec
    const h = row.height - 8
    const startFade = (side: 'in' | 'out') => (e: React.PointerEvent) => {
      e.stopPropagation()
      if (locked || e.button !== 0) return
      capture(e)
      p.onSelect(c.id)
      setDrag({ kind: 'fade', id: c.id, side, x0: e.clientX, v0: (side === 'in' ? c.fadeIn : c.fadeOut) ?? 0, max: (pl.end - pl.start) / 2 })
    }
    return (
      <div
        key={c.id}
        className={`clip${p.selectedId === c.id ? ' selected' : ''}${p.extraIds.includes(c.id) ? ' also-selected' : ''}${dragging ? ' dragging' : ''}${c.kind === 'color' ? ' color-clip' : ''}${locked ? ' locked' : ''}${c.group ? ' grouped' : ''}`}
        style={{ left: pl.start * p.pxPerSec + 1, width: w, height: row.height - 4, background: color, filter: index % 2 && c.kind !== 'color' ? 'brightness(0.85)' : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (e.ctrlKey || e.metaKey) {
            p.onToggleSelect(c.id)
            return
          }
          p.onSelect(c.id)
          if (locked) return
          capture(e)
          if (e.altKey && e.shiftKey && main && !IS_WEB) {
            const mainClips = placed.filter((x) => x.kind === 'video' && x.trackIndex === 0)
            const i = mainClips.findIndex((x) => x.clip.id === c.id)
            const prev = mainClips[i - 1]
            const next = mainClips[i + 1]
            if (prev && next) {
              setDrag({ kind: 'slide', id: c.id, x0: e.clientX, base: p.project, prev: prev.clip, next: next.clip, maxPrev: maxOut(prev.clip) })
              return
            }
          }
          if (e.altKey && c.kind === 'media' && !IS_WEB) {
            setDrag({ kind: 'slip', id: c.id, x0: e.clientX, base: p.project, c, max })
            return
          }
          setDrag({ kind: 'move', id: c.id, x0: e.clientX, y0: e.clientY, start0: pl.start, moved: false, x: e.clientX, y: e.clientY })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (p.selectedId !== c.id && !p.extraIds.includes(c.id)) p.onSelect(c.id)
          p.onClipMenu(c.id, e.clientX, e.clientY)
        }}
      >
        {!locked && <span className="handle left" title="Drag to trim the start. Shift: the rest follows. Alt: roll the cut" onPointerDown={startTrim('in')} />}
        {c.kind === 'image' && c.imageId && imageStore.get(c.imageId) && (
          <ClipStrip overview={{ peaksPerSecond: 1, peaks: null, thumbs: [{ t: 0, img: imageStore.get(c.imageId)! }], thumbAspect: (c.imageSize?.[0] ?? 16) / (c.imageSize?.[1] ?? 9) }} inPoint={0} outPoint={1} width={w} height={row.height - 6} soundOnly={false} />
        )}
        {c.kind === 'media' && <ClipStrip overview={p.overviews.get(c.sourceId!)} inPoint={c.in} outPoint={c.out} width={w} height={row.height - 6} soundOnly={row.kind === 'audio'} />}
        <span className="clip-label">{c.kind === 'color' ? 'Colour block' : c.kind === 'adjust' ? '◐ Adjustment layer' : c.kind === 'shape' ? `◆ ${SHAPES.find((x) => x.id === c.shape?.kind)?.label ?? 'Shape'}` : c.kind === 'image' ? `▣ ${imageName(c)}` : c.kind === 'text' ? `T  ${c.text?.text.split(/\n/)[0] ?? ''}` : src?.name}</span>
        <span className="clip-length">{(c.speed ?? 1) !== 1 ? `${Math.round((c.speed ?? 1) * 100)}% · ` : ''}{label(pl.end - pl.start)}</span>
        {hasSound && (fi > 0 || fo > 0) && (
          <svg className="fade-shade" width={w} height={h}>
            {fi > 0 && <polygon points={`0,0 ${fi},0 0,${h}`} />}
            {fo > 0 && <polygon points={`${w},0 ${w - fo},0 ${w},${h}`} />}
          </svg>
        )}
        {c.tIn && (
          <span className="trans-mark" title={`Transition in: ${c.tIn.type}, ${c.tIn.d.toFixed(1)} s`} style={{ width: Math.max(10, Math.min(w / 2, (c.tIn.d / 2) * p.pxPerSec)) }} />
        )}
        {c.keys && c.keys.length > 0 && (
          <div className="key-dots">
            {c.keys.map((k, i) => (
              <span key={i} className="key-dot" style={{ left: Math.min(w - 4, (k.t / Math.max(0.01, pl.end - pl.start)) * w) - 4 }}
                title={`Keyframe at ${k.t.toFixed(2)} s: click to go there`}
                onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) { p.onSelect(c.id); p.onSeek(pl.start + k.t) } }} />
            ))}
          </div>
        )}
        {hasSound && c.volPoints && c.volPoints.length > 0 && (() => {
          // The volume line: loudness from silent (bottom) to twice as loud (top), 1 in the middle.
          const len = pl.end - pl.start
          const pts = c.volPoints.slice().sort((a, b) => a.t - b.t)
          const xy = (q: VolPoint) => [Math.min(w, (q.t / len) * w), h * (1 - q.v / 2)]
          const line = pts.map((q) => xy(q).join(',')).join(' ')
          return (
            <svg className="vol-line" width={w} height={h}>
              <polyline className="vol-show" points={line} />
              {/* A wide, unseen strip along the line takes the press, so it is easy to hit. */}
              <polyline className="vol-hit" points={line}
                onPointerDown={(e) => {
                  // A press on the line adds a point there.
                  e.stopPropagation()
                  if (e.button !== 0 || locked) return
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  const t = Math.max(0.01, Math.min(len - 0.01, ((e.clientX - r.left) / w) * len))
                  const v = Math.round(Math.max(0, Math.min(2, (1 - (e.clientY - r.top) / h) * 2)) * 100) / 100
                  p.onSetClip(c.id, { volPoints: [...pts, { t, v }].sort((a, b) => a.t - b.t) })
                }} />
              {pts.map((q, i) => {
                const [x, y] = xy(q)
                return (
                  <circle key={i} cx={x} cy={y} r={4.5}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (e.button !== 0 || locked) return
                      capture(e)
                      p.onSelect(c.id)
                      setDrag({ kind: 'vol', id: c.id, index: i, x0: e.clientX, y0: e.clientY, points: pts, len, h })
                    }}
                    onContextMenu={(e) => {
                      // Right-click a point between the ends to take it away.
                      e.preventDefault()
                      e.stopPropagation()
                      if (locked || i === 0 || i === pts.length - 1) return
                      p.onSetClip(c.id, { volPoints: pts.filter((_, k) => k !== i) })
                    }}>
                    <title>{`${Math.round(q.v * 100)}%. Drag to change${i > 0 && i < pts.length - 1 ? ', right-click to remove' : ''}`}</title>
                  </circle>
                )
              })}
            </svg>
          )
        })()}
        {hasSound && w > 40 && (
          <>
            <span className="fade-dot" style={{ left: Math.max(10, fi) - 5 }} title={`Fade in${c.fadeIn ? `: ${c.fadeIn.toFixed(1)} s` : ''} (drag right)`} onPointerDown={startFade('in')} />
            <span className="fade-dot" style={{ left: Math.min(w - 10, w - fo) - 5 }} title={`Fade out${c.fadeOut ? `: ${c.fadeOut.toFixed(1)} s` : ''} (drag left)`} onPointerDown={startFade('out')} />
          </>
        )}
        {!locked && <span className="handle right" title="Drag to trim the end. Shift: the rest follows. Alt: roll the cut" onPointerDown={startTrim('out')} />}
      </div>
    )
  }

  return (
    <div className="timeline-wrap">
      {/* Names of the layers, each with a − to remove it (not the main track). */}
      <div className="tl-heads">
        <div className="head-ruler" />
        {rows.map((row) => {
          const main = row.kind === 'video' && row.index === 0
          return (
            <div key={`h${row.kind}${row.index}`} className={`head ${row.kind}${track(row)?.hidden ? ' dim' : ''}`} style={{ height: row.height }}>
              <span className="head-name">
                {row.label}
                <span className="head-state">
                  {track(row)?.locked && <Lock size={11} aria-label="Locked" />}
                  {track(row)?.muted && <VolumeX size={11} aria-label="Muted" />}
                  {track(row)?.solo && <b title="Solo">S</b>}
                  {track(row)?.hidden && <EyeOff size={11} aria-label="Hidden" />}
                </span>
              </span>
              <span className="head-buttons">
                <button className="add-track track-more" title="Lock, mute, solo or hide this track" onClick={(e) => { e.currentTarget.blur(); const b = e.currentTarget.getBoundingClientRect(); p.onTrackMenu(row.kind, row.index, b.left, b.bottom + 2) }}><MoreHorizontal size={13} /></button>
                <button className="add-track" title={row.kind === 'video' ? `Add a layer above ${row.label}` : `Add a sound track below ${row.label}`} onClick={(e) => { e.currentTarget.blur(); p.onAddTrack(row.kind, row.index) }}>＋</button>
                {!main && (
                  <button className="remove-track" title={`Remove ${row.label}`} onClick={(e) => { e.currentTarget.blur(); p.onRemoveTrack(row.kind, row.index) }}>−</button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    <div className="timeline" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="tl-inner" ref={innerRef} style={{ width }}>
        <div className="ruler" onPointerDown={startScrub} title="Click or drag to move the playhead">
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: t * p.pxPerSec }}>{label(t)}</span>
          ))}
          {p.cached && <span className="cache-bar" style={{ left: p.cached[0] * p.pxPerSec, width: (p.cached[1] - p.cached[0]) * p.pxPerSec }} title="Rendered: plays smoothly until you change anything" />}
          {(p.project.markers ?? []).map((m) => (
            <span
              key={m.id}
              className="marker"
              style={{ left: m.t * p.pxPerSec }}
              title={m.note ? `${m.note} (right-click to change)` : 'Marker (right-click to add a note)'}
              onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) p.onSeek(m.t) }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMarkerMenu(m.id, e.clientX, e.clientY) }}
            >
              {m.note && <span className="marker-note">{m.note}</span>}
            </span>
          ))}
        </div>
        <div className="rows" ref={rowsRef}>
          {rows.map((row) => {
            const inRow = placed.filter((pl) => pl.kind === row.kind && pl.trackIndex === row.index)
            const empty = inRow.length === 0 && !(row.kind === 'video' && row.index === 0)
            return (
              <div
                key={`${row.kind}${row.index}`}
                className={`row ${row.kind}${row.kind === 'video' && row.index === 0 ? ' main' : ''}${track(row)?.hidden ? ' dim' : ''}`}
                style={{ height: row.height }}
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget) return
                  e.preventDefault()
                  p.onRowMenu(row.kind, row.index, timeAtClientX(e.clientX), e.clientX, e.clientY)
                }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget && e.button === 0) {
                    p.onSelect(null)
                    startScrub(e)
                  }
                }}
              >
                {empty && <span className="row-label">{row.kind === 'video' ? 'Empty layer: drag a clip here' : 'Empty: drag sound here'}</span>}
                {inRow.map((pl, i) => clipBox(pl, row, i))}
              </div>
            )
          })}
          {ghost && (
            <div className="ghost" style={{ top: rowTop(ghost.row) + 2, height: ghost.row.height - 4, left: ghostLeft * p.pxPerSec, width: ghost.len * p.pxPerSec }} />
          )}
        </div>
        {(snapLine !== null || ghost?.snapAt != null) && (
          <div className="snap-line" style={{ left: (snapLine ?? ghost!.snapAt!) * p.pxPerSec }} />
        )}
        <div className="playhead" style={{ left: p.time * p.pxPerSec }}>
          <div className="playhead-grip" onPointerDown={startScrub} title="Drag to move through the video" />
        </div>
      </div>
    </div>
    </div>
  )
}

function ClipStrip({ overview, inPoint, outPoint, width, height, soundOnly }: { overview?: Overview; inPoint: number; outPoint: number; width: number; height: number; soundOnly: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawStrip(ref.current, soundOnly && overview ? { ...overview, thumbs: [] } : overview, inPoint, outPoint, width, height)
  }, [overview, inPoint, outPoint, width, height, soundOnly])
  return <canvas ref={ref} className="strip" style={{ width, height }} />
}

// A picture clip shows its file name.
function imageName(c: Clip): string {
  return c.label ?? 'Picture'
}
