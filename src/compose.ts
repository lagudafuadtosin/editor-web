import { LookRenderer, presetLut, withLook } from './look'
import { NO_BORDER, transformAt, type Anim, type Border, type Clip, type Frame, type LutFile, type Mask, type Shade, type Source, type Transform, type TransState } from './model'
import { drawText } from './text'
import { drawShape } from './shape'
import { sampleAt } from './motion'
import { sourceAt } from './model'

export type Img = HTMLCanvasElement | OffscreenCanvas | ImageBitmap
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// One layer at one moment: the clip, its picture (if any), and how far into the clip we are (for animations).
export type Layer = { clip: Clip; img: Img | null; local: number; length: number; trans?: TransState | null; level?: number; follow?: { x: number; y: number } | null }

// One frame of the whole project: black, then every active layer from the bottom up.
// scale turns frame pixels into canvas pixels (preview is smaller than the real frame).
export function compose(ctx: Ctx, frame: Frame, scale: number, layers: Layer[], sources: Source[], renderer: LookRenderer | null, luts?: Record<string, LutFile>, transparent = false) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  // Black behind everything, or nothing at all for a see-through export.
  if (transparent) ctx.clearRect(0, 0, frame.w * scale, frame.h * scale)
  else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, frame.w * scale, frame.h * scale)
  }
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const clip = layer.clip
    if (clip.kind === 'adjust') {
      adjust(ctx, clip, layer.local, renderer, luts)
      continue
    }
    const next = layers[i + 1]
    if (clip.matte && next) {
      // Track matte: this clip, cut to the shape of the layer straight above it, which is not shown itself.
      const a = scratch(0, ctx)
      drawLayer(a, frame, scale, layer, sources, renderer, luts, true)
      const b = scratch(1, ctx)
      drawLayer(b, frame, scale, next, sources, renderer, luts, true)
      const luma = clip.matte === 'luma' || clip.matte === 'lumaInv'
      const shape = luma && renderer ? renderer.render(b.canvas as OffscreenCanvas, NEUTRAL_LOOK, { time: 0, lumaAlpha: true }) : b.canvas
      a.setTransform(1, 0, 0, 1, 0, 0)
      a.globalCompositeOperation = clip.matte === 'alpha' || clip.matte === 'luma' ? 'destination-in' : 'destination-out'
      a.drawImage(shape, 0, 0)
      a.globalCompositeOperation = 'source-over'
      place(ctx, a.canvas, layer, frame, sources)
      i++
      continue
    }
    if (clip.mask) {
      if (clip.mask.mode === 'colour') {
        // Colour changes only inside the shape: the picture as filmed, then the changed one cut to the shape over it.
        drawLayer(ctx, frame, scale, { ...layer, clip: { ...clip, look: undefined, lut: undefined, fx: undefined } }, sources, renderer, luts, false)
        const a = scratch(0, ctx)
        const m = drawLayer(a, frame, scale, { ...layer, clip: { ...clip, shade: undefined, border: undefined } }, sources, renderer, luts, true)
        cutToMask(a, m, maskNow(clip, layer.local))
        place(ctx, a.canvas, layer, frame, sources)
      } else {
        const a = scratch(0, ctx)
        const m = drawLayer(a, frame, scale, layer, sources, renderer, luts, true)
        cutToMask(a, m, maskNow(clip, layer.local))
        place(ctx, a.canvas, layer, frame, sources)
      }
      continue
    }
    drawLayer(ctx, frame, scale, layer, sources, renderer, luts, false)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
}

// A mask that follows the clip's own tracked object: moved by how far the object has gone since it was attached.
function maskNow(clip: Clip, local: number): Mask {
  const m = clip.mask!
  if (!m.followFrom || !clip.track?.points.length) return m
  const pt = sampleAt(clip.track.points, sourceAt(clip, local))
  if (!pt) return m
  return { ...m, x: m.x + (pt[1] - m.followFrom[0]), y: m.y + (pt[2] - m.followFrom[1]) }
}

const NEUTRAL_LOOK = { exposure: 0, brightness: 0, contrast: 0, shadows: 0, highlights: 0, warmth: 0, saturation: 0 }

