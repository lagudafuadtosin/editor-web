import { LOOKS } from './look'
import { IS_WEB } from './edition'
import { AppMore } from './AppMore'
import type { Blend, Fx, Key, LutFile, LutUse, Sfx, Shade } from './model'

// The panels behind "+ Add". Each one edits one part of a clip; a slider shows the change live and is saved
// to undo when it is let go, a button or chip is saved at once.
type Edit<T> = { value: T; onLive: (v: T) => void; onSet: (v: T) => void; onCommit: () => void }

function Slider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange, onCommit, onReset }: {
  label: string; value: number; min?: number; max?: number; step?: number; unit?: string
  onChange: (v: number) => void; onCommit: () => void; onReset?: () => void
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit}
        onDoubleClick={onReset} title={onReset ? 'Double-click to reset' : undefined} />
      <span className="value">{value > 0 && min < 0 ? '+' : ''}{value}{unit}</span>
    </label>
  )
}

const FX: { key: keyof Fx; label: string }[] = [
  { key: 'blur', label: 'Blur' },
  { key: 'sharpen', label: 'Sharpen' },
  { key: 'glow', label: 'Glow' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Film grain' },
  { key: 'vhs', label: 'VHS' },
  { key: 'shake', label: 'Shake' },
  { key: 'mosaic', label: 'Mosaic' },
  { key: 'beat', label: 'Move to the music' },
]

export function EffectsPanel({ value, onLive, onSet, onCommit }: Edit<Fx>) {
  return (
    <div className="effects">
      {FX.map(({ key, label }) => (
        <Slider key={key} label={label} value={value[key] ?? 0} onChange={(v) => onLive({ ...value, [key]: v })} onCommit={onCommit}
          onReset={() => onSet({ ...value, [key]: 0 })} />
      ))}
    </div>
  )
}

export function KeyPanel({ value, onLive, onSet, onCommit }: Edit<Key>) {
  return (
    <div className="effects">
      <div className="chips">
        <button className={value.mode === 'colour' && value.color.toLowerCase() === '#00ff00' ? 'on' : ''} onClick={() => onSet({ ...value, mode: 'colour', color: '#00ff00' })}>Green screen</button>
        <button className={value.mode === 'colour' && value.color.toLowerCase() === '#0000ff' ? 'on' : ''} onClick={() => onSet({ ...value, mode: 'colour', color: '#0000ff' })}>Blue screen</button>
        <button className={value.mode === 'luma' ? 'on' : ''} onClick={() => onSet({ ...value, mode: 'luma' })} title="Takes out the dark parts: for fire, smoke or light effects on black">Black background</button>
      </div>
      {value.mode === 'colour' && (
        <div className="colour-line">
          <span>Colour to take out</span>
          <input type="color" value={value.color} onChange={(e) => onLive({ ...value, color: e.target.value })} onBlur={onCommit} />
        </div>
      )}
      <Slider label="Strength" value={value.strength} onChange={(v) => onLive({ ...value, strength: v })} onCommit={onCommit} />
      <Slider label="Soft edge" value={value.softness} onChange={(v) => onLive({ ...value, softness: v })} onCommit={onCommit} />
      {value.mode === 'colour' && <Slider label="Remove colour spill" value={value.spill} onChange={(v) => onLive({ ...value, spill: v })} onCommit={onCommit} />}
      <p className="note">Put the background you want on the layer under this one.</p>
    </div>
  )
}

const BLENDS: { id: Blend; label: string }[] = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Colour dodge' },
  { id: 'color-burn', label: 'Colour burn' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Colour' },
  { id: 'luminosity', label: 'Luminosity' },
]

export function BlendPanel({ value, onSet }: Pick<Edit<Blend>, 'value' | 'onSet'>) {
  return (
    <div className="effects">
      <label className="select-row">
        <span>Mix with what is under it</span>
        <select value={value} onChange={(e) => onSet(e.target.value as Blend)}>
          {BLENDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <p className="note">Screen suits light leaks and fire on black. Multiply suits paper and texture overlays.</p>
    </div>
  )
}

export function ShadePanel({ value, onLive, onCommit }: Edit<Shade>) {
  return (
    <div className="effects">
      <h3>Shadow</h3>
      <div className="colour-line">
        <span>Colour</span>
        <input type="color" value={value.shadowColor} onChange={(e) => onLive({ ...value, shadowColor: e.target.value })} onBlur={onCommit} />
      </div>
      <Slider label="Strength" value={value.shadow} onChange={(v) => onLive({ ...value, shadow: v })} onCommit={onCommit} />
      <Slider label="Softness" value={value.shadowBlur} max={120} onChange={(v) => onLive({ ...value, shadowBlur: v })} onCommit={onCommit} />
      <Slider label="Distance" value={value.distance} max={120} onChange={(v) => onLive({ ...value, distance: v })} onCommit={onCommit} />
      <Slider label="Angle" value={value.angle} max={359} unit="°" onChange={(v) => onLive({ ...value, angle: v })} onCommit={onCommit} />
      <h3>Glow around it</h3>
      <div className="colour-line">
        <span>Colour</span>
        <input type="color" value={value.glowColor} onChange={(e) => onLive({ ...value, glowColor: e.target.value })} onBlur={onCommit} />
      </div>
      <Slider label="Strength" value={value.glow} onChange={(v) => onLive({ ...value, glow: v })} onCommit={onCommit} />
      <Slider label="Size" value={value.glowSize} max={120} onChange={(v) => onLive({ ...value, glowSize: v })} onCommit={onCommit} />
    </div>
  )
}

export function LookPanel({ value, luts, onLive, onSet, onCommit, onLoad }: Edit<LutUse> & { luts: Record<string, LutFile>; onLoad: () => void }) {
  const own = Object.entries(luts)
  return (
    <div className="effects">
      <div className="chips">
        {LOOKS.map((l) => (
          <button key={l.id} className={value.id === l.id ? 'on' : ''} onClick={() => onSet({ ...value, id: l.id })}>{l.name}</button>
        ))}
        {own.map(([id, f]) => (
          <button key={id} className={value.id === id ? 'on' : ''} onClick={() => onSet({ ...value, id })} title="Your .cube file">{f.name}</button>
        ))}
      </div>
      <Slider label="Strength" value={value.strength} onChange={(v) => onLive({ ...value, strength: v })} onCommit={onCommit} />
      {IS_WEB ? (
        <AppMore what="your own .cube colour look files" />
      ) : (
        <div className="light-buttons">
          <button onClick={onLoad} title="A colour look file (.cube) from a camera maker or a looks pack">Load a .cube file…</button>
        </div>
      )}
    </div>
  )
}


export function SfxPanel({ value, onLive, onSet, onCommit }: Edit<Sfx>) {
  const n = (key: keyof Sfx, label: string, min = 0, max = 100, unit = '') => (
    <Slider label={label} value={value[key] as number} min={min} max={max} unit={unit}
      onChange={(v) => onLive({ ...value, [key]: v })} onCommit={onCommit} onReset={() => onSet({ ...value, [key]: key === 'room' ? 40 : 0 })} />
  )
  return (
    <div className="effects">
      <h3>Tone</h3>
      {n('low', 'Bass', -12, 12, ' dB')}
      {n('mid', 'Middle', -12, 12, ' dB')}
      {n('high', 'Treble', -12, 12, ' dB')}
      <h3>Level</h3>
      {n('compress', 'Even out (compressor)')}
      {n('gate', 'Cut quiet noise (gate)')}
      <label className="check">
        <input type="checkbox" checked={value.limit} onChange={(e) => onSet({ ...value, limit: e.target.checked })} />
        Never too loud (limiter)
      </label>
      <h3>Space</h3>
      {n('reverb', 'Echo (reverb)')}
      {n('room', 'Room size')}
      <h3>Voice</h3>
      {n('pitch', 'Pitch', -12, 12, ' st')}
    </div>
  )
}
