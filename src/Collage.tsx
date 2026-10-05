import { useRef, useState } from 'react'
import type { Frame, Transform } from './model'

// Collage: photos in a grid. Each cell is a fraction of the picture (x, y, w, h); each photo fills its cell,
// cut from the middle, as its own layer (so it can still be moved, recoloured or swapped).
export const COLLAGES: { id: string; label: string; cells: [number, number, number, number][] }[] = [
  { id: 'two-side', label: '2 side by side', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: 'two-stack', label: '2 top and bottom', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: 'three-row', label: '3 across', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: 'three-stack', label: '3 stacked', cells: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]] },
  { id: 'big-two', label: '1 big and 2', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  { id: 'grid4', label: '2 × 2 grid', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'grid6', label: '2 × 3 grid', cells: [0, 1, 2].flatMap((r) => [0, 1].map((c) => [c / 2, r / 3, 1 / 2, 1 / 3] as [number, number, number, number])) },
  { id: 'grid9', label: '3 × 3 grid', cells: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c / 3, r / 3, 1 / 3, 1 / 3] as [number, number, number, number])) },
]

// Where a photo of size (iw, ih) goes to fill one cell: its whole box, with the overflow cropped off evenly.
export function cellTransform(frame: Frame, cell: [number, number, number, number], gap: number, iw: number, ih: number): Transform {
  const inner = { x: gap / 2, y: gap / 2, w: frame.w - gap, h: frame.h - gap }
  const cx = inner.x + cell[0] * inner.w + gap / 2
  const cy = inner.y + cell[1] * inner.h + gap / 2
  const cw = Math.max(1, cell[2] * inner.w - gap)
  const ch = Math.max(1, cell[3] * inner.h - gap)
  const s = Math.max(cw / iw, ch / ih)
  const w = iw * s
  const h = ih * s
  const lr = ((w - cw) / 2 / w) * 100
  const tb = ((h - ch) / 2 / h) * 100
  return { x: cx + cw / 2, y: cy + ch / 2, w, h, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: tb, b: tb, l: lr, r: lr }, feather: 0 }
}

export function CollageDialog({ frame, onMake, onClose }: { frame: Frame; onMake: (files: File[], layout: string, gap: number, background: string) => void; onClose: () => void }) {
  const [layout, setLayout] = useState('grid4')
  const [gap, setGap] = useState(Math.round(frame.w / 60))
  const [bg, setBg] = useState('#ffffff')
  const pick = useRef<HTMLInputElement>(null)
  const chosen = COLLAGES.find((c) => c.id === layout)!
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Collage</h2>
        <div className="collage-grid">
          {COLLAGES.map((c) => (
            <button key={c.id} className={c.id === layout ? 'on' : ''} onClick={() => setLayout(c.id)} title={c.label}>
              <svg viewBox="0 0 90 160" className="collage-thumb">
                {c.cells.map(([x, y, w, h], i) => <rect key={i} x={x * 90 + 3} y={y * 160 + 3} width={w * 90 - 6} height={h * 160 - 6} rx={3} />)}
              </svg>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <label className="slider-row">
          <span>Gap</span>
          <input type="range" min={0} max={Math.round(frame.w / 15)} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          <span className="value">{gap}</span>
        </label>
        <div className="color-row">
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
          <span>Background (shows in the gaps)</span>
        </div>
        <p className="note">Choose {chosen.cells.length} photos. They fill the boxes in order, top left first, each cut from the middle. Every photo stays its own layer.</p>
        <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onMake(files.slice(0, chosen.cells.length), layout, gap, bg)
        }} />
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => pick.current?.click()}>Choose photos…</button>
        </div>
      </div>
    </div>
  )
}