// Two spare canvases the size of the output, for layers that are cut to a shape before they are laid down.
const scratches: OffscreenCanvas[] = []
function scratch(n: number, like: Ctx): OffscreenCanvasRenderingContext2D {
  const w = (like.canvas as HTMLCanvasElement | OffscreenCanvas).width
  const h = (like.canvas as HTMLCanvasElement | OffscreenCanvas).height
  if (!scratches[n]) scratches[n] = new OffscreenCanvas(w, h)
  const c = scratches[n]
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const x = c.getContext('2d')!
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalAlpha = 1
  x.globalCompositeOperation = 'source-over'
  x.filter = 'none'
  x.clearRect(0, 0, w, h)
  return x
}

// A layer drawn on its own is laid onto the picture with its see-through and blend mode.
function place(ctx: Ctx, canvas: OffscreenCanvas | HTMLCanvasElement, layer: Layer, frame: Frame, sources: Source[]) {
  const tr = transformAt(frame, sources, layer.clip, layer.local)
  const a = animState(layer.clip.anim, layer.local, layer.length, frame)
  const x = transEffect(layer.trans, frame)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity * a.alpha * x.alpha))
  ctx.globalCompositeOperation = layer.clip.blend ?? 'source-over'
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()
}

// Keeps (or, inverted, takes away) the part of the drawn layer inside the mask's shape, with a soft edge.
function cutToMask(c: OffscreenCanvasRenderingContext2D, box: { m: DOMMatrix; w: number; h: number; px: number }, mask: Mask) {
  c.save()
  c.setTransform(box.m)
  c.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'
  if (mask.feather > 0) c.filter = `blur(${mask.feather * box.px * 0.5}px)`
  c.fillStyle = '#000'
  c.beginPath()
  const cx = (mask.x - 0.5) * box.w
  const cy = (mask.y - 0.5) * box.h
  const w = mask.w * box.w
  const h = mask.h * box.h
  if (mask.shape === 'ellipse') c.ellipse(cx, cy, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2)
  else if (mask.shape === 'round') c.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.2)
  else if (mask.shape === 'pen' && (mask.points?.length ?? 0) >= 3) {
    mask.points!.forEach(([px, py], k) => (k ? c.lineTo : c.moveTo).call(c, (px - 0.5) * box.w, (py - 0.5) * box.h))
    c.closePath()
  } else c.rect(cx - w / 2, cy - h / 2, w, h)
  c.fill()
  c.restore()
}

