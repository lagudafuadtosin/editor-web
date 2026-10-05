import { useRef, useState } from 'react'
import type { Frame, Transform } from './model'

type Props = {
  frame: Frame
  transform: Transform | null // the selected clip's box, if it is showing at the playhead
  // scale is set when a text box is resized from a corner: the letters grow or shrink by that much.
  onLive: (t: Transform, scale?: number) => void
  onCommit: () => void
  onPick: (frameX: number, frameY: number) => void // a click where there is no box: select what is under it
  textMode?: boolean // the selected clip is text: corners scale the letters, sides change the wrap width
  onEditText?: () => void // double-click on text
  onActivate?: () => void // any press in the preview: the arrow keys now nudge the selected box
  // Drawing a pen mask: each click on the picture adds a point (in frame pixels); the shape so far is shown.
  pen?: { points: [number, number][]; onAdd: (x: number, y: number) => void }
  // Drawing a box round something to track: press, drag, let go (frame pixels).
  boxDraw?: (x0: number, y0: number, x1: number, y1: number) => void
  // Freehand drawing: each press-drag-let-go is one stroke (frame pixels).
  freehand?: (points: [number, number][]) => void
  // Cut-out: clicks on what to keep (left) or leave out (right-click or Alt+click), shown as dots (frame pixels).
  picks?: { dots: [number, number, 0 | 1][]; onPick: (x: number, y: number, keep: boolean) => void }
  // Erase: painting over what to take away. Strokes so far are shown at the brush width (frame pixels).
  brush?: { strokes: [number, number][][]; width: number; onStroke: (points: [number, number][]) => void }
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SNAP_PX = 12 // how close (in screen pixels) the centre must come to click into place
const MIN = 10

// The box drawn over the preview for the selected clip: drag inside to move it, drag a corner or a side to resize.
export function PreviewOverlay({ frame, transform, onLive, onCommit, onPick, textMode, onEditText, onActivate, pen, boxDraw, freehand, picks, brush }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Which centre lines the box is snapped to while it is being dragged (shown as guide lines).
  const [guides, setGuides] = useState({ x: false, y: false })
  const drag = useRef<{ handle: Handle; x0: number; y0: number; t0: Transform; k: number } | null>(null)

  const scale = () => ref.current!.getBoundingClientRect().width / frame.w

  function start(handle: Handle) {
    return (e: React.PointerEvent) => {
      if (!transform) return
      e.stopPropagation()
      e.preventDefault() // no text selection or page scroll while dragging
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer (a test): the drag still works */ }
      onActivate?.()
      drag.current = { handle, x0: e.clientX, y0: e.clientY, t0: transform, k: scale() }
    }
  }

  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const t0 = d.t0
    const dx = (e.clientX - d.x0) / d.k
    const dy = (e.clientY - d.y0) / d.k
    if (d.handle === 'move') {
      let x = t0.x + dx
      let y = t0.y + dy
      // Snap the centre to the middle of the frame, across and up/down separately, and show a guide line.
      const snapX = Math.abs(x - frame.w / 2) * d.k < SNAP_PX
      const snapY = Math.abs(y - frame.h / 2) * d.k < SNAP_PX
      if (snapX) x = frame.w / 2
      if (snapY) y = frame.h / 2
      if (snapX !== guides.x || snapY !== guides.y) setGuides({ x: snapX, y: snapY })
      onLive({ ...t0, x, y })
      return
    }
    // Work in the box's own (rotated) directions.
    const a = (t0.rotation * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const lx = dx * cos + dy * sin
    const ly = -dx * sin + dy * cos
    const sx = d.handle.includes('e') ? 1 : d.handle.includes('w') ? -1 : 0
    const sy = d.handle.includes('s') ? 1 : d.handle.includes('n') ? -1 : 0
    let w = t0.w + sx * lx
    let h = t0.h + sy * ly
    if (textMode) {
      if (sx && !sy) {
        // A side: a wider or narrower box, the words re-wrap, the letters stay the same size.
        w = Math.max(MIN * 4, w)
        const ox = (sx * (w - t0.w)) / 2
        onLive({ ...t0, w, x: t0.x + ox * cos, y: t0.y + ox * sin })
        return
      }
      // A corner (or top or bottom): everything scales together, letters included.
      const f = Math.max(0.05, sx && sy ? Math.max(w / t0.w, h / t0.h) : h / t0.h)
      const nw = t0.w * f
      const nh = t0.h * f
      const ox = (sx * (nw - t0.w)) / 2
      const oy = (sy * (nh - t0.h)) / 2
      onLive({ ...t0, w: nw, h: nh, x: t0.x + ox * cos - oy * sin, y: t0.y + ox * sin + oy * cos }, f)
      return
    }
    if (t0.keepRatio) {
      // Same shape: scale both sides by how far the dragged side or corner moved.
      const f = sx && sy ? Math.max(w / t0.w, h / t0.h) : sx ? w / t0.w : h / t0.h
      w = t0.w * f
      h = t0.h * f
    } else {
      if (!sx) w = t0.w
      if (!sy) h = t0.h
    }
    w = Math.max(MIN, w)
    h = Math.max(MIN, h)
    // Keep the opposite side or corner where it was.
    const ox = (sx * (w - t0.w)) / 2
    const oy = (sy * (h - t0.h)) / 2
    onLive({ ...t0, w, h, x: t0.x + ox * cos - oy * sin, y: t0.y + ox * sin + oy * cos })
  }

  function end(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    setGuides({ x: false, y: false })
    if (!d) return
    // A click on a box without dragging picks the top-most picture under the pointer (it may be a different clip).
    if (d.handle === 'move' && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) {
      const r = ref.current!.getBoundingClientRect()
      onPick(((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h)
      return
    }
    onCommit()
  }

  const [band, setBand] = useState<[number, number, number, number] | null>(null)
  const bandStart = useRef<[number, number] | null>(null)
  const stroke = useRef<[number, number][] | null>(null)
  const [strokeShown, setStrokeShown] = useState<[number, number][] | null>(null)
  if (picks) {
    return (
      <div className="overlay pen-mode" ref={ref}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return
          const r = ref.current!.getBoundingClientRect()
          picks.onPick(((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h, e.button === 0 && !e.altKey)
        }}>
        <svg viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none" className="pen-svg picks">
          {picks.dots.map(([x, y, keep], i) => <circle key={i} cx={x} cy={y} r={frame.w / 90} className={keep ? 'keep' : 'drop'} />)}
        </svg>
      </div>
    )
  }
  if (freehand || brush) {
    const done = freehand ?? brush!.onStroke
    const line = (pts: [number, number][], key: number | string) => (
      <polyline key={key} points={pts.map((q) => q.join(',')).join(' ')} className={brush ? 'brush' : undefined}
        style={brush ? { strokeWidth: brush.width } : { fill: 'none', stroke: '#facc15', strokeWidth: frame.w / 80, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
    )
    const at = (e: React.PointerEvent): [number, number] => {
      const r = ref.current!.getBoundingClientRect()
      return [((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h]
    }
    return (
      <div className="overlay pen-mode" ref={ref}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stroke.current = [at(e)]; setStrokeShown(stroke.current.slice()) }}
        onPointerMove={(e) => {
          const s = stroke.current
          if (!s || !e.buttons) return
          const p = at(e)
          const last = s[s.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return
          s.push(p)
          setStrokeShown(s.slice())
        }}
        onPointerUp={(e) => {
          const s = stroke.current
          stroke.current = null
          setStrokeShown(null)
          if (!s) return
          s.push(at(e))
          if (s.length >= 2 || brush) done(s)
        }}>
        {(strokeShown || brush) && (
          <svg viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none" className="pen-svg">
            {brush?.strokes.map((pts, i) => line(pts, i))}
            {strokeShown && line(strokeShown, 'now')}
          </svg>
        )}
      </div>
    )
  }
  if (boxDraw) {
    const at = (e: React.PointerEvent): [number, number] => {
      const r = ref.current!.getBoundingClientRect()
      return [((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h]
    }
    return (
      <div className="overlay pen-mode" ref={ref}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const [x, y] = at(e); bandStart.current = [x, y]; setBand([x, y, x, y]) }}
        onPointerMove={(e) => { const s = bandStart.current; if (s && e.buttons) { const [x, y] = at(e); setBand([s[0], s[1], x, y]) } }}
        onPointerUp={(e) => {
          // The start is kept in a ref and the end read from this event, so even a quick flick of a drag counts.
          const s = bandStart.current
          bandStart.current = null
          setBand(null)
          if (!s) return
          const [x, y] = at(e)
          if (Math.abs(x - s[0]) > 8 && Math.abs(y - s[1]) > 8) boxDraw(s[0], s[1], x, y)
        }}>
        {band && (
          <div className="track-band" style={{
            left: `${(Math.min(band[0], band[2]) / frame.w) * 100}%`, top: `${(Math.min(band[1], band[3]) / frame.h) * 100}%`,
            width: `${(Math.abs(band[2] - band[0]) / frame.w) * 100}%`, height: `${(Math.abs(band[3] - band[1]) / frame.h) * 100}%`,
          }} />
        )}
      </div>
    )
  }

  if (pen) {
    return (
      <div className="overlay pen-mode" ref={ref}
        onPointerDown={(e) => {
          const r = ref.current!.getBoundingClientRect()
          pen.onAdd(((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h)
        }}>
        <svg viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none" className="pen-svg">
          {pen.points.length > 1 && <polygon points={pen.points.map((q) => q.join(',')).join(' ')} />}
          {pen.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={frame.w / 120} />)}
        </svg>
      </div>
    )
  }

  const box = transform
    ? {
        left: `${((transform.x - transform.w / 2) / frame.w) * 100}%`,
        top: `${((transform.y - transform.h / 2) / frame.h) * 100}%`,
        width: `${(transform.w / frame.w) * 100}%`,
        height: `${(transform.h / frame.h) * 100}%`,
        transform: `rotate(${transform.rotation}deg)`,
      }
    : null

  return (
    <div
      className="overlay"
      ref={ref}
      onPointerMove={move}
      onPointerUp={end}
      onPointerDown={(e) => {
        onActivate?.()
        if (e.target !== e.currentTarget) return
        const r = ref.current!.getBoundingClientRect()
        onPick(((e.clientX - r.left) / r.width) * frame.w, ((e.clientY - r.top) / r.height) * frame.h)
      }}
    >
      {guides.x && <div className="guide vertical" />}
      {guides.y && <div className="guide horizontal" />}
      {box && (
        <div className="sel-box" style={box} onPointerDown={start('move')} onDoubleClick={() => textMode && onEditText?.()}>
          {HANDLES.map((h) => <span key={h} className={`grip ${h}`} onPointerDown={start(h)} />)}
        </div>
      )}
    </div>
  )
}

// Is a point (in frame pixels) inside a clip's rotated box?
export function hitBox(t: Transform, x: number, y: number): boolean {
  const a = (-t.rotation * Math.PI) / 180
  const dx = x - t.x
  const dy = y - t.y
  const lx = dx * Math.cos(a) - dy * Math.sin(a)
  const ly = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(lx) <= t.w / 2 && Math.abs(ly) <= t.h / 2
}
