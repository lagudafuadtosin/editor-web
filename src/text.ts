// How a text clip looks. Sizes are in frame pixels (a 1080-wide frame), so they come out the same at any export size.
export type TextStyle = {
  text: string
  font: string
  size: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  color: string
  outlineColor: string
  outlineWidth: number // 0 = no outline
  background: boolean
  backgroundColor: string
  backgroundOpacity: number // 0 to 1
  shadow: boolean
  lineSpacing: number // 1 = normal
  glow?: boolean // a soft light in the text colour around the letters
  uppercase?: boolean
}

export const FONTS = ['Arial', 'Impact', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Segoe UI']

export const DEFAULT_TEXT: TextStyle = {
  text: 'Your text',
  font: 'Arial',
  size: 90,
  bold: true,
  italic: false,
  align: 'center',
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 8,
  background: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  shadow: false,
  lineSpacing: 1.15,
}

export const fontOf = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px "${s.font}", sans-serif`
export const paddingOf = (s: TextStyle) => Math.round(s.size * (s.background ? 0.35 : 0.15))

let measurer: OffscreenCanvasRenderingContext2D | null = null

// Splits the text into lines that fit the box width (the person's own line breaks are kept),
// and works out how tall the box has to be. This is what makes the box grow and shrink by itself.
export function layoutText(s: TextStyle, boxWidth: number): { lines: string[]; lineHeight: number; height: number } {
  const text = s.uppercase ? s.text.toUpperCase() : s.text
  if (!measurer) measurer = new OffscreenCanvas(1, 1).getContext('2d')!
  measurer.font = fontOf(s)
  const pad = paddingOf(s)
  const max = Math.max(s.size, boxWidth - 2 * pad)
  const lines: string[] = []
  for (const para of (text || ' ').split('\n')) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const tryLine = line + w
      if (line && measurer.measureText(tryLine.trimEnd()).width > max) {
        lines.push(line.trimEnd())
        line = w.trimStart()
        // A single word wider than the box is broken by letters.
        while (measurer.measureText(line).width > max && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && measurer.measureText(line.slice(0, cut)).width > max) cut--
          lines.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      } else line = tryLine
    }
    lines.push(line.trimEnd())
  }
  const lineHeight = s.size * s.lineSpacing
  return { lines, lineHeight, height: lines.length * lineHeight + 2 * pad }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Draws the text inside a box of width w centred on (0, 0). The caller has already moved, scaled and rotated.
// reveal (0 to 1) shows only the first part of the letters, for the typewriter animation.
export function drawText(ctx: Ctx, s: TextStyle, w: number, reveal = 1) {
  const { lines, lineHeight, height } = layoutText(s, w)
  const totalChars = lines.reduce((n, l) => n + l.length, 0)
  let budget = reveal >= 1 ? Infinity : Math.floor(totalChars * reveal)
  const pad = paddingOf(s)
  if (s.background) {
    ctx.save()
    ctx.globalAlpha *= s.backgroundOpacity
    ctx.fillStyle = s.backgroundColor
    const r = Math.min(s.size * 0.25, height / 2)
    ctx.beginPath()
    ctx.roundRect(-w / 2, -height / 2, w, height, r)
    ctx.fill()
    ctx.restore()
  }
  ctx.font = fontOf(s)
  ctx.textAlign = s.align
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const x = s.align === 'left' ? -w / 2 + pad : s.align === 'right' ? w / 2 - pad : 0
  lines.forEach((full, i) => {
    if (budget <= 0) return
    const line = full.slice(0, budget)
    budget -= full.length
    const y = -height / 2 + pad + lineHeight * (i + 0.5)
    if (s.glow) {
      ctx.save()
      ctx.shadowColor = s.color
      ctx.shadowBlur = s.size * 0.45
      ctx.fillStyle = s.color
      ctx.fillText(line, x, y)
      ctx.fillText(line, x, y)
      ctx.restore()
    }
    if (s.shadow) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.75)'
      ctx.shadowBlur = s.size * 0.15
      ctx.shadowOffsetY = s.size * 0.06
      ctx.fillStyle = s.color
      ctx.fillText(line, x, y)
      ctx.restore()
    }
    if (s.outlineWidth > 0) {
      ctx.strokeStyle = s.outlineColor
      ctx.lineWidth = s.outlineWidth * 2 // a stroke is centred on the edge, so half of it sits outside the letters
      ctx.strokeText(line, x, y)
    }
    ctx.fillStyle = s.color
    ctx.fillText(line, x, y)
  })
}