// One layer: placed, animated, given its transition, and drawn. Returns where its box ended up, for a mask.
// `plain` draws it at full strength with no blend mode (used when it is drawn on its own first).
function drawLayer(ctx: Ctx, frame: Frame, scale: number, layer: Layer, sources: Source[], renderer: LookRenderer | null, luts: Record<string, LutFile> | undefined, plain: boolean) {
  const { clip, local, length, trans } = layer
  let img = layer.img
  {
    let base = transformAt(frame, sources, clip, local)
    // Following a tracked object: the centre sits at the same distance from it as when it was attached.
    if (clip.follow && layer.follow) base = { ...base, x: layer.follow.x + clip.follow.ox, y: layer.follow.y + clip.follow.oy }
    const a = animState(clip.anim, local, length, frame)
    // Stabilised: each frame is moved and turned back onto the smooth path, slightly zoomed so no edge shows.
    if (clip.stab?.data.length) {
      const s = sampleAt(clip.stab.data, sourceAt(clip, local))
      if (s) {
        base = { ...base, x: base.x + s[1] * base.w, y: base.y + s[2] * base.h, rotation: base.rotation + (s[3] * 180) / Math.PI }
        a.scale *= clip.stab.zoom
      }
    }
    // A transition moves, fades, scales or uncovers the clips on either side of a cut.
    const x = transEffect(trans, frame)
    const tr = { ...base, x: base.x + x.dx, y: base.y + x.dy }
    a.alpha *= x.alpha
    a.scale *= x.scale
    // Move to the music: a little bigger on every loud moment of the sound tracks.
    if (clip.fx?.beat) a.scale *= 1 + (clip.fx.beat / 100) * 0.14 * Math.pow(layer.level ?? 0, 2)
    a.rot += x.rot
    if (a.alpha <= 0) {
      // Not showing yet (the first half of a dip): the dip itself still has to be drawn.
      if (x.dip && !plain) drawDip(ctx, frame, scale, x.dip)
      return { m: new DOMMatrix(), w: 0, h: 0, px: scale }
    }
    // Blurred fill: the same picture, blurred and a little darker, covering the whole frame behind the clip.
    if (clip.fillBlur && img && !plain) {
      const iw = img.width
      const ih = img.height
      const s = Math.max(frame.w / iw, frame.h / ih)
      ctx.save()
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity * a.alpha))
      ctx.filter = `blur(${(8 + clip.fillBlur * 0.5) * scale}px)`
      // Drawn a little larger than the frame, so the blur does not fade at the edges.
      const k = s * 1.08
      ctx.drawImage(img, (frame.w - iw * k) / 2, (frame.h - ih * k) / 2, iw * k, ih * k)
      ctx.filter = 'none'
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(0, 0, frame.w, frame.h)
      ctx.restore()
    }
    ctx.save()
    if (x.clip) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.beginPath()
      if (x.clip.circle) ctx.arc(frame.w / 2, frame.h / 2, x.clip.circle, 0, Math.PI * 2)
      else ctx.rect(x.clip.x, x.clip.y, x.clip.w, x.clip.h)
      ctx.clip()
    }
    // Shake: a small wobble that changes every frame, like a hand-held camera or an impact.
    const shake = (clip.fx?.shake ?? 0) / 100
    const sx = shake ? wobble(local * 13.1) * frame.w * 0.02 * shake : 0
    const sy = shake ? wobble(local * 11.7 + 40) * frame.h * 0.015 * shake : 0
    // Place the box: centre, rotation, flip, then the animation's own move and size on top.
    ctx.setTransform(scale, 0, 0, scale, (tr.x + sx + a.dx) * scale, (tr.y + sy) * scale)
    ctx.translate(0, a.dy)
    ctx.rotate(((tr.rotation + a.rot + (shake ? wobble(local * 9.3 + 7) * 1.5 * shake : 0)) * Math.PI) / 180)
    ctx.scale(a.scale * (tr.flipH ? -1 : 1), a.scale * (tr.flipV ? -1 : 1))
    ctx.globalAlpha = plain ? 1 : Math.max(0, Math.min(1, tr.opacity * a.alpha))
    ctx.globalCompositeOperation = plain ? 'source-over' : clip.blend ?? 'source-over'
    const where = { m: ctx.getTransform(), w: tr.w, h: tr.h, px: scale * a.scale }
    const extra = { fx: clip.fx, key: clip.key, lut: lutFor(clip, luts), time: local }
    const pixelScale = scale * a.scale
    const box = (pic: Img | null, color: string | null, opts: Paint) => drawBox(ctx, pixelScale, tr, pic, color, clip.border ?? NO_BORDER, opts)
    if (clip.kind === 'shape' && clip.shape) {
      if (clip.shade) withShade(ctx, clip.shade, pixelScale, (c) => drawShape(c, clip.shape!, tr.w, tr.h))
      else drawShape(ctx, clip.shape, tr.w, tr.h)
    } else if (clip.kind === 'text' && clip.text) {
      if (clip.shade) withShade(ctx, clip.shade, pixelScale, (c) => drawText(c, clip.text!, tr.w, a.reveal, clip.words, local))
      else drawText(ctx, clip.text, tr.w, a.reveal, clip.words, local)
    } else if (clip.kind === 'color' || img) {
      let pic = img ? withLook(renderer, img, clip.look, extra) : null
      const color = clip.kind === 'color' ? clip.color ?? '#000000' : null
      const blur = (clip.fx?.blur ?? 0) / 100
      box(pic, color, { blur: blur * 30 * pixelScale + x.blur * scale, shade: clip.shade })
      // Glow (bloom): a soft, brightened copy of the picture laid over it.
      const glow = (clip.fx?.glow ?? 0) / 100
      if (glow > 0 && pic) {
        const alpha = ctx.globalAlpha
        const mode = ctx.globalCompositeOperation
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = alpha * glow * 0.7
        box(pic, null, { blur: (8 + glow * 30) * pixelScale, noBorder: true })
        ctx.globalAlpha = alpha
        ctx.globalCompositeOperation = mode
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
    if (x.dip && !plain) drawDip(ctx, frame, scale, x.dip)
    return where
  }
}

