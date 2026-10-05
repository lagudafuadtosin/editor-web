import { CanvasSink } from 'mediabunny'
import type { OpenedMedia } from './media'

// Reading movement out of a clip, on this PC: where something drawn round goes (tracking), and how the camera
// shakes (stabilising). Both look at small grey copies of the frames.

const W = 240 // the small copies for tracking are this wide
const WS = 360 // stabilising measures on bigger copies, to a fraction of a pixel
const DETAIL = 4 // how much detail a patch needs in its weaker direction to be used

type Gray = { data: Float32Array; w: number; h: number; t: number }

async function* grayFrames(media: OpenedMedia, from: number, to: number, width = W): AsyncGenerator<Gray> {
  const v = media.videoTrack
  if (!v) throw new Error('this clip has no picture')
  const h = Math.max(2, Math.round((width * v.displayHeight) / v.displayWidth))
  const sink = new CanvasSink(v, { width, height: h, fit: 'fill' })
  for await (const f of sink.canvases(from, to)) {
    const ctx = (f.canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
    const px = ctx.getImageData(0, 0, width, h).data
    const data = new Float32Array(width * h)
    for (let i = 0; i < data.length; i++) data[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
    yield { data, w: width, h, t: f.timestamp }
  }
}

// How well a patch of the template matches the frame with its top-left corner at (x, y): sum of differences, lower is better.
function sad(frame: Gray, tpl: Float32Array, tw: number, th: number, x: number, y: number, best: number): number {
  let s = 0
  for (let j = 0; j < th; j++) {
    const row = (y + j) * frame.w + x
    const trow = j * tw
    for (let i = 0; i < tw; i++) s += Math.abs(frame.data[row + i] - tpl[trow + i])
    if (s >= best) return s // already worse than the best so far
  }
  return s
}

function cutPatch(frame: Gray, x: number, y: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = frame.data[(y + j) * frame.w + x + i]
  return out
}

// Search near (cx, cy) for the template; returns the best top-left corner.
function search(frame: Gray, tpl: Float32Array, tw: number, th: number, cx: number, cy: number, r: number): [number, number] {
  let best = Infinity
  let bx = cx
  let by = cy
  for (let y = Math.max(0, cy - r); y <= Math.min(frame.h - th, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(frame.w - tw, cx + r); x++) {
      const s = sad(frame, tpl, tw, th, x, y, best)
      if (s < best) {
        best = s
        bx = x
        by = y
      }
    }
  return [bx, by]
}

// Tracking: the box (fractions of the picture: centre x, y and size w, h) followed from `from` to `to`.
// Returns the box centre at every frame, as fractions of the picture, against the file's own times.
export async function trackBox(media: OpenedMedia, from: number, to: number, box: { x: number; y: number; w: number; h: number }, onProgress: (f: number) => void): Promise<[number, number, number][]> {
  const out: [number, number, number][] = []
  let tpl: Float32Array | null = null
  let tw = 0
  let th = 0
  let px = 0
  let py = 0
  for await (const g of grayFrames(media, from, to)) {
    if (!tpl) {
      tw = Math.max(6, Math.round(box.w * g.w))
      th = Math.max(6, Math.round(box.h * g.h))
      px = Math.round(box.x * g.w - tw / 2)
      py = Math.round(box.y * g.h - th / 2)
      px = Math.max(0, Math.min(g.w - tw, px))
      py = Math.max(0, Math.min(g.h - th, py))
      tpl = cutPatch(g, px, py, tw, th)
    } else {
      const [nx, ny] = search(g, tpl, tw, th, px, py, Math.round(Math.max(12, tw * 0.4)))
      px = nx
      py = ny
      // The look of the thing changes slowly (it turns, the light moves): the template follows a little each frame.
      const fresh = cutPatch(g, px, py, tw, th)
      for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * 0.85 + fresh[i] * 0.15
    }
    out.push([g.t, (px + tw / 2) / g.w, (py + th / 2) / g.h])
    onProgress((g.t - from) / Math.max(0.01, to - from))
  }
  onProgress(1)
  return out
}

// Where the template fits best near (cx, cy), to a fraction of a pixel: the whole-pixel best, then a curve
// through the fit either side of it in each direction.
function searchFine(frame: Gray, tpl: Float32Array, tw: number, th: number, cx: number, cy: number, r: number): [number, number] {
  const [bx, by] = search(frame, tpl, tw, th, cx, cy, r)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x > frame.w - tw || y > frame.h - th ? Infinity : sad(frame, tpl, tw, th, x, y, Infinity))
  const s0 = at(bx, by)
  const fit = (a: number, b: number) => {
    const d = a - 2 * s0 + b
    return Number.isFinite(d) && d > 0 ? Math.max(-0.5, Math.min(0.5, (a - b) / (2 * d))) : 0
  }
  return [bx + fit(at(bx - 1, by), at(bx + 1, by)), by + fit(at(bx, by - 1), at(bx, by + 1))]
}

// The shift (tx, ty) and turn (a, radians) that best carry the patch centres p onto where they were found q:
// q - p = (tx - a * py, ty + a * px), solved by least squares over the patches.
function fitMotion(m: { px: number; py: number; dx: number; dy: number }[]): { tx: number; ty: number; a: number } {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sdx = 0, sdy = 0, sxdy = 0, sydx = 0
  for (const q of m) {
    n++; sx += q.px; sy += q.py; sxx += q.px * q.px; syy += q.py * q.py
    sdx += q.dx; sdy += q.dy; sxdy += q.px * q.dy; sydx += q.py * q.dx
  }
  if (!n) return { tx: 0, ty: 0, a: 0 }
  // Normal equations for (tx, ty, a): [n 0 -sy; 0 n sx; -sy sx sxx+syy] = [sdx; sdy; sxdy - sydx]
  const A = [[n, 0, -sy], [0, n, sx], [-sy, sx, sxx + syy]]
  const B = [sdx, sdy, sxdy - sydx]
  const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  const D = det(A)
  if (Math.abs(D) < 1e-9) return { tx: sdx / n, ty: sdy / n, a: 0 }
  const col = (k: number) => A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)))
  return { tx: det(col(0)) / D, ty: det(col(1)) / D, a: det(col(2)) / D }
}

