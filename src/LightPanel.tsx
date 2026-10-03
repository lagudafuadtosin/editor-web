import { LOOK_CONTROLS, NEUTRAL, isNeutral, type Look } from './look'

type Props = {
  look: Look
  busy: boolean
  // Live change while a slider moves (not saved to undo). onCommit saves it once the slider is let go.
  onLive: (look: Look) => void
  onCommit: () => void
  onSet: (look: Look) => void // a one-shot change, saved to undo straight away
  onAuto: () => void
  onApplyAll: () => void
}

const LIGHT = LOOK_CONTROLS.filter(({ key }) => ['exposure', 'brightness', 'contrast', 'shadows', 'highlights'].includes(key))
const COLOUR = LOOK_CONTROLS.filter(({ key }) => ['warmth', 'saturation'].includes(key))

export function LightPanel({ look, busy, onLive, onCommit, onSet, onAuto, onApplyAll }: Props) {
  const row = ({ key, label }: (typeof LOOK_CONTROLS)[number]) => (
    <label key={key} className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={look[key]}
        onChange={(e) => onLive({ ...look, [key]: Number(e.target.value) })}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={() => onSet({ ...look, [key]: 0 })}
        title="Double-click to reset"
      />
      <span className="value">{look[key] > 0 ? `+${look[key]}` : look[key]}</span>
    </label>
  )
  return (
    <div className="light">
      <button className="auto" onClick={onAuto} disabled={busy} title="Reads the clip and fixes its light and colour">
        {busy ? 'Reading the clip…' : 'Auto fix light and colour'}
      </button>
      <h3>Light</h3>
      {LIGHT.map(row)}
      <h3>Colour</h3>
      {COLOUR.map(row)}
      <div className="light-buttons">
        <button onClick={() => onSet(NEUTRAL)} disabled={isNeutral(look)}>Reset</button>
        <button onClick={onApplyAll}>Use on every clip</button>
      </div>
    </div>
  )
}