// Dip to black or white: a full-frame colour that peaks at the cut.
function drawDip(ctx: Ctx, frame: Frame, scale: number, dip: { color: string; alpha: number }) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = dip.alpha
  ctx.fillStyle = dip.color
  ctx.fillRect(0, 0, frame.w * scale, frame.h * scale)
  ctx.restore()
}

type TransFx = {
  alpha: number; scale: number; rot: number; dx: number; dy: number; blur: number
  clip?: { x: number; y: number; w: number; h: number; circle?: number }
  dip?: { color: string; alpha: number }
}

// What a transition does to one side of the cut at a moment. u runs 0 to 1 across the transition.
function transEffect(t: TransState | null | undefined, f: Frame): TransFx {
  const n: TransFx = { alpha: 1, scale: 1, rot: 0, dx: 0, dy: 0, blur: 0 }
  if (!t) return n
  const u = t.u
  const s = u * u * (3 - 2 * u)
  if (t.side === 'in') {
    switch (t.type) {
      case 'dissolve': return { ...n, alpha: u }
      case 'dip': case 'dipWhite':
        return { ...n, alpha: u < 0.5 ? 0 : 1, dip: { color: t.type === 'dip' ? '#000' : '#fff', alpha: 1 - Math.abs(2 * u - 1) } }
      case 'wipeLeft': return { ...n, clip: { x: (1 - s) * f.w, y: 0, w: f.w, h: f.h } }
      case 'wipeUp': return { ...n, clip: { x: 0, y: (1 - s) * f.h, w: f.w, h: f.h } }
      case 'slideLeft': case 'push': return { ...n, dx: (1 - s) * f.w }
      case 'slideUp': return { ...n, dy: (1 - s) * f.h }
      case 'zoom': return { ...n, alpha: u, scale: 1.25 - 0.25 * s }
      case 'spin': return { ...n, alpha: Math.min(1, u * 2), rot: -(1 - s) * 90, scale: 0.4 + 0.6 * s }
      case 'blur': return { ...n, alpha: u, blur: (1 - u) * 25 }
      case 'circle': return { ...n, clip: { x: 0, y: 0, w: f.w, h: f.h, circle: Math.max(0.5, s * Math.hypot(f.w, f.h) / 2) } }
    }
  } else {
    switch (t.type) {
      case 'push': return { ...n, dx: -s * f.w }
      case 'zoom': return { ...n, scale: 1 + 0.25 * s }
      case 'blur': return { ...n, blur: u * 25 }
      default: return n
    }
  }
  return n
}

// An adjustment layer: everything drawn so far is run through its look and effects, then put back,
// faded by the layer's own see-through setting.
let adjustCopy: OffscreenCanvas | null = null
function adjust(ctx: Ctx, clip: Clip, local: number, renderer: LookRenderer | null, luts?: Record<string, LutFile>) {
  const canvas = ctx.canvas as HTMLCanvasElement | OffscreenCanvas
  if (!adjustCopy) adjustCopy = new OffscreenCanvas(canvas.width, canvas.height)
  if (adjustCopy.width !== canvas.width || adjustCopy.height !== canvas.height) {
    adjustCopy.width = canvas.width
    adjustCopy.height = canvas.height
  }
  const c = adjustCopy.getContext('2d')!
  c.globalCompositeOperation = 'copy'
  c.drawImage(canvas, 0, 0)
  c.globalCompositeOperation = 'source-over'
  const pic = withLook(renderer, adjustCopy, clip.look, { fx: clip.fx, lut: lutFor(clip, luts), time: local })
  const blur = ((clip.fx?.blur ?? 0) / 100) * 30 * (canvas.width / 1080)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = Math.max(0, Math.min(1, clip.transform?.opacity ?? 1))
  if (blur) ctx.filter = `blur(${blur}px)`
  ctx.drawImage(pic, 0, 0)
  ctx.restore()
}

