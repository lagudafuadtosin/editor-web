import { useEffect, useRef, useState } from 'react'
import { COLOR_MAX, layout, MIN_CLIP, type Clip, type Placed, type Project, type Source } from './model'
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
}

type Row = { kind: 'video' | 'audio'; index: number; height: number; label: string }

type Drag =
  | { kind: 'trim'; id: string; side: 'in' | 'out'; x0: number; in0: number; out0: number; start0: number; max: number; main: boolean; speed: number }
  | { kind: 'move'; id: string; x0: number; y0: number; start0: number; moved: boolean; x: number; y: number }
  | { kind: 'fade'; id: string; side: 'in' | 'out'; x0: number; v0: number; max: number }
  | { kind: 'scrub' }

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
    const targets = [p.time, 0, ...placed.filter((pl) => pl.clip.id !== ignoreId).flatMap((pl) => [pl.start, pl.end])]
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
    } else {
      const moved = d.moved || Math.abs(e.clientX - d.x0) > 5 || Math.abs(e.clientY - d.y0) > 5
      setDrag({ ...d, moved, x: e.clientX, y: e.clientY })
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'scrub') scrubTo(e.clientX)
    else if (d.kind === 'trim' || d.kind === 'fade') p.onCommit()
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

  function clipBox(pl: Placed, row: Row, index: number) {
    const c = pl.clip
    const src = c.sourceId ? p.sources.find((s) => s.id === c.sourceId) : undefined
    const color = c.kind === 'color' ? c.color ?? '#000000' : c.kind === 'text' ? '#d97706' : c.kind === 'image' ? '#0d9488' : COLORS[(sourceIndex.get(c.sourceId!) ?? 0) % COLORS.length]
    const dragging = drag?.kind === 'move' && drag.moved && drag.id === c.id
    const w = Math.max(4, (pl.end - pl.start) * p.pxPerSec - 2)
    const main = row.kind === 'video' && row.index === 0
    const max = c.kind === 'color' || c.kind === 'text' || c.kind === 'image' ? COLOR_MAX : src?.media.info.duration ?? c.out
    const startTrim = (side: 'in' | 'out') => (e: React.PointerEvent) => {
      e.stopPropagation()
      capture(e)
      p.onSelect(c.id)
      setDrag({ kind: 'trim', id: c.id, side, x0: e.clientX, in0: c.in, out0: c.out, start0: pl.start, max, main, speed: c.speed ?? 1 })
    }
    // Sound fades: a dot on the top edge at each end, pulled inwards; the faded part is shaded.
    const hasSound = c.kind === 'media' && !!src?.media.audioTrack
    const fi = (c.fadeIn ?? 0) * p.pxPerSec
    const fo = (c.fadeOut ?? 0) * p.pxPerSec
    const h = row.height - 8
    const startFade = (side: 'in' | 'out') => (e: React.PointerEvent) => {
      e.stopPropagation()
      capture(e)
      p.onSelect(c.id)
      setDrag({ kind: 'fade', id: c.id, side, x0: e.clientX, v0: (side === 'in' ? c.fadeIn : c.fadeOut) ?? 0, max: (pl.end - pl.start) / 2 })
    }
    return (
      <div
        key={c.id}
        className={`clip${p.selectedId === c.id ? ' selected' : ''}${dragging ? ' dragging' : ''}${c.kind === 'color' ? ' color-clip' : ''}`}
        style={{ left: pl.start * p.pxPerSec + 1, width: w, height: row.height - 4, background: color, filter: index % 2 && c.kind !== 'color' ? 'brightness(0.85)' : undefined }}
        onPointerDown={(e) => {
          capture(e)
          p.onSelect(c.id)
          setDrag({ kind: 'move', id: c.id, x0: e.clientX, y0: e.clientY, start0: pl.start, moved: false, x: e.clientX, y: e.clientY })
        }}
      >
        <span className="handle left" title="Drag to trim the start" onPointerDown={startTrim('in')} />
        {c.kind === 'image' && c.imageId && imageStore.get(c.imageId) && (
          <ClipStrip overview={{ peaksPerSecond: 1, peaks: null, thumbs: [{ t: 0, img: imageStore.get(c.imageId)! }], thumbAspect: (c.imageSize?.[0] ?? 16) / (c.imageSize?.[1] ?? 9) }} inPoint={0} outPoint={1} width={w} height={row.height - 6} soundOnly={false} />
        )}
        {c.kind === 'media' && <ClipStrip overview={p.overviews.get(c.sourceId!)} inPoint={c.in} outPoint={c.out} width={w} height={row.height - 6} soundOnly={row.kind === 'audio'} />}
        <span className="clip-label">{c.kind === 'color' ? 'Colour block' : c.kind === 'image' ? `▣ ${imageName(c)}` : c.kind === 'text' ? `T  ${c.text?.text.split(/\n/)[0] ?? ''}` : src?.name}</span>
        <span className="clip-length">{(c.speed ?? 1) !== 1 ? `${Math.round((c.speed ?? 1) * 100)}% · ` : ''}{label(pl.end - pl.start)}</span>
        {hasSound && (fi > 0 || fo > 0) && (
          <svg className="fade-shade" width={w} height={h}>
            {fi > 0 && <polygon points={`0,0 ${fi},0 0,${h}`} />}
            {fo > 0 && <polygon points={`${w},0 ${w - fo},0 ${w},${h}`} />}
          </svg>
        )}
        {hasSound && w > 40 && (
          <>
            <span className="fade-dot" style={{ left: Math.max(10, fi) - 5 }} title={`Fade in${c.fadeIn ? `: ${c.fadeIn.toFixed(1)} s` : ''} (drag right)`} onPointerDown={startFade('in')} />
            <span className="fade-dot" style={{ left: Math.min(w - 10, w - fo) - 5 }} title={`Fade out${c.fadeOut ? `: ${c.fadeOut.toFixed(1)} s` : ''} (drag left)`} onPointerDown={startFade('out')} />
          </>
        )}
        <span className="handle right" title="Drag to trim the end" onPointerDown={startTrim('out')} />
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
            <div key={`h${row.kind}${row.index}`} className={`head ${row.kind}`} style={{ height: row.height }}>
              <span>{row.label}</span>
              <span className="head-buttons">
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
        </div>
        <div className="rows" ref={rowsRef}>
          {rows.map((row) => {
            const inRow = placed.filter((pl) => pl.kind === row.kind && pl.trackIndex === row.index)
            const empty = inRow.length === 0 && !(row.kind === 'video' && row.index === 0)
            return (
              <div
                key={`${row.kind}${row.index}`}
                className={`row ${row.kind}${row.kind === 'video' && row.index === 0 ? ' main' : ''}`}
                style={{ height: row.height }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
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
