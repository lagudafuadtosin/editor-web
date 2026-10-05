import { useState } from 'react'
import { IS_WEB } from './edition'
import { AppMore } from './AppMore'
import { HSL_BANDS, LOOK_CONTROLS, MORE_CONTROLS, NEUTRAL, curvesOn, isNeutral, type Look } from './look'
import { ColourWheels, CurvesEditor } from './ColourPanels'

type Props = {
  look: Look
  busy: boolean
  // Live change while a slider moves (not saved to undo). onCommit saves it once the slider is let go.
  onLive: (look: Look) => void
  onCommit: () => void
  onSet: (look: Look) => void // a one-shot change, saved to undo straight away
  onAuto?: () => void // absent on an adjustment layer, which has no picture of its own to read
  onApplyAll: () => void
  scopes?: boolean
  onScopes?: (on: boolean) => void
}

const LIGHT = LOOK_CONTROLS.filter(({ key }) => ['exposure', 'brightness', 'contrast', 'shadows', 'highlights'].includes(key))
const COLOUR = LOOK_CONTROLS.filter(({ key }) => ['warmth', 'saturation'].includes(key))

type Num = (typeof LOOK_CONTROLS)[number]['key'] | (typeof MORE_CONTROLS)[number]['key']

export function LightPanel({ look, busy, onLive, onCommit, onSet, onAuto, onApplyAll, scopes, onScopes }: Props) {
  // "More" stays open once a More control is in use, so a changed setting is never hidden.
  const wheelUsed = [look.lift, look.gamma, look.gain].some((w) => w && (w.a || w.l))
  const used = MORE_CONTROLS.some(({ key }) => look[key]) || (look.hsl ?? []).some((v) => v) || wheelUsed || curvesOn(look.curves)
  const [more, setMore] = useState(used)
  const [band, setBand] = useState(0)

  const slider = (label: string, value: number, set: (v: number) => Look) => (
    <label key={label} className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onLive(set(Number(e.target.value)))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={() => onSet(set(0))}
        title="Double-click to reset"
      />
      <span className="value">{value > 0 ? `+${value}` : value}</span>
    </label>
  )
  const row = ({ key, label }: { key: Num; label: string }) => slider(label, look[key] ?? 0, (v) => ({ ...look, [key]: v }))
  const hsl = look.hsl ?? new Array(24).fill(0)
  const hslRow = (part: number, label: string) =>
    slider(label, hsl[band * 3 + part] ?? 0, (v) => {
      const next = hsl.slice()
      next[band * 3 + part] = v
      return { ...look, hsl: next }
    })

  return (
    <div className="light">
      {onAuto && (
        <button className="auto" onClick={onAuto} disabled={busy} title="Reads the clip and fixes its light and colour">
          {busy ? 'Reading the clip…' : 'Auto fix light and colour'}
        </button>
      )}
      <h3>Light</h3>
      {LIGHT.map(row)}
      <h3>Colour</h3>
      {COLOUR.map(row)}
      {IS_WEB ? (
        <AppMore what="whites, blacks, one colour at a time, colour wheels, curves, scopes" />
      ) : (
        <>
      <label className="check more-switch">
        <input type="checkbox" checked={more || used} onChange={(e) => setMore(e.target.checked)} disabled={used} />
        More: whites, blacks, tint, vibrance, one colour at a time, wheels, curves, scopes
      </label>
      {(more || used) && (
        <>
          {MORE_CONTROLS.map(row)}
          <h3>One colour at a time</h3>
          <div className="chips bands">
            {HSL_BANDS.map((name, i) => (
              <button key={name} className={band === i ? 'on' : ''} onClick={() => setBand(i)} title={name}>
                <span className={`band-dot band-${i}`} />{name}
              </button>
            ))}
          </div>
          {hslRow(0, 'Hue')}
          {hslRow(1, 'Saturation')}
          {hslRow(2, 'Lightness')}
          <h3>Colour wheels</h3>
          <ColourWheels look={look} onLive={onLive} onCommit={onCommit} onSet={onSet} />
          <h3>Curves</h3>
          <CurvesEditor look={look} onLive={onLive} onCommit={onCommit} onSet={onSet} />
          {onScopes && (
            <label className="check">
              <input type="checkbox" checked={!!scopes} onChange={(e) => onScopes(e.target.checked)} />
              Show scopes over the picture
            </label>
          )}
        </>
      )}
        </>
      )}
      <div className="light-buttons">
        <button onClick={() => onSet(NEUTRAL)} disabled={isNeutral(look)}>Reset</button>
        <button onClick={onApplyAll}>Use on every clip</button>
      </div>
    </div>
  )
}