// Smooth random wobble between -1 and 1, the same every time for the same moment (so preview matches export).
function wobble(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const h = (n: number) => {
    const v = Math.sin(n * 127.1) * 43758.5453
    return (v - Math.floor(v)) * 2 - 1
  }
  const t = f * f * (3 - 2 * f)
  return h(i) * (1 - t) + h(i + 1) * t
}

function lutFor(clip: Clip, luts?: Record<string, LutFile>) {
  if (!clip.lut) return undefined
  const file = clip.lut.id.startsWith('look:') ? presetLut(clip.lut.id) : luts?.[clip.lut.id]
  return file ? { file, key: clip.lut.id, strength: clip.lut.strength } : undefined
}

// A drop shadow and an outer glow around whatever `draw` paints, following its own shape.
// The glow and the shadow are drawn on their own, in normal mode, on a scratch canvas: the thing itself is
// drawn far off the canvas so only its shadow lands in place, then the thing's own shape is cut out of them, so
// nothing shows through a see-through or blended clip. Then the thing is drawn, once, with its own blend.
let shadeCanvas: OffscreenCanvas | null = null
function withShade(ctx: Ctx, shade: Shade, pixelScale: number, draw: (c: Ctx) => void) {
  const rad = (shade.angle * Math.PI) / 180
  const passes = [
    shade.glow > 0 && { color: hexA(shade.glowColor, shade.glow / 100), blur: shade.glowSize * pixelScale, ox: 0, oy: 0 },
    shade.shadow > 0 && { color: hexA(shade.shadowColor, shade.shadow / 100), blur: shade.shadowBlur * pixelScale, ox: Math.cos(rad) * shade.distance * pixelScale, oy: Math.sin(rad) * shade.distance * pixelScale },
  ].filter((p): p is { color: string; blur: number; ox: number; oy: number } => !!p)
  if (passes.length) {
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    if (!shadeCanvas) shadeCanvas = new OffscreenCanvas(W, H)
    if (shadeCanvas.width !== W || shadeCanvas.height !== H) {
      shadeCanvas.width = W
      shadeCanvas.height = H
    }
    const s = shadeCanvas.getContext('2d')!
    s.setTransform(1, 0, 0, 1, 0, 0)
    s.clearRect(0, 0, W, H)
    const at = ctx.getTransform()
    const away = (W + H) * 2 + 1000
    for (const p of passes) {
      s.save()
      s.setTransform(new DOMMatrix().translateSelf(-away, 0).multiplySelf(at))
      s.shadowColor = p.color
      s.shadowBlur = p.blur
      s.shadowOffsetX = p.ox + away
      s.shadowOffsetY = p.oy
      draw(s)
      s.restore()
    }
    s.save()
    s.setTransform(at)
    s.globalCompositeOperation = 'destination-out'
    draw(s)
    s.restore()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(shadeCanvas, 0, 0)
    ctx.restore()
  }
  draw(ctx)
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${Math.max(0, Math.min(1, a))})`
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3)
const easeOutBack = (x: number) => {
  const t = Math.max(0, Math.min(1, x)) - 1
  return 1 + 2.2 * t * t * t + 1.2 * t * t
}

// How an animation changes a clip at a moment: see-through, size, a small move up from below, letters shown.
export function animState(anim: Anim | undefined, local: number, length: number, frame: Frame) {
  const s = { alpha: 1, scale: 1, dy: 0, dx: 0, rot: 0, reveal: 1 }
  if (!anim) return s
  // Movement the whole time the clip is on screen: a slow zoom or pan (the Ken Burns look).
  const k = Math.max(0, Math.min(1, local / Math.max(0.05, length)))
  const kk = k * k * (3 - 2 * k)
  if (anim.during === 'zoomIn') s.scale *= 1 + 0.15 * kk
  if (anim.during === 'zoomOut') s.scale *= 1.15 - 0.15 * kk
  if (anim.during === 'panLeft') s.dx -= (kk - 0.5) * frame.w * 0.08
  if (anim.during === 'panRight') s.dx += (kk - 0.5) * frame.w * 0.08
  // Credits: from below the frame to above it, at a steady speed.
  if (anim.during === 'rollUp') s.dy += (1 - 2 * k) * frame.h * 1.1
  const d = Math.max(0.05, Math.min(anim.duration, length / 2))
  const pIn = local / d
  const pOut = (length - local) / d
  // Every move is seen: the thing shows within the first quarter of the move (fade is the one that is all fade),
  // and it travels far enough to notice.
  if (pIn < 1) {
    const show = easeOut(pIn * 4)
    if (anim.in === 'fade') s.alpha *= easeOut(pIn)
    if (anim.in === 'pop') {
      // From nothing, a little past full size, then settles.
      s.scale *= Math.max(0, easeOutBack(pIn))
      s.alpha *= show
    }
    if (anim.in === 'slide') {
      // From a quarter of the frame lower.
      s.dy += (1 - easeOut(pIn)) * frame.h * 0.25
      s.alpha *= show
    }
    if (anim.in === 'zoom') {
      // From more than twice the size, down to its own.
      s.scale *= 2.2 - 1.2 * easeOut(pIn)
      s.alpha *= show
    }
    if (anim.in === 'bounce') {
      // Drops from a third of the frame above and bounces twice.
      s.dy -= bounce(pIn) * frame.h * 0.3
      s.alpha *= easeOut(pIn * 8)
    }
    if (anim.in === 'spin') {
      // A full turn while it grows.
      s.rot -= (1 - easeOut(pIn)) * 360
      s.scale *= 0.2 + 0.8 * easeOut(pIn)
      s.alpha *= show
    }
  }
  if (anim.in === 'typewriter' && local < Math.max(d, 0.6)) s.reveal = Math.max(0, local / Math.max(d, 0.6))
  if (pOut < 1) {
    const show = easeOut(pOut * 4)
    if (anim.out === 'fade') s.alpha *= easeOut(pOut)
    if (anim.out === 'pop') {
      s.scale *= Math.max(0, easeOutBack(pOut))
      s.alpha *= show
    }
    if (anim.out === 'slide') {
      s.dy -= (1 - easeOut(pOut)) * frame.h * 0.25
      s.alpha *= show
    }
    if (anim.out === 'zoom') {
      s.scale *= 2.2 - 1.2 * easeOut(pOut)
      s.alpha *= show
    }
    if (anim.out === 'spin') {
      s.rot += (1 - easeOut(pOut)) * 360
      s.scale *= 0.2 + 0.8 * easeOut(pOut)
      s.alpha *= show
    }
  }
  return s
}

// Drops in from above and settles with two small bounces.
function bounce(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return Math.abs(Math.cos(t * Math.PI * 2.5)) * Math.pow(1 - t, 2)
}

type Paint = { blur?: number; shade?: Shade; noBorder?: boolean }

let featherCanvas: OffscreenCanvas | null = null
let roundCanvas: OffscreenCanvas | null = null

// Draws one clip's box, already placed by the caller: picture (or colour), cropped, with soft edges,
// rounded corners, a drop shadow and a border line. pixelScale is canvas pixels per frame pixel.
function drawBox(ctx: Ctx, pixelScale: number, tr: Transform, img: Img | null, color: string | null, border: Border, opts: Paint = {}) {
  const { t, b, l, r } = tr.crop
  const fl = l / 100, fr = r / 100, ft = t / 100, fb = b / 100
  if (fl + fr >= 1 || ft + fb >= 1 || tr.w <= 0 || tr.h <= 0) return
  // The part of the box that survives the crop, in box coordinates centred on (0, 0).
  const dx = -tr.w / 2 + fl * tr.w
  const dy = -tr.h / 2 + ft * tr.h
  const dw = tr.w * (1 - fl - fr)
  const dh = tr.h * (1 - ft - fb)
  const radius = Math.min(border.radius, dw / 2, dh / 2)

  if (border.shadow && !opts.noBorder) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 40 * pixelScale
    ctx.shadowOffsetY = 14 * pixelScale
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, radius)
    ctx.fill()
    ctx.restore()
  }

  const drawPicture = (c: Ctx) => {
  c.save()
  if (opts.blur) c.filter = `blur(${opts.blur}px)`
  if (radius > 0) {
    c.beginPath()
    c.roundRect(dx, dy, dw, dh, radius)
    c.clip()
  }
  if (tr.feather > 0) {
    // Soft edges: draw the box on its own, fade its edges with a blurred mask, then place it.
    const pw = Math.max(1, Math.round(dw * pixelScale))
    const ph = Math.max(1, Math.round(dh * pixelScale))
    if (!featherCanvas) featherCanvas = new OffscreenCanvas(pw, ph)
    featherCanvas.width = pw
    featherCanvas.height = ph
    const f = featherCanvas.getContext('2d')!
    paint(f, img, color, 0, 0, pw, ph, fl, ft, 1 - fl - fr, 1 - ft - fb)
    const blur = tr.feather * pixelScale
    f.globalCompositeOperation = 'destination-in'
    f.filter = `blur(${blur / 2}px)`
    f.fillStyle = '#000'
    f.fillRect(blur, blur, pw - 2 * blur, ph - 2 * blur)
    f.filter = 'none'
    f.globalCompositeOperation = 'source-over'
    c.drawImage(featherCanvas, dx, dy, dw, dh)
  } else {
    paint(c, img, color, dx, dy, dw, dh, fl, ft, 1 - fl - fr, 1 - ft - fb)
  }
  c.restore()
  }
  if (opts.shade && radius > 0) {
    // Rounded corners clip the canvas, and the clip would cut the glow and shadow off too. So the rounded
    // picture is made on its own first, then drawn with its glow and shadow and no clip.
    const pw = Math.max(1, Math.round(dw * pixelScale))
    const ph = Math.max(1, Math.round(dh * pixelScale))
    if (!roundCanvas) roundCanvas = new OffscreenCanvas(pw, ph)
    roundCanvas.width = pw
    roundCanvas.height = ph
    const o = roundCanvas.getContext('2d')!
    paint(o, img, color, 0, 0, pw, ph, fl, ft, 1 - fl - fr, 1 - ft - fb)
    o.globalCompositeOperation = 'destination-in'
    if (tr.feather > 0) {
      const fb2 = tr.feather * pixelScale
      o.filter = `blur(${fb2 / 2}px)`
      o.fillStyle = '#000'
      o.fillRect(fb2, fb2, pw - 2 * fb2, ph - 2 * fb2)
      o.filter = 'none'
    }
    o.beginPath()
    o.roundRect(0, 0, pw, ph, radius * pixelScale)
    o.fill()
    o.globalCompositeOperation = 'source-over'
    withShade(ctx, opts.shade, pixelScale, (c) => {
      c.save()
      if (opts.blur) c.filter = `blur(${opts.blur}px)`
      c.drawImage(roundCanvas!, dx, dy, dw, dh)
      c.restore()
    })
  } else if (opts.shade) withShade(ctx, opts.shade, pixelScale, drawPicture)
  else drawPicture(ctx)

  if (border.width > 0 && !opts.noBorder) {
    ctx.save()
    ctx.strokeStyle = border.color
    ctx.lineWidth = border.width
    ctx.beginPath()
    // The line sits just inside the edge, so it never changes the box's size.
    ctx.roundRect(dx + border.width / 2, dy + border.width / 2, dw - border.width, dh - border.width, Math.max(0, radius - border.width / 2))
    ctx.stroke()
    ctx.restore()
  }
}

// Fills a rectangle with a colour, or with the matching part of the picture (sx..sw are fractions of the picture).
function paint(ctx: Ctx, img: Img | null, color: string | null, x: number, y: number, w: number, h: number, sx: number, sy: number, sw: number, sh: number) {
  if (img) ctx.drawImage(img, sx * img.width, sy * img.height, sw * img.width, sh * img.height, x, y, w, h)
  else {
    ctx.fillStyle = color ?? '#000'
    ctx.fillRect(x, y, w, h)
  }
}
