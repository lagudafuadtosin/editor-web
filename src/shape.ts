import { fitTransform, type Frame, type Transform } from './model'

// Shapes on the video: drawn fresh every frame inside the clip's box, so they stay sharp at any size and
// move, turn, fade and animate like text does.

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'bubble' | 'draw'

export type ShapeStyle = {
  kind: ShapeKind
  fillOn: boolean
  fill: string
  stroke: string
  strokeWidth: number // frame pixels; 0 is no outline (a line always has some)
  radius: number // round corners, frame pixels (rectangle and speech bubble)
  points?: [number, number][] // a freehand drawing: the stroke's points as fractions of its box
}

export const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'bubble', label: 'Speech bubble' },
]

export function defaultShape(kind: ShapeKind): ShapeStyle {
  if (kind === 'line') return { kind, fillOn: false, fill: '#facc15', stroke: '#facc15', strokeWidth: 14, radius: 0 }
  if (kind === 'bubble') return { kind, fillOn: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 6, radius: 48 }
  return { kind, fillOn: true, fill: '#facc15', stroke: '#ffffff', strokeWidth: 0, radius: kind === 'rect' ? 24 : 0 }
}

// A new shape's box, in the middle of the frame: wide and thin for a line or an arrow, square for the rest.
export function shapeBox(frame: Frame, kind: ShapeKind): Transform {
  const side = Math.min(frame.w, frame.h) * 0.4
  const [w, h] = kind === 'line' ? [frame.w * 0.6, 60] : kind === 'arrow' ? [side * 1.4, side * 0.6] : kind === 'bubble' ? [side * 1.4, side] : [side, side]
  return { ...fitTransform(frame, frame.w, frame.h), w, h, keepRatio: kind !== 'line' && kind !== 'arrow' && kind !== 'bubble' }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Draws the shape in a w by h box centred on (0, 0), in frame pixels.
export function drawShape(ctx: Ctx, s: ShapeStyle, w: number, h: number) {
  if (w <= 0 || h <= 0) return
  const x0 = -w / 2
  const y0 = -h / 2
  ctx.beginPath()
  switch (s.kind) {
    case 'rect':
      ctx.roundRect(x0, y0, w, h, Math.min(s.radius, w / 2, h / 2))
      break
    case 'ellipse':
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'triangle':
      ctx.moveTo(0, y0)
      ctx.lineTo(w / 2, h / 2)
      ctx.lineTo(x0, h / 2)
      ctx.closePath()
      break
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? 0.42 : 1
        const px = Math.cos(a) * r * (w / 2)
        const py = Math.sin(a) * r * (h / 2) + h * 0.05 // the points sit a little low, so the star looks centred
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.closePath()
      break
    case 'line':
      ctx.moveTo(x0, 0)
      ctx.lineTo(w / 2, 0)
      break
    case 'draw':
      ;(s.points ?? []).forEach(([px, py], i) => (i ? ctx.lineTo(x0 + px * w, y0 + py * h) : ctx.moveTo(x0 + px * w, y0 + py * h)))
      break
    case 'arrow': {
      // A shaft and a head that fill the box, pointing right; turn the clip to point it elsewhere.
      const head = Math.min(w * 0.4, h * 1.2)
      const shaft = h * 0.36
      ctx.moveTo(x0, -shaft / 2)
      ctx.lineTo(w / 2 - head, -shaft / 2)
      ctx.lineTo(w / 2 - head, y0)
      ctx.lineTo(w / 2, 0)
      ctx.lineTo(w / 2 - head, h / 2)
      ctx.lineTo(w / 2 - head, shaft / 2)
      ctx.lineTo(x0, shaft / 2)
      ctx.closePath()
      break
    }
    case 'bubble': {
      // A rounded box with a tail at the bottom left: the body takes the top three quarters.
      const bh = h * 0.76
      const r = Math.min(s.radius, w / 2, bh / 2)
      const by = y0 + bh
      ctx.moveTo(x0 + r, y0)
      ctx.arcTo(w / 2, y0, w / 2, by, r)
      ctx.arcTo(w / 2, by, x0, by, r)
      ctx.lineTo(x0 + w * 0.34, by)
      ctx.lineTo(x0 + w * 0.16, h / 2)
      ctx.lineTo(x0 + w * 0.2, by)
      ctx.arcTo(x0, by, x0, y0, r)
      ctx.arcTo(x0, y0, w / 2, y0, r)
      ctx.closePath()
      break
    }
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (s.kind === 'line' || s.kind === 'draw') {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = Math.max(1, s.strokeWidth)
    ctx.stroke()
    return
  }
  if (s.fillOn) {
    ctx.fillStyle = s.fill
    ctx.fill()
  }
  if (s.strokeWidth > 0) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = s.strokeWidth
    ctx.stroke()
  }
}

// A freehand stroke (frame pixels) as a drawing shape: its box, and its points as fractions of that box.
export function drawingFrom(points: [number, number][], stroke: string, width: number) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const pad = width / 2 + 2
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  const w = Math.max(...xs) + pad - x0
  const h = Math.max(...ys) + pad - y0
  const style: ShapeStyle = { kind: 'draw', fillOn: false, fill: stroke, stroke, strokeWidth: width, radius: 0, points: points.map(([x, y]) => [(x - x0) / w, (y - y0) / h]) }
  return { style, box: { x: x0 + w / 2, y: y0 + h / 2, w, h } }
}

// Stickers: emoji, drawn as big text.
export const STICKERS = [
  '😀', '😂', '🤣', '😍', '🥰', '😎', '🤩', '😱', '😭', '😡', '🤯', '🥳', '🤔', '🙄', '😴', '🤫',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '👉', '👈', '👆', '👇', '✌️', '🤞', '🫶', '❤️', '💔',
  '🔥', '💯', '✨', '⭐', '⚡', '💥', '💫', '🎉', '🎊', '🏆', '👑', '💎', '💰', '🎬', '🎮', '🎧',
  '⚽', '🏀', '🎯', '🚀', '🌈', '☀️', '🌙', '❗', '❓', '✅', '❌', '⚠️', '📌', '📍', '🆕', '🔴',
]
