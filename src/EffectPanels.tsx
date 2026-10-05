import { NO_ANIM, NO_BORDER, type Anim, type Border } from './model'
import { IS_WEB } from './edition'
import { AppMore } from './AppMore'

const IN: { id: Anim['in']; label: string; textOnly?: boolean }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide', label: 'Slide up' },
  { id: 'typewriter', label: 'Typewriter', textOnly: true },
  { id: 'zoom', label: 'Zoom' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'spin', label: 'Spin' },
]
const OUT: { id: Anim['out']; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'spin', label: 'Spin' },
]
const DURING: { id: NonNullable<Anim['during']>; label: string }[] = [
  { id: 'none', label: 'Still' },
  { id: 'zoomIn', label: 'Slow zoom in' },
  { id: 'zoomOut', label: 'Slow zoom out' },
  { id: 'panLeft', label: 'Pan left' },
  { id: 'panRight', label: 'Pan right' },
]

// How a clip comes in and goes out.
export function AnimationPanel({ anim = NO_ANIM, isText, onSet, onLive, onCommit }: {
  anim?: Anim; isText: boolean
  onSet: (a: Anim) => void; onLive: (a: Anim) => void; onCommit: () => void
}) {
  return (
    <div className="effects">
      <h3>Comes in</h3>
      <div className="chips">
        {IN.filter((o) => isText || !o.textOnly).map((o) => (
          <button key={o.id} className={anim.in === o.id ? 'on' : ''} onClick={() => onSet({ ...anim, in: o.id })}>{o.label}</button>
        ))}
      </div>
      <h3>While on screen</h3>
      {IS_WEB ? (
        <AppMore what="slow zoom and pan while on screen" />
      ) : (
        <div className="chips">
          {DURING.map((o) => (
            <button key={o.id} className={(anim.during ?? 'none') === o.id ? 'on' : ''} onClick={() => onSet({ ...anim, during: o.id })}>{o.label}</button>
          ))}
        </div>
      )}
      <h3>Goes out</h3>
      <div className="chips">
        {OUT.map((o) => (
          <button key={o.id} className={anim.out === o.id ? 'on' : ''} onClick={() => onSet({ ...anim, out: o.id })}>{o.label}</button>
        ))}
      </div>
      <label className="slider-row">
        <span>Speed</span>
        <input type="range" min={0.1} max={2} step={0.05} value={anim.duration}
          onChange={(e) => onLive({ ...anim, duration: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="value">{anim.duration.toFixed(1)}s</span>
      </label>
    </div>
  )
}

// A frame around a picture or video: line, rounded corners, drop shadow.
export function BorderPanel({ border = NO_BORDER, onSet, onLive, onCommit }: {
  border?: Border
  onSet: (b: Border) => void; onLive: (b: Border) => void; onCommit: () => void
}) {
  return (
    <div className="effects">
      <div className="colour-line">
        <span>Line</span>
        <input type="color" value={border.color} onChange={(e) => onLive({ ...border, color: e.target.value })} onBlur={onCommit} />
        <input type="range" min={0} max={60} value={border.width} onChange={(e) => onLive({ ...border, width: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} title="Thickness, 0 = no line" />
        <span className="value">{border.width}</span>
      </div>
      <label className="slider-row">
        <span>Round corners</span>
        <input type="range" min={0} max={300} value={border.radius} onChange={(e) => onLive({ ...border, radius: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="value">{border.radius}</span>
      </label>
      <label className="check"><input type="checkbox" checked={border.shadow} onChange={(e) => onSet({ ...border, shadow: e.target.checked })} /> Drop shadow</label>
      <div className="chips">
        <button onClick={() => onSet({ width: 10, color: '#ffffff', radius: 40, shadow: true })}>White card</button>
        <button onClick={() => onSet({ width: 0, color: '#ffffff', radius: 60, shadow: true })}>Rounded</button>
        <button onClick={() => onSet({ width: 16, color: '#facc15', radius: 0, shadow: false })}>Yellow frame</button>
        <button onClick={() => onSet(NO_BORDER)}>None</button>
      </div>
    </div>
  )
}