// Whether a patch can show movement both ways: a flat patch fits anywhere, and a patch on a single straight
// edge slides along it unseen. Both are left out (the smaller strength of the patch's two directions of detail).
function hasDetail(f: Gray, x0: number, y0: number, b: number): boolean {
  let a = 0, c = 0, d = 0
  for (let y = y0 + 1; y < y0 + b - 1; y++)
    for (let x = x0 + 1; x < x0 + b - 1; x++) {
      const i = y * f.w + x
      const gx = (f.data[i + 1] - f.data[i - 1]) / 2
      const gy = (f.data[i + f.w] - f.data[i - f.w]) / 2
      a += gx * gx
      c += gy * gy
      d += gx * gy
    }
  const n = (b - 2) * (b - 2)
  const weak = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + d * d)
  return weak / n > DETAIL
}

// Stabilising: the camera's movement, measured on a grid of patches (to a fraction of a pixel, patches with too
// little detail left out, patches that move differently from the rest left out). Each frame is measured against a
// reference frame that moves on every few frames, so small errors do not pile up frame after frame. The path is
// smoothed and the difference kept as the correction.
// Returns [file time, x shift, y shift (fractions of the picture), turn (radians)] per frame.
// How well the camera could be read: frames measured, and how many of them had patches spread wide enough
// across the picture to trust (a person in front of a plain wall gives few).
export type ShakeReport = { frames: number; wide: number }

