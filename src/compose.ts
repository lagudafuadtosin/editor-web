import { LookRenderer, withLook } from './look'
import { NO_BORDER, transformOf, type Anim, type Border, type Clip, type Frame, type Source, type Transform } from './model'
import { drawText } from './text'

export type Img = HTMLCanvasElement | OffscreenCanvas | ImageBitmap
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// One layer at one moment: the clip, its picture (if any), and how far into the clip we are (for animations).
export type Layer = { clip: Clip; img: Img | null; local: number; length: number }

// One frame of the whole project: black, then every active layer from the bottom up.
// scale turns frame pixels into canvas pixels (preview is smaller than the real frame).
export function compose(ctx: Ctx, frame: Frame, scale: number, layers: Layer[], sources: Source[], renderer: LookRenderer | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, frame.w * scale, frame.h * scale)
  for (const { clip, img, local, length } of layers) {
    const tr = transformOf(frame, sources, clip)
    const a = animState(clip.anim, local, length, frame)
    if (a.alpha <= 0) continue
    // Place the box: centre, rotation, flip, then the animation's own move and size on top.
    ctx.setTransform(scale, 0, 0, scale, tr.x * scale, tr.y * scale)
    ctx.translate(0, a.dy)
    ctx.rotate((tr.rotation * Math.PI) / 180)
    ctx.scale(a.scale * (tr.flipH ? -1 : 1), a.scale * (tr.flipV ? -1 : 1))
    ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity * a.alpha))
    if (clip.kind === 'text' && clip.text) drawText(ctx, clip.text, tr.w, a.reveal)
    else if (clip.kind === 'color') drawBox(ctx, scale * a.scale, tr, null, clip.color ?? '#000000', clip.border ?? NO_BORDER)
    else if (img) drawBox(ctx, scale * a.scale, tr, withLook(renderer, img, clip.look), null, clip.border ?? NO_BORDER)
    ctx.globalAlpha = 1
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3)
const easeOutBack = (x: number) => {
  const t = Math.max(0, Math.min(1, x)) - 1
  return 1 + 2.2 * t * t * t + 1.2 * t * t
}

// How an animation changes a clip at a moment: see-through, size, a small move up from below, letters shown.
export function animState(anim: Anim | undefined, local: number, length: number, frame: Frame) {
  const s = { alpha: 1, scale: 1, dy: 0, reveal: 1 }
  if (!anim) return s
  const d = Math.max(0.05, Math.min(anim.duration, length / 2))
  const pIn = local / d
  const pOut = (length - local) / d
  if (pIn < 1) {
    if (anim.in === 'fade') s.alpha *= easeOut(pIn)
    if (anim.in === 'pop') {
      s.scale *= 0.5 + 0.5 * easeOutBack(pIn)
      s.alpha *= easeOut(pIn * 2)
    }
    if (anim.in === 'slide') {
      s.dy += (1 - easeOut(pIn)) * frame.h * 0.06
      s.alpha *= easeOut(pIn)
    }
    if (anim.in === 'typewriter') s.reveal = Math.max(0, Math.min(1, local / Math.max(d, 0.6)))
  }
  if (anim.in === 'typewriter' && local < Math.max(d, 0.6)) s.reveal = Math.max(0, local / Math.max(d, 0.6))
  if (pOut < 1) {
    if (anim.out === 'fade') s.alpha *= easeOut(pOut)
    if (anim.out === 'pop') {
      s.scale *= 0.5 + 0.5 * easeOut(pOut)
      s.alpha *= easeOut(pOut * 2)
    }
    if (anim.out === 'slide') {
      s.dy -= (1 - easeOut(pOut)) * frame.h * 0.06
      s.alpha *= easeOut(pOut)
    }
  }
  return s
}

let featherCanvas: OffscreenCanvas | null = null

// Draws one clip's box, already placed by the caller: picture (or colour), cropped, with soft edges,
// rounded corners, a drop shadow and a border line. pixelScale is canvas pixels per frame pixel.
function drawBox(ctx: Ctx, pixelScale: number, tr: Transform, img: Img | null, color: string | null, border: Border) {
  const { t, b, l, r } = tr.crop
  const fl = l / 100, fr = r / 100, ft = t / 100, fb = b / 100
  if (fl + fr >= 1 || ft + fb >= 1 || tr.w <= 0 || tr.h <= 0) return
  // The part of the box that survives the crop, in box coordinates centred on (0, 0).
  const dx = -tr.w / 2 + fl * tr.w
  const dy = -tr.h / 2 + ft * tr.h
  const dw = tr.w * (1 - fl - fr)
  const dh = tr.h * (1 - ft - fb)
  const radius = Math.min(border.radius, dw / 2, dh / 2)

  if (border.shadow) {
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

  ctx.save()
  if (radius > 0) {
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, radius)
    ctx.clip()
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
    ctx.drawImage(featherCanvas, dx, dy, dw, dh)
  } else {
    paint(ctx, img, color, dx, dy, dw, dh, fl, ft, 1 - fl - fr, 1 - ft - fb)
  }
  ctx.restore()

  if (border.width > 0) {
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
