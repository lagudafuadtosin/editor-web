import { useRef, useState } from 'react'
import { FLAT, curveTable, type Curves, type Look, type Wheel } from './look'

// Colour wheels and curves, in the "More" part of Light and colour. Changes show live while dragging and are
// saved to undo when the pointer is let go.
type Edit = { look: Look; onLive: (l: Look) => void; onCommit: () => void; onSet: (l: Look) => void }

const NONE: Wheel = { h: 0, a: 0, l: 0 }

function WheelPad({ label, wheel, onLive, onCommit, onReset }: { label: string; wheel: Wheel; onLive: (w: Wheel) => void; onCommit: () => void; onReset: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const R = 38
  const setFrom = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const dist = Math.min(R, Math.hypot(dx, dy))
    // Hue as on a colour wheel: red to the right, going round anticlockwise on screen.
    const h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360
    onLive({ ...wheel, h: Math.round(h), a: Math.round((dist / R) * 100) })
  }
  const rad = (wheel.h * Math.PI) / 180
  const px = Math.cos(rad) * (wheel.a / 100) * R
  const py = -Math.sin(rad) * (wheel.a / 100) * R
  return (
    <div className="wheel">
      <div className="wheel-pad" ref={ref} title="Drag towards a colour. Double-click to reset"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(e) }}
        onPointerMove={(e) => { if (e.buttons) setFrom(e) }}
        onPointerUp={onCommit}
        onDoubleClick={onReset}>
        <span className="wheel-puck" style={{ left: `calc(50% + ${px}px)`, top: `calc(50% + ${py}px)` }} />
      </div>
      <span className="wheel-label">{label}</span>
      <input type="range" min={-100} max={100} value={wheel.l} title="Darker or lighter"
        onChange={(e) => onLive({ ...wheel, l: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} onDoubleClick={() => onLive({ ...wheel, l: 0 })} />
    </div>
  )
}

export function ColourWheels({ look, onLive, onCommit, onSet }: Edit) {
  const pad = (key: 'lift' | 'gamma' | 'gain', label: string) => (
    <WheelPad label={label} wheel={look[key] ?? NONE} onLive={(w) => onLive({ ...look, [key]: w })} onCommit={onCommit} onReset={() => onSet({ ...look, [key]: NONE })} />
  )
  return (
    <div className="wheels">
      {pad('lift', 'Shadows')}
      {pad('gamma', 'Midtones')}
      {pad('gain', 'Highlights')}
    </div>
  )
}

type Channel = keyof Curves
const CH: { id: Channel; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: '#e5e5e5' },
  { id: 'r', label: 'Red', color: '#ef4444' },
  { id: 'g', label: 'Green', color: '#22c55e' },
  { id: 'b', label: 'Blue', color: '#3b82f6' },
]

export function CurvesEditor({ look, onLive, onCommit, onSet }: Edit) {
  const [ch, setCh] = useState<Channel>('all')
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const curves: Curves = look.curves ?? { all: FLAT, r: FLAT, g: FLAT, b: FLAT }
  const pts = curves[ch]
  const S = 180
  const toXY = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]
  }
  const setPts = (p: [number, number][], liveOnly = true) => {
    const next = { ...look, curves: { ...curves, [ch]: p } }
    if (liveOnly) onLive(next)
    else onSet(next)
  }
  const table = curveTable(pts)
  const path = Array.from(table).map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / 255) * S},${(1 - v) * S}`).join(' ')
  return (
    <div className="curves">
      <div className="chips">
        {CH.map((c) => <button key={c.id} className={ch === c.id ? 'on' : ''} onClick={() => setCh(c.id)} style={{ borderColor: ch === c.id ? c.color : undefined }}>{c.label}</button>)}
      </div>
      <svg ref={ref} className="curve-svg" viewBox={`0 0 ${S} ${S}`}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && (e.target as Element).tagName !== 'path') return
          // A press on the empty graph adds a point there and starts dragging it.
          const [x, y] = toXY(e)
          const p = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0])
          drag.current = p.findIndex((q) => q[0] === x && q[1] === y)
          e.currentTarget.setPointerCapture(e.pointerId)
          setPts(p)
        }}
        onPointerMove={(e) => {
          if (drag.current === null || !e.buttons) return
          const [x, y] = toXY(e)
          const i = drag.current
          const p = pts.map((q) => [...q] as [number, number])
          // End points slide up and down only; the others stay between their neighbours.
          const lo = i === 0 ? 0 : p[i - 1][0] + 0.01
          const hi = i === p.length - 1 ? 1 : p[i + 1][0] - 0.01
          p[i] = [i === 0 ? 0 : i === p.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y]
          setPts(p)
        }}
        onPointerUp={() => { if (drag.current !== null) onCommit(); drag.current = null }}>
        {[0.25, 0.5, 0.75].map((g) => <g key={g}><line x1={g * S} y1={0} x2={g * S} y2={S} /><line x1={0} y1={g * S} x2={S} y2={g * S} /></g>)}
        <path d={path} style={{ stroke: CH.find((c) => c.id === ch)!.color }} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={(1 - y) * S} r={5}
            onPointerDown={(e) => { e.stopPropagation(); drag.current = i; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId) }}
            onDoubleClick={(e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, k) => k !== i), false) }}>
            <title>Drag to change. Double-click to take it away</title>
          </circle>
        ))}
      </svg>
      <button className="link" onClick={() => setPts(FLAT, false)}>Straighten this curve</button>
    </div>
  )
}