export async function analyseShake(media: OpenedMedia, from: number, to: number, strength: number, onProgress: (f: number) => void, zoom = 1.08, report?: ShakeReport): Promise<[number, number, number, number][]> {
  const raw: { t: number; x: number; y: number; a: number }[] = []
  const B = 28 // patch size
  const EVERY = 8 // frames before the reference moves on
  let ref: Gray | null = null
  let refPose = { x: 0, y: 0, a: 0 } // where the reference frame itself sits on the path (pixels, radians)
  let refPatches: { x0: number; y0: number; tpl: Float32Array }[] = []
  let pose = { x: 0, y: 0, a: 0 }
  let since = 0
  const takeRef = (g: Gray) => {
    ref = g
    refPose = { ...pose }
    refPatches = []
    for (let gy = 1; gy <= 7; gy++)
      for (let gx = 1; gx <= 5; gx++) {
        const x0 = Math.round((gx / 6) * g.w - B / 2)
        const y0 = Math.round((gy / 8) * g.h - B / 2)
        if (x0 < 1 || y0 < 1 || x0 + B > g.w - 1 || y0 + B > g.h - 1 || !hasDetail(g, x0, y0, B)) continue
        refPatches.push({ x0, y0, tpl: cutPatch(g, x0, y0, B, B) })
      }
    since = 0
  }
  let w = 0
  let h = 0
  for await (const g of grayFrames(media, from, to, WS)) {
    w = g.w
    h = g.h
    if (!ref) takeRef(g)
    else {
      // Where each reference patch went in this frame: searched near where the last pose says it should be.
      const moves: { px: number; py: number; dx: number; dy: number }[] = []
      const ex = pose.x - refPose.x
      const ey = pose.y - refPose.y
      for (const rp of refPatches) {
        const sx = Math.round(rp.x0 + ex)
        const sy = Math.round(rp.y0 + ey)
        const [nx, ny] = searchFine(g, rp.tpl, B, B, sx, sy, 14)
        moves.push({ px: rp.x0 + B / 2 - g.w / 2, py: rp.y0 + B / 2 - g.h / 2, dx: nx - rp.x0, dy: ny - rp.y0 })
      }
      // Fit, leave out the patches that disagree by more than a pixel (a hand, someone walking past), fit again.
      let use = moves
      let m = fitMotion(use)
      for (let pass = 0; pass < 3 && use.length >= 4; pass++) {
        const keep = use.filter((q) => Math.hypot(q.dx - (m.tx - m.a * q.py), q.dy - (m.ty + m.a * q.px)) <= 1)
        if (keep.length < 4 || keep.length === use.length) break
        use = keep
        m = fitMotion(use)
      }
      // A turn can only be read from patches spread wide across the picture; from a few close together (all on a
      // person in front of a plain wall) it is guesswork, so then only the shift is used.
      const spread = Math.sqrt(use.reduce((t, q) => t + q.px * q.px + q.py * q.py, 0) / Math.max(1, use.length))
      if (report) {
        report.frames++
        if (use.length >= 8 && spread >= 0.28 * Math.min(g.w, g.h)) report.wide++
      }
      if (use.length < 8 || spread < 0.28 * Math.min(g.w, g.h)) {
        const tx = use.reduce((t, q) => t + q.dx, 0) / Math.max(1, use.length)
        const ty = use.reduce((t, q) => t + q.dy, 0) / Math.max(1, use.length)
        m = { tx, ty, a: 0 }
      }
      // A cut or a blur: too few patches agree, so this frame is taken as not moving and the reference starts again.
      if (use.length >= Math.max(4, moves.length * 0.4)) {
        pose = { x: refPose.x + m.tx, y: refPose.y + m.ty, a: refPose.a + Math.max(-0.035, Math.min(0.035, m.a)) }
        since++
        if (since >= EVERY) takeRef(g)
      } else takeRef(g)
    }
    raw.push({ t: g.t, x: pose.x / Math.max(1, w), y: pose.y / Math.max(1, h), a: pose.a })
    onProgress(((g.t - from) / Math.max(0.01, to - from)) * 0.95)
  }
  // Smooth the path: an average over a window that grows with the strength (up to about a second each side).
  const fps = raw.length / Math.max(0.01, to - from)
  const half = Math.max(1, Math.round((strength / 100) * fps))
  const out: [number, number, number, number][] = []
  // Never more than the zoom can hide: half the extra width either way, and a few degrees of turn.
  const room = Math.max(0.005, (zoom - 1) / 2)
  const c = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))
  for (let i = 0; i < raw.length; i++) {
    let sx = 0, sy = 0, sa = 0, n = 0
    for (let k = Math.max(0, i - half); k <= Math.min(raw.length - 1, i + half); k++) {
      sx += raw[k].x
      sy += raw[k].y
      sa += raw[k].a
      n++
    }
    out.push([raw[i].t, c(sx / n - raw[i].x, room), c(sy / n - raw[i].y, room), c(sa / n - raw[i].a, 0.05)])
  }
  onProgress(1)
  return out
}

// A value from a per-frame list at a file time, in between two frames worked out.
export function sampleAt<T extends number[]>(list: T[], t: number): T | null {
  if (!list.length) return null
  if (t <= list[0][0]) return list[0]
  const last = list[list.length - 1]
  if (t >= last[0]) return last
  let lo = 0
  let hi = list.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (list[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = list[lo]
  const b = list[hi]
  const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
  return a.map((v, i) => (i === 0 ? t : v + (b[i] - v) * u)) as T
}
