import { useEffect, useRef } from 'react'
import { drawText, FONTS, type TextStyle } from './text'
import { TEXT_PRESETS } from './textPresets'

// A small live picture of a look, drawn with the same code as the video, so what you see is what you get.
function Swatch({ style, sample }: { style: TextStyle; sample: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = 132 * dpr
    c.height = 60 * dpr
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, c.width, c.height)
    g.addColorStop(0, '#4b5563')
    g.addColorStop(1, '#1f2937')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c.width, c.height)
    const size = 26
    ctx.setTransform(dpr, 0, 0, dpr, 66 * dpr, 30 * dpr)
    drawText(ctx, { ...style, text: sample, size, outlineWidth: (style.outlineWidth * size) / 90, lineSpacing: 1 }, 124)
  }, [style, sample])
  return <canvas ref={ref} style={{ width: 132, height: 60 }} />
}

type Props = {
  style: TextStyle
  textRef: React.RefObject<HTMLTextAreaElement | null>
  onLive: (s: TextStyle) => void // while typing or a slider moves
  onCommit: () => void
  onSet: (s: TextStyle) => void // a one-shot change, saved to undo straight away
}

export function TextPanel({ style: s, textRef, onLive, onCommit, onSet }: Props) {
  const set = (patch: Partial<TextStyle>) => onSet({ ...s, ...patch })
  const toggle = (on: boolean) => (on ? 'on' : '')
  return (
    <div className="text-panel">
      <textarea
        ref={textRef}
        value={s.text}
        rows={3}
        placeholder="Type your text"
        onChange={(e) => onLive({ ...s, text: e.target.value })}
        onBlur={onCommit}
      />
      <div className="presets">
        {TEXT_PRESETS.map((pr) => {
          const look = { ...s, ...pr.style, text: s.text, size: s.size }
          return (
            <button key={pr.name} className="preset" title={pr.name} onClick={() => onSet(look)}>
              <Swatch style={look} sample={(s.text.split(/\s+/).slice(0, 2).join(' ') || 'Aa').slice(0, 14)} />
              <span>{pr.name}</span>
            </button>
          )
        })}
      </div>
      <div className="text-row">
        <select value={s.font} onChange={(e) => set({ font: e.target.value })} style={{ fontFamily: s.font }}>
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <button className={toggle(s.bold)} onClick={() => set({ bold: !s.bold })} title="Bold"><b>B</b></button>
        <button className={toggle(s.italic)} onClick={() => set({ italic: !s.italic })} title="Italic"><i>I</i></button>
        <button className={toggle(!!s.uppercase)} onClick={() => set({ uppercase: !s.uppercase })} title="All capitals">AA</button>
        <button className={toggle(!!s.glow)} onClick={() => set({ glow: !s.glow })} title="Glow in the text colour">✦</button>
      </div>
      <div className="text-row">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} className={toggle(s.align === a)} onClick={() => set({ align: a })} title={`Align ${a}`}>
            {a === 'left' ? '⯇ Left' : a === 'center' ? 'Centre' : 'Right ⯈'}
          </button>
        ))}
      </div>
      <label className="slider-row">
        <span>Size</span>
        <input type="range" min={12} max={400} value={s.size} onChange={(e) => onLive({ ...s, size: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="value">{Math.round(s.size)}</span>
      </label>
      <label className="slider-row">
        <span>Line spacing</span>
        <input type="range" min={0.8} max={2} step={0.05} value={s.lineSpacing} onChange={(e) => onLive({ ...s, lineSpacing: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="value">{s.lineSpacing.toFixed(2)}</span>
      </label>
      <div className="colour-line">
        <span>Text colour</span>
        <input type="color" value={s.color} onChange={(e) => onLive({ ...s, color: e.target.value })} onBlur={onCommit} />
      </div>
      <div className="colour-line">
        <span>Outline</span>
        <input type="color" value={s.outlineColor} onChange={(e) => onLive({ ...s, outlineColor: e.target.value })} onBlur={onCommit} />
        <input type="range" min={0} max={40} value={s.outlineWidth} onChange={(e) => onLive({ ...s, outlineWidth: Number(e.target.value) })} onPointerUp={onCommit} onKeyUp={onCommit} title="Outline thickness, 0 = none" />
        <span className="value">{Math.round(s.outlineWidth)}</span>
      </div>
      <div className="colour-line">
        <label className="check"><input type="checkbox" checked={s.background} onChange={(e) => set({ background: e.target.checked })} /> Background</label>
        <input type="color" value={s.backgroundColor} disabled={!s.background} onChange={(e) => onLive({ ...s, backgroundColor: e.target.value })} onBlur={onCommit} />
        <input type="range" min={0} max={100} value={Math.round(s.backgroundOpacity * 100)} disabled={!s.background} onChange={(e) => onLive({ ...s, backgroundOpacity: Number(e.target.value) / 100 })} onPointerUp={onCommit} onKeyUp={onCommit} title="Background opacity" />
      </div>
      <label className="check"><input type="checkbox" checked={s.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Shadow</label>
    </div>
  )
}
