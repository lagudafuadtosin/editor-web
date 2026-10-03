import { fitTransform, type Frame, type Transform } from './model'

type Props = {
  frame: Frame
  transform: Transform
  srcSize: [number, number] // the picture's own size (the frame's, for a colour block)
  onLive: (t: Transform) => void // while a slider moves
  onCommit: () => void
  onSet: (t: Transform) => void // a one-shot change, saved to undo straight away
}

function Slider({ label, value, min, max, step = 1, unit = '', onLive, onCommit, onReset }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string
  onLive: (v: number) => void; onCommit: () => void; onReset: () => void
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit} onDoubleClick={onReset} title="Double-click to reset" />
      <span className="value">{Math.round(value)}{unit}</span>
    </label>
  )
}

export function TransformPanel({ frame, transform: t, srcSize, onLive, onCommit, onSet }: Props) {
  const base = fitTransform(frame, srcSize[0], srcSize[1])
  const set = (patch: Partial<Transform>) => onLive({ ...t, ...patch })
  const setCrop = (patch: Partial<Transform['crop']>) => onLive({ ...t, crop: { ...t.crop, ...patch } })
  const placeAs = (mode: 'fit' | 'fill') => {
    const f = fitTransform(frame, srcSize[0], srcSize[1], mode)
    onSet({ ...t, x: f.x, y: f.y, w: f.w, h: f.h })
  }
  // Width and height as a percentage of the picture fitted to the frame (100 = fits exactly).
  const pctW = (t.w / base.w) * 100
  const pctH = (t.h / base.h) * 100
  const setSize = (which: 'w' | 'h', pct: number) => {
    const v = Math.max(1, pct)
    if (t.keepRatio) {
      const f = which === 'w' ? (base.w * v) / 100 / t.w : (base.h * v) / 100 / t.h
      set({ w: t.w * f, h: t.h * f })
    } else set(which === 'w' ? { w: (base.w * v) / 100 } : { h: (base.h * v) / 100 })
  }

  return (
    <div className="transform">
      <div className="fit-row">
        <button onClick={() => placeAs('fit')} title="Whole picture inside the frame">Fit</button>
        <button onClick={() => placeAs('fill')} title="Fill the frame, cropping the edges">Fill</button>
        <button onClick={() => onSet({ ...base, crop: { t: 0, b: 0, l: 0, r: 0 } })}>Reset</button>
      </div>
      <h3>Position</h3>
      <Slider label="Across" value={t.x} min={-frame.w / 2} max={frame.w * 1.5} onLive={(v) => set({ x: v })} onCommit={onCommit} onReset={() => onSet({ ...t, x: frame.w / 2 })} />
      <Slider label="Up / down" value={t.y} min={-frame.h / 2} max={frame.h * 1.5} onLive={(v) => set({ y: v })} onCommit={onCommit} onReset={() => onSet({ ...t, y: frame.h / 2 })} />
      <Slider label="Rotation" value={t.rotation} min={-180} max={180} unit="°" onLive={(v) => set({ rotation: v })} onCommit={onCommit} onReset={() => onSet({ ...t, rotation: 0 })} />
      <Slider label="Opacity" value={t.opacity * 100} min={0} max={100} unit="%" onLive={(v) => set({ opacity: v / 100 })} onCommit={onCommit} onReset={() => onSet({ ...t, opacity: 1 })} />
      <div className="flip-row">
        <button className={t.flipH ? 'on' : ''} onClick={() => onSet({ ...t, flipH: !t.flipH })}>⇋ Flip across</button>
        <button className={t.flipV ? 'on' : ''} onClick={() => onSet({ ...t, flipV: !t.flipV })}>⇵ Flip up / down</button>
      </div>
      <h3>Size</h3>
      <label className="check">
        <input type="checkbox" checked={t.keepRatio} onChange={(e) => onSet({ ...t, keepRatio: e.target.checked })} />
        Keep proportions
      </label>
      <Slider label="Width" value={pctW} min={5} max={400} unit="%" onLive={(v) => setSize('w', v)} onCommit={onCommit} onReset={() => onSet({ ...t, w: base.w, h: t.keepRatio ? base.h : t.h })} />
      <Slider label="Height" value={pctH} min={5} max={400} unit="%" onLive={(v) => setSize('h', v)} onCommit={onCommit} onReset={() => onSet({ ...t, h: base.h, w: t.keepRatio ? base.w : t.w })} />
      <h3>Crop</h3>
      <Slider label="Top" value={t.crop.t} min={0} max={90} unit="%" onLive={(v) => setCrop({ t: v })} onCommit={onCommit} onReset={() => onSet({ ...t, crop: { ...t.crop, t: 0 } })} />
      <Slider label="Bottom" value={t.crop.b} min={0} max={90} unit="%" onLive={(v) => setCrop({ b: v })} onCommit={onCommit} onReset={() => onSet({ ...t, crop: { ...t.crop, b: 0 } })} />
      <Slider label="Left" value={t.crop.l} min={0} max={90} unit="%" onLive={(v) => setCrop({ l: v })} onCommit={onCommit} onReset={() => onSet({ ...t, crop: { ...t.crop, l: 0 } })} />
      <Slider label="Right" value={t.crop.r} min={0} max={90} unit="%" onLive={(v) => setCrop({ r: v })} onCommit={onCommit} onReset={() => onSet({ ...t, crop: { ...t.crop, r: 0 } })} />
      <h3>Edges</h3>
      <Slider label="Soft edge" value={t.feather} min={0} max={200} onLive={(v) => set({ feather: v })} onCommit={onCommit} onReset={() => onSet({ ...t, feather: 0 })} />
    </div>
  )
}
