import { DEFAULT_DUCK_LEVEL, type Duck } from './model'

// Volume and fades for the selected clip, and, for its whole track, sitting under the voice.
export function SoundPanel({ volume, fadeIn, fadeOut, maxFade, duck, trackLabel, voiceTracks, onLive, onCommit, onSet, onDuck }: {
  volume: number
  fadeIn: number
  fadeOut: number
  maxFade: number // half the clip, so the two fades never cross
  duck: Duck | undefined
  trackLabel: string
  voiceTracks: { id: string; label: string }[] // the other tracks with sound, that the voice could be on
  onLive: (patch: { volume?: number; fadeIn?: number; fadeOut?: number }) => void
  onCommit: () => void
  onSet: (patch: { volume?: number; fadeIn?: number; fadeOut?: number }) => void
  onDuck: (duck: Duck | undefined, live?: boolean) => void // live: while a slider is dragged, saved for undo on release
}) {
  const fade = (key: 'fadeIn' | 'fadeOut', label: string, value: number) => (
    <label className="slider-row sound-row">
      <span>{label}</span>
      <input type="range" min={0} max={Math.max(0.1, Math.min(5, maxFade))} step={0.1} value={Math.min(value, maxFade)}
        onChange={(e) => onLive({ [key]: Number(e.target.value) })}
        onPointerUp={onCommit} onKeyUp={onCommit}
        onDoubleClick={() => onSet({ [key]: 0 })} title="Double-click for no fade" />
      <span className="value">{value ? `${value.toFixed(1)} s` : 'off'}</span>
    </label>
  )
  return (
    <div className="effects">
      <label className="slider-row sound-row">
        <span>Volume</span>
        <input type="range" min={0} max={200} step={1} value={Math.round(volume * 100)}
          onChange={(e) => onLive({ volume: Number(e.target.value) / 100 })}
          onPointerUp={onCommit} onKeyUp={onCommit}
          onDoubleClick={() => onSet({ volume: 1 })} title="Double-click to reset" />
        <span className="value">{Math.round(volume * 100)}%</span>
      </label>
      {fade('fadeIn', 'Fade in', fadeIn)}
      {fade('fadeOut', 'Fade out', fadeOut)}
      {voiceTracks.length > 0 && (
        <>
          <label className="check">
            <input type="checkbox" checked={!!duck}
              onChange={(e) => onDuck(e.target.checked ? { under: voiceTracks[0].id, level: DEFAULT_DUCK_LEVEL } : undefined)} />
            Go quieter while someone talks
          </label>
          {duck && (
            <>
              <label className="slider-row sound-row">
                <span>Voice on</span>
                <select value={duck.under} onChange={(e) => onDuck({ ...duck, under: e.target.value })}>
                  {voiceTracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label className="slider-row sound-row">
                <span>Drops to</span>
                <input type="range" min={0} max={80} step={5} value={Math.round(duck.level * 100)}
                  onChange={(e) => onDuck({ ...duck, level: Number(e.target.value) / 100 }, true)}
                  onPointerUp={onCommit} onKeyUp={onCommit} />
                <span className="value">{Math.round(duck.level * 100)}%</span>
              </label>
            </>
          )}
          <p className="note">Fades are for this clip. Going quieter is for everything on {trackLabel}.</p>
        </>
      )}
    </div>
  )
}
