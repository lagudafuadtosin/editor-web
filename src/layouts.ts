import { activeVideo, sourceSize, updateClip, type Clip, type Frame, type Project, type Source, type Transform } from './model'

// Ready-made screen layouts for the clips showing at the playhead: picture in picture, side by side,
// top and bottom, three stacked. Each clip is cropped to fill its part of the frame, never squashed.

export type LayoutId = 'pip' | 'pipLeft' | 'side' | 'stack' | 'three'

export const LAYOUTS: { id: LayoutId; label: string; needs: number }[] = [
  { id: 'pip', label: 'Picture in picture, bottom right', needs: 2 },
  { id: 'pipLeft', label: 'Picture in picture, top left', needs: 2 },
  { id: 'side', label: 'Side by side', needs: 2 },
  { id: 'stack', label: 'Top and bottom', needs: 2 },
  { id: 'three', label: 'Three stacked', needs: 3 },
]

const base = (x: number, y: number, w: number, h: number): Transform => ({
  x, y, w, h, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0,
})

// A box that fills the cell (x, y, w, h are the cell's centre and size), cropping the picture's overflow.
function fillCell(src: [number, number], cx: number, cy: number, cw: number, ch: number): Transform {
  const [sw, sh] = src
  const scale = Math.max(cw / sw, ch / sh)
  const w = sw * scale
  const h = sh * scale
  // Crop is in percent of the box from each side; the box stays the size of the whole picture, centred on the cell.
  const cropX = ((w - cw) / 2 / w) * 100
  const cropY = ((h - ch) / 2 / h) * 100
  return { ...base(cx, cy, w, h), crop: { t: cropY, b: cropY, l: cropX, r: cropX } }
}

// The pictures (video or still) showing now, bottom layer first.
export function showingPictures(p: Project, t: number): Clip[] {
  return activeVideo(p, t).map((pl) => pl.clip).filter((c) => c.kind === 'media' || c.kind === 'image')
}

export function applyLayout(p: Project, sources: Source[], t: number, id: LayoutId): Project {
  const clips = showingPictures(p, t)
  const f: Frame = p.frame
  const size = (c: Clip) => sourceSize(sources, c) ?? [f.w, f.h]
  let next = p
  const set = (c: Clip, tr: Transform) => (next = updateClip(next, c.id, { transform: tr }))
  if (id === 'pip' || id === 'pipLeft') {
    const [back, front] = [clips[0], clips[clips.length - 1]]
    set(back, fillCell(size(back), f.w / 2, f.h / 2, f.w, f.h))
    const [sw, sh] = size(front)
    const w = f.w * 0.38
    const h = (w * sh) / sw
    const margin = f.w * 0.05
    const x = id === 'pip' ? f.w - margin - w / 2 : margin + w / 2
    const y = id === 'pip' ? f.h - margin * 2.4 - h / 2 : margin * 2.4 + h / 2
    set(front, base(x, y, w, h))
    next = updateClip(next, front.id, { border: { width: 6, color: '#ffffff', radius: 28, shadow: true } })
    return next
  }
  if (id === 'side') {
    const [a, b] = clips.slice(-2)
    set(a, fillCell(size(a), f.w / 4, f.h / 2, f.w / 2, f.h))
    set(b, fillCell(size(b), (3 * f.w) / 4, f.h / 2, f.w / 2, f.h))
    return next
  }
  if (id === 'stack') {
    const [a, b] = clips.slice(-2)
    set(a, fillCell(size(a), f.w / 2, f.h / 4, f.w, f.h / 2))
    set(b, fillCell(size(b), f.w / 2, (3 * f.h) / 4, f.w, f.h / 2))
    return next
  }
  const three = clips.slice(-3)
  three.forEach((c, i) => set(c, fillCell(size(c), f.w / 2, (f.h / 6) * (2 * i + 1), f.w, f.h / 3)))
  return next
}
