import { defaultShape, SHAPES, type ShapeStyle } from './shape'

// The shape's own settings: which shape, its fill, its outline and its corners. Size, turn, fade and movement
// are in Position and size, Animation and Keyframes, the same as for text.
export function ShapePanel({ value, onLive, onSet, onCommit }: { value: ShapeStyle; onLive: (s: ShapeStyle) => void; onSet: (s: ShapeStyle) => void; onCommit: () => void }) {
  const s = value
  const line = s.kind === 'line' || s.kind === 'draw'
  return (
    <div className="effects">
      {s.kind !== 'draw' && <div className="chips">
        {SHAPES.map((k) => (
          <button key={k.id} className={s.kind === k.id ? 'on' : ''} onClick={() => onSet({
            ...s, kind: k.id,
            ...(k.id === 'line' && s.strokeWidth === 0 ? { strokeWidth: 14, stroke: s.fill } : {}),
            ...((k.id === 'rect' || k.id === 'bubble') && s.radius === 0 ? { radius: defaultShape(k.id).radius } : {}),
          })}>{k.label}</button>
        ))}
      </div>}
      {!line && (
        <>
          <label className="check">
            <input type="checkbox" checked={s.fillOn} onChange={(e) => onSet({ ...s, fillOn: e.target.checked })} />
            Fill
          </label>
          {s.fillOn && (
            <div className="color-row">
              <input type="color" value={s.fill} onChange={(e) => onLive({ ...s, fill: e.target.value })} onBlur={onCommit} />
              <span>{s.fill}</span>
            </div>
          )}
        </>
      )}
      <h3>{line ? 'Line' : 'Outline'}</h3>
      <div className="color-row">
        <input type="color" value={s.stroke} onChange={(e) => onLive({ ...s, stroke: e.target.value })} onBlur={onCommit} />
        <span>{s.stroke}</span>
      </div>
      <label className="slider-row">
        <span>Thickness</span>
        <input type="range" min={line ? 1 : 0} max={60} value={s.strokeWidth} onChange={(e) => onLive({ ...s, strokeWidth: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="value">{s.strokeWidth}</span>
      </label>
      {(s.kind === 'rect' || s.kind === 'bubble') && (
        <label className="slider-row">
          <span>Round corners</span>
          <input type="range" min={0} max={200} value={s.radius} onChange={(e) => onLive({ ...s, radius: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
          <span className="value">{s.radius}</span>
        </label>
      )}
      <p className="note">Size, turn and fade are in Position and size. To point an arrow, turn it there.</p>
    </div>
  )
}
