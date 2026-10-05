import { useEffect, useState } from 'react'
import { IS_WEB } from './edition'
import { AppMore } from './AppMore'
import { RAMPS, type Ramp } from './model'

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

// Slow motion or fast forward for the selected clip only, shown in percent like Rush (100% = as recorded).
export function SpeedPanel({ speed, keepPitch, sourceLength, onSet, onLive, onCommit, onKeepPitch, ramp, onRamp, onRampLive, onReverse, reversing }: {
  speed: number
  keepPitch: boolean
  sourceLength: number // the clip's stretch of source, in seconds
  onSet: (s: number) => void
  onLive: (s: number) => void
  onCommit: () => void
  onKeepPitch: (on: boolean) => void
  ramp?: Ramp
  onRamp: (r: Ramp | undefined) => void
  onRampLive: (r: Ramp) => void
  onReverse: () => void
  reversing: number | null // progress 0 to 1 while the reversed copy is being made
}) {
  const pct = Math.round(speed * 100)
  // The typed number is kept as typed until Enter or leaving the box, so half-typed numbers are allowed.
  const [typed, setTyped] = useState(String(pct))
  useEffect(() => setTyped(String(pct)), [pct])
  const applyTyped = () => {
    const v = Number(typed)
    if (Number.isFinite(v) && v > 0) onSet(Math.max(25, Math.min(1000, v)) / 100)
    else setTyped(String(pct))
  }
  return (
    <div className="effects">
      <label className="slider-row speed-row">
        <span>Speed</span>
        <input type="range" min={25} max={1000} step={1} value={pct}
          onChange={(e) => onLive(Number(e.target.value) / 100)} onPointerUp={onCommit} onKeyUp={onCommit}
          onDoubleClick={() => onSet(1)} title="Double-click for 100%" />
        <span className="pct-box">
          <input type="number" min={25} max={1000} value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={applyTyped}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          %
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={keepPitch} onChange={(e) => onKeepPitch(e.target.checked)} />
        Keep voice pitch (no chipmunk or deep voice)
      </label>
      {speed > 4 && <p className="warn-note">Very fast: speech won't be understandable at this speed. You may want to turn this clip's volume down in Sound.</p>}
      <p className="note">
        This clip only. Length on the timeline: {fmt(sourceLength / speed)}{speed !== 1 ? ` (was ${fmt(sourceLength)})` : ''}
      </p>
      {IS_WEB ? (
        <AppMore what="speed ramps, playing a clip backwards" />
      ) : (
        <>
      <h3>Speed ramp</h3>
      <div className="chips">
        <button className={!ramp ? 'on' : ''} onClick={() => onRamp(undefined)}>None</button>
        {RAMPS.map((r) => (
          <button key={r.id} className={ramp?.kind === r.id ? 'on' : ''} onClick={() => onRamp({ kind: r.id, amount: ramp?.amount ?? 70 })} title={r.label}>{r.label.split(' (')[0]}</button>
        ))}
      </div>
      {ramp && (
        <>
          <label className="slider-row">
            <span>Strength</span>
            <input type="range" min={10} max={100} value={ramp.amount} onChange={(e) => onRampLive({ ...ramp, amount: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
            <span className="value">{ramp.amount}</span>
          </label>
          <p className="note">{RAMPS.find((r) => r.id === ramp.kind)?.label}. The clip keeps its length. Its own sound is off while a ramp is on: put music on a sound track.</p>
        </>
      )}
      <h3>Backwards</h3>
      <div className="light-buttons">
        <button onClick={onReverse} disabled={reversing !== null} title="Makes a reversed copy of this clip on this PC and puts it in its place">
          {reversing !== null ? `Reversing… ${Math.round(reversing * 100)}%` : 'Reverse this clip'}
        </button>
      </div>
        </>
      )}
    </div>
  )
}
