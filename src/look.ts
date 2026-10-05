import type { Fx, Key, LutFile } from './model'

// Light and colour fixes for a clip. Every value runs from -100 to 100, 0 means untouched.
// The last five are the "More" controls; older saved edits do not have them, so they are optional.
export type Look = {
  exposure: number
  brightness: number
  contrast: number
  shadows: number
  highlights: number
  warmth: number
  saturation: number
  whites?: number
  blacks?: number
  tint?: number
  vibrance?: number
  hsl?: number[] // 8 colour bands (red, orange, yellow, green, aqua, blue, purple, magenta) x hue, saturation, lightness
  // Colour wheels: shadows (lift), midtones (gamma), highlights (gain). h = hue in degrees, a = 0 to 100, l = -100 to 100.
  lift?: Wheel
  gamma?: Wheel
  gain?: Wheel
  // Curves: points (0 to 1 in, 0 to 1 out) for all channels together, then red, green and blue.
  curves?: Curves
}
export type Wheel = { h: number; a: number; l: number }
export type Curves = { all: [number, number][]; r: [number, number][]; g: [number, number][]; b: [number, number][] }
export const FLAT: [number, number][] = [[0, 0], [1, 1]]
const wheelOn = (w?: Wheel) => !!w && (w.a !== 0 || w.l !== 0)
const curveOn = (c?: [number, number][]) => !!c && (c.length !== 2 || c[0][0] !== 0 || c[0][1] !== 0 || c[1][0] !== 1 || c[1][1] !== 1)
export const curvesOn = (c?: Curves) => !!c && (curveOn(c.all) || curveOn(c.r) || curveOn(c.g) || curveOn(c.b))

// A wheel's pull as a colour: the hue's direction away from grey, so the three channels still balance.
function wheelRgb(w?: Wheel): [number, number, number] {
  if (!w) return [0, 0, 0]
  const h = (((w.h % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  const m = (r + g + b) / 3
  const k = w.a / 100
  const l = w.l / 100
  return [(r - m) * k + l, (g - m) * k + l, (b - m) * k + l]
}

// A smooth curve through the points that never doubles back (monotone cubic), as 256 steps.
export function curveTable(points: [number, number][]): Float32Array {
  const p = points.slice().sort((a, b) => a[0] - b[0])
  const out = new Float32Array(256)
  const n = p.length
  const d = new Array(n).fill(0)
  const s: number[] = []
  for (let i = 0; i < n - 1; i++) s.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]))
  d[0] = s[0] ?? 0
  d[n - 1] = s[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) d[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2
  for (let k = 0; k < 256; k++) {
    const x = k / 255
    if (x <= p[0][0]) { out[k] = p[0][1]; continue }
    if (x >= p[n - 1][0]) { out[k] = p[n - 1][1]; continue }
    let i = 0
    while (i < n - 2 && x > p[i + 1][0]) i++
    const hgt = p[i + 1][0] - p[i][0]
    const t = (x - p[i][0]) / hgt
    const t2 = t * t
    const t3 = t2 * t
    out[k] = Math.max(0, Math.min(1, (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * hgt * d[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * hgt * d[i + 1]))
  }
  return out
}

export const LOOK_CONTROLS: { key: 'exposure' | 'brightness' | 'contrast' | 'shadows' | 'highlights' | 'warmth' | 'saturation'; label: string }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'saturation', label: 'Saturation' },
]
export const MORE_CONTROLS: { key: 'whites' | 'blacks' | 'tint' | 'vibrance'; label: string }[] = [
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'tint', label: 'Tint (green to pink)' },
  { key: 'vibrance', label: 'Vibrance' },
]
export const HSL_BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']

export const NEUTRAL: Look = { exposure: 0, brightness: 0, contrast: 0, shadows: 0, highlights: 0, warmth: 0, saturation: 0 }

export const isNeutral = (l?: Look) =>
  !l || (LOOK_CONTROLS.every(({ key }) => !l[key]) && MORE_CONTROLS.every(({ key }) => !l[key]) && !(l.hsl ?? []).some((v) => v) &&
    !wheelOn(l.lift) && !wheelOn(l.gamma) && !wheelOn(l.gain) && !curvesOn(l.curves))

// ---- Our own colour looks, made as 3D tables from simple colour maths (no outside files, nothing to license) ----

type RGB = [number, number, number]
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const sat = (c: RGB, s: number): RGB => mixc([lum(c), lum(c), lum(c)], c, s)
const curve = (c: RGB, k: number): RGB => c.map((v) => v + k * (v - 0.5) * (1 - Math.abs(2 * v - 1))) as RGB // gentle S
const lift = (c: RGB, black: number, white = 1): RGB => c.map((v) => black + v * (white - black)) as RGB

export const LOOKS: { id: string; name: string; fn: (c: RGB) => RGB }[] = [
  { id: 'look:warm', name: 'Warm film', fn: (c) => curve(lift([c[0] * 1.06 + 0.02, c[1] * 1.0, c[2] * 0.88], 0.03), 0.4) },
  { id: 'look:cool', name: 'Cool', fn: (c) => [c[0] * 0.92, c[1] * 1.0, c[2] * 1.08 + 0.02] },
  { id: 'look:teal', name: 'Teal and orange', fn: (c) => {
    const l = lum(c)
    const toned = mixc(c, l > 0.5 ? [Math.min(1, l * 1.25), l * 0.98, l * 0.72] : [l * 0.7, l * 1.02, l * 1.12], 0.45)
    return curve(sat(toned, 1.1), 0.6)
  } },
  { id: 'look:bw', name: 'Black and white', fn: (c) => { const l = lum(curve(c, 0.6)); return [l, l, l] } },
  { id: 'look:faded', name: 'Faded', fn: (c) => sat(lift(c, 0.1, 0.93), 0.8) },
  { id: 'look:vivid', name: 'Vivid', fn: (c) => curve(sat(c, 1.35), 0.5) },
  { id: 'look:moody', name: 'Moody', fn: (c) => curve(sat(lift(c, 0.02, 0.92), 0.75).map((v, i) => v * [0.95, 0.98, 1.04][i]) as RGB, 0.8) },
  { id: 'look:vintage', name: 'Vintage', fn: (c) => lift(sat([c[0] * 1.05 + 0.03, c[1] * 0.98 + 0.02, c[2] * 0.85], 0.7), 0.06, 0.95) },
]

const presetCache = new Map<string, LutFile>()
export function presetLut(id: string): LutFile | null {
  const cached = presetCache.get(id)
  if (cached) return cached
  const look = LOOKS.find((l) => l.id === id)
  if (!look) return null
  const size = 17
  const data: number[] = []
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = look.fn([r / (size - 1), g / (size - 1), b / (size - 1)])
        data.push(...o.map((v) => Math.max(0, Math.min(1, v))))
      }
  const lut = { name: look.name, size, data }
  presetCache.set(id, lut)
  return lut
}

// Reads a .cube file (the common colour-look format). Only 3D tables; sizes up to 65.
export function parseCube(text: string, name: string): LutFile {
  let size = 0
  const data: number[] = []
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const head = parts[0].toUpperCase()
    if (head === 'LUT_3D_SIZE') size = Number(parts[1])
    else if (head === 'LUT_1D_SIZE') throw new Error('this is a 1D look, and only 3D .cube looks are supported')
    else if (head === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number)
    else if (head === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number)
    else if (/^[-+0-9.eE]/.test(parts[0]) && parts.length >= 3) {
      for (let i = 0; i < 3; i++) data.push((Number(parts[i]) - min[i]) / ((max[i] - min[i]) || 1))
    }
  }
  if (!size || size < 2 || size > 65) throw new Error('the file has no usable LUT_3D_SIZE')
  if (data.length !== size * size * size * 3) throw new Error(`expected ${size ** 3} colours, found ${data.length / 3}`)
  if (data.some((v) => !Number.isFinite(v))) throw new Error('the file has numbers that cannot be read')
  return checkLut({ name: name.replace(/\.cube$/i, ''), size, data })
}

// The same checks for a look that arrives inside a project file, which may have been made by hand to hang the
// editor: a whole-number size from 2 to 65, exactly the right count of real numbers, each kept between 0 and 1.
export function checkLut(lut: unknown): LutFile {
  const l = lut as Partial<LutFile> | null
  const size = l?.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > 65) throw new Error('the look has no usable size')
  if (!Array.isArray(l?.data) || l.data.length !== size * size * size * 3) throw new Error(`expected ${size ** 3} colours`)
  if (l.data.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('the look has numbers that cannot be read')
  const name = typeof l.name === 'string' ? l.name.slice(0, 120) : 'Colour look'
  return { name, size, data: l.data.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000) }
}

// Everything the graphics card applies to one frame of one clip.
export type RenderParams = {
  look?: Look
  lut?: { file: LutFile; key: string; strength: number }
  fx?: Fx
  key?: Key
  time: number // seconds into the clip, for grain and VHS movement
}

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`

// The same maths runs for the preview and the export, so what you see is what you get.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D img;
uniform sampler3D lut;
uniform vec2 texel;
uniform float exposure, brightness, contrast, shadows, highlights, warmth, saturation;
uniform float whites, blacks, tint, vibrance;
uniform float hsl[24];
uniform float lutAmount, lutSize;
uniform float sharpen, vignette, grain, vhs, mosaic, time;
uniform float keyOn, keyLuma, keyStrength, keySoft, keySpill;
uniform vec3 keyColor;
uniform float lumaAlpha;
uniform vec3 liftC, gammaC, gainC;
uniform sampler2D curveTex;
uniform float curvesOn;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec4 sampleAt(vec2 p) {
  if (mosaic > 0.0) {
    vec2 cells = vec2(mix(160.0, 8.0, mosaic)) * vec2(1.0, texel.x / texel.y);
    p = (floor(p * cells) + 0.5) / cells;
  }
  if (vhs > 0.0) {
    float row = floor(p.y * 240.0);
    p.x += (hash(vec2(row, floor(time * 24.0))) - 0.5) * 0.006 * vhs;
    vec2 off = vec2(0.004 * vhs, 0.0);
    vec4 m = texture(img, p);
    return vec4(texture(img, p + off).r, m.g, texture(img, p - off).b, m.a);
  }
  return texture(img, p);
}

void main() {
  vec4 src = sampleAt(uv);
  vec3 c = src.rgb;
  float alpha = src.a;

  // Green screen: judged on the colour as filmed, before any grading.
  if (keyOn > 0.5) {
    float d;
    if (keyLuma > 0.5) d = dot(c, vec3(0.2126, 0.7152, 0.0722));
    else {
      vec3 a = rgb2hsv(c), b = rgb2hsv(keyColor);
      float dh = min(abs(a.x - b.x), 1.0 - abs(a.x - b.x));
      d = dh * 2.0 + (1.0 - a.y) * 0.6 + abs(a.z - b.z) * 0.25;
    }
    float edge = keyStrength * 0.6;
    alpha *= smoothstep(edge, edge + keySoft * 0.4 + 0.001, d);
    if (keyLuma < 0.5 && keySpill > 0.0) {
      // Takes the screen's colour off the edges of hair and clothes.
      vec3 k = normalize(keyColor + 1e-4);
      float spill = max(0.0, dot(c, k) - max(max(c.r * (1.0 - k.r), c.g * (1.0 - k.g)), c.b * (1.0 - k.b)));
      c -= k * spill * keySpill;
    }
  }

  if (sharpen > 0.0) {
    vec3 n = texture(img, uv + vec2(texel.x, 0.0)).rgb + texture(img, uv - vec2(texel.x, 0.0)).rgb
           + texture(img, uv + vec2(0.0, texel.y)).rgb + texture(img, uv - vec2(0.0, texel.y)).rgb;
    c += (c - n * 0.25) * sharpen * 2.5;
  }

  // White balance first, as a gain on red and blue, like a camera does.
  c.r *= 1.0 + warmth * 0.3;
  c.b *= 1.0 - warmth * 0.3;
  c.g *= 1.0 - tint * 0.15;
  c *= pow(2.0, exposure * 2.0);
  c += brightness * 0.3;
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Lifts or deepens the dark parts only. True black (bars, a black frame) stays black.
  c += shadows * 0.45 * pow(1.0 - clamp(l, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.05, l);
  c += highlights * 0.45 * pow(clamp(l, 0.0, 1.0), 2.0);
  // Whites and blacks move the two ends of the range.
  c = c * (1.0 + whites * 0.25) + blacks * 0.12 * (1.0 - c);
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(g), c, 1.0 + saturation);
  if (vibrance != 0.0) {
    // Saturation that spares what is already colourful (and skin).
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    c = mix(vec3(g), c, 1.0 + vibrance * (1.0 - clamp((mx - mn) * 1.5, 0.0, 1.0)));
  }
  // Per colour band: shift hue, saturation and lightness of one range of colours.
  vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
  float dhue = 0.0, dsat = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float centre = float(i) / 8.0;
    float dist = min(abs(h.x - centre), 1.0 - abs(h.x - centre));
    float w = max(0.0, 1.0 - dist * 8.0) * h.y;
    dhue += hsl[i * 3] * w; dsat += hsl[i * 3 + 1] * w; dl += hsl[i * 3 + 2] * w;
  }
  if (dhue != 0.0 || dsat != 0.0 || dl != 0.0) {
    h.x = fract(h.x + dhue * 0.08);
    h.y = clamp(h.y * (1.0 + dsat), 0.0, 1.0);
    h.z = clamp(h.z * (1.0 + dl * 0.5), 0.0, 1.0);
    c = hsv2rgb(h);
  }
  c = clamp(c, 0.0, 1.0);

  // Colour wheels: highlights scale, shadows lift, midtones bend.
  c = c * (1.0 + gainC * 0.5);
  c = c + liftC * 0.25 * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / max(vec3(0.2), 1.0 + gammaC * 0.6));
  c = clamp(c, 0.0, 1.0);
  // Curves: all channels first (alpha row), then each channel's own.
  if (curvesOn > 0.5) {
    vec3 m = vec3(texture(curveTex, vec2(c.r, 0.5)).a, texture(curveTex, vec2(c.g, 0.5)).a, texture(curveTex, vec2(c.b, 0.5)).a);
    c = vec3(texture(curveTex, vec2(m.r, 0.5)).r, texture(curveTex, vec2(m.g, 0.5)).g, texture(curveTex, vec2(m.b, 0.5)).b);
  }

  if (lutAmount > 0.0) {
    vec3 p = c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
    c = mix(c, texture(lut, p).rgb, lutAmount);
  }
  if (vignette > 0.0) {
    vec2 d = (uv - 0.5) * vec2(1.0, texel.x / texel.y);
    c *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d) * 1.2);
  }
  if (vhs > 0.0) {
    c *= 1.0 - vhs * 0.18 * step(0.5, fract(uv.y / texel.y * 0.5));
    c = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))), vhs * 0.25);
  }
  if (grain > 0.0) c += (hash(uv * 911.0 + time) - 0.5) * grain * 0.22;
  color = vec4(clamp(c, 0.0, 1.0), alpha);
  // For a luma matte: white where the picture is bright, see-through where it is dark.
  if (lumaAlpha > 0.5) color = vec4(1.0, 1.0, 1.0, dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)) * src.a);
}`

type Img = HTMLCanvasElement | OffscreenCanvas | ImageBitmap

// Runs a frame through the light fixes, look and effects on the graphics card.
export class LookRenderer {
  readonly canvas = new OffscreenCanvas(2, 2)
  private gl: WebGL2RenderingContext
  private u: Record<string, WebGLUniformLocation | null> = {}
  private imgTex: WebGLTexture
  private lutTex: WebGLTexture
  private lutKey = ''
  private curveTex: WebGLTexture
  private curveKey = ''

  constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const program = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      gl.attachShader(program, s)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error')
    gl.useProgram(program)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    this.imgTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.lutTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, new Float32Array(24))
    this.curveTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(1024))
    gl.activeTexture(gl.TEXTURE0)

    for (const n of ['img', 'lut', 'texel', 'exposure', 'brightness', 'contrast', 'shadows', 'highlights', 'warmth', 'saturation', 'whites', 'blacks', 'tint',
      'vibrance', 'hsl', 'lutAmount', 'lutSize', 'sharpen', 'vignette', 'grain', 'vhs', 'mosaic', 'time', 'keyOn', 'keyLuma', 'keyStrength', 'keySoft',
      'keySpill', 'keyColor', 'lumaAlpha', 'liftC', 'gammaC', 'gainC', 'curveTex', 'curvesOn']) this.u[n] = gl.getUniformLocation(program, n)
    gl.uniform1i(this.u.img, 0)
    gl.uniform1i(this.u.lut, 1)
    gl.uniform1i(this.u.curveTex, 2)
  }

  render(img: Img, look: Look, extra?: Omit<RenderParams, 'look'> & { lumaAlpha?: boolean }): OffscreenCanvas {
    const gl = this.gl
    if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
      this.canvas.width = img.width
      this.canvas.height = img.height
    }
    gl.viewport(0, 0, img.width, img.height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    const f = (n: string, v: number) => gl.uniform1f(this.u[n], v)
    gl.uniform2f(this.u.texel, 1 / img.width, 1 / img.height)
    for (const { key } of LOOK_CONTROLS) f(key, look[key] / 100)
    for (const { key } of MORE_CONTROLS) f(key, (look[key] ?? 0) / 100)
    const hsl = new Float32Array(24)
    ;(look.hsl ?? []).forEach((v, i) => { if (i < 24) hsl[i] = v / 100 })
    gl.uniform1fv(this.u.hsl, hsl)
    gl.uniform3fv(this.u.liftC, wheelRgb(look.lift))
    gl.uniform3fv(this.u.gammaC, wheelRgb(look.gamma))
    gl.uniform3fv(this.u.gainC, wheelRgb(look.gain))
    if (curvesOn(look.curves)) {
      const key = JSON.stringify(look.curves)
      if (key !== this.curveKey) {
        const cv = look.curves!
        const [all, r, g, b] = [curveTable(cv.all), curveTable(cv.r), curveTable(cv.g), curveTable(cv.b)]
        const data = new Float32Array(1024)
        for (let i = 0; i < 256; i++) data.set([r[i], g[i], b[i], all[i]], i * 4)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, data)
        gl.activeTexture(gl.TEXTURE0)
        this.curveKey = key
      }
      f('curvesOn', 1)
    } else f('curvesOn', 0)

    const lut = extra?.lut
    if (lut && lut.strength > 0) {
      if (this.lutKey !== lut.key) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.file.size, lut.file.size, lut.file.size, 0, gl.RGB, gl.FLOAT, new Float32Array(lut.file.data))
        gl.activeTexture(gl.TEXTURE0)
        this.lutKey = lut.key
      }
      f('lutAmount', lut.strength / 100)
      f('lutSize', lut.file.size)
    } else f('lutAmount', 0)

    const fx = extra?.fx
    f('sharpen', (fx?.sharpen ?? 0) / 100)
    f('vignette', (fx?.vignette ?? 0) / 100)
    f('grain', (fx?.grain ?? 0) / 100)
    f('vhs', (fx?.vhs ?? 0) / 100)
    f('mosaic', (fx?.mosaic ?? 0) / 100)
    f('time', extra?.time ?? 0)

    f('lumaAlpha', extra?.lumaAlpha ? 1 : 0)
    const key = extra?.key
    f('keyOn', key ? 1 : 0)
    if (key) {
      f('keyLuma', key.mode === 'luma' ? 1 : 0)
      f('keyStrength', key.strength / 100)
      f('keySoft', key.softness / 100)
      f('keySpill', key.spill / 100)
      const hex = key.color.replace('#', '')
      gl.uniform3f(this.u.keyColor, parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }
}

// Whether a clip needs the graphics card at all: anything besides plain light changes untouched.
export function needsRender(p: RenderParams): boolean {
  const fx = p.fx
  return !isNeutral(p.look) || !!(p.lut && p.lut.strength > 0) || !!p.key ||
    !!(fx && (fx.sharpen || fx.vignette || fx.grain || fx.vhs || fx.mosaic))
}

// Applies the look and effects if there are any, otherwise hands the frame back untouched.
export function withLook(renderer: LookRenderer | null, img: Img, look?: Look, extra?: Omit<RenderParams, 'look'>): Img {
  const p: RenderParams = { look, time: 0, ...extra }
  return renderer && needsRender(p) ? renderer.render(img, look ?? NEUTRAL, extra) : img
}

type Pixels = { l: number[]; r: number[]; b: number[] }

export function sample(img: Img): { l: Float32Array; r: Float32Array; b: Float32Array } {
  const small = new OffscreenCanvas(96, Math.max(1, Math.round((96 * img.height) / img.width)))
  const ctx = small.getContext('2d')!
  ctx.drawImage(img, 0, 0, small.width, small.height)
  const d = ctx.getImageData(0, 0, small.width, small.height).data
  const n = d.length / 4
  const l = new Float32Array(n), r = new Float32Array(n), b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    r[i] = d[i * 4] / 255
    b[i] = d[i * 4 + 2] / 255
    l[i] = 0.2126 * r[i] + 0.7152 * (d[i * 4 + 1] / 255) + 0.0722 * b[i]
  }
  return { l, r, b }
}

export const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]

// Reads several frames of a clip and works out a look that makes it normally lit and neutral in colour.
// Black bars and pure black areas are left out, so letterboxed clips are judged on the real picture.
export function autoLook(frames: Img[], renderer: LookRenderer): Look {
  const masks = frames.map((f) => {
    const raw = sample(f).l
    const keep: number[] = []
    raw.forEach((v, i) => { if (v > 0.03) keep.push(i) })
    return keep.length > raw.length * 0.1 ? keep : Array.from(raw.keys())
  })
  const measure = (look: Look): Pixels & { sorted: number[] } => {
    const px: Pixels = { l: [], r: [], b: [] }
    frames.forEach((f, k) => {
      const s = sample(renderer.render(f, look))
      for (const i of masks[k]) {
        px.l.push(s.l[i])
        px.r.push(s.r[i])
        px.b.push(s.b[i])
      }
    })
    return { ...px, sorted: px.l.slice().sort((a, b) => a - b) }
  }
  type Key7 = (typeof LOOK_CONTROLS)[number]['key']
  // Moves one setting until a measured value reaches its target (the measure goes up as the setting goes up).
  const solve = (look: Look, key: Key7, lo: number, hi: number, target: number, read: (m: ReturnType<typeof measure>) => number) => {
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2
      if (read(measure({ ...look, [key]: mid })) < target) lo = mid
      else hi = mid
    }
    return Math.round((lo + hi) / 2)
  }

  const look: Look = { ...NEUTRAL }
  let m = measure(look)

  // 1. White balance: take out a colour cast (orange bulb, blue daylight). Measured relative to brightness,
  // and brought to a slightly warm neutral rather than cold grey, so skin keeps its warmth.
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)
  const relCast = (x: ReturnType<typeof measure>) => (avg(x.r) - avg(x.b)) / Math.max(0.05, avg(x.l))
  const SLIGHTLY_WARM = 0.08
  const cast = relCast(m)
  if (Math.abs(cast) > SLIGHTLY_WARM + 0.04) {
    look.warmth = solve(look, 'warmth', -100, 100, Math.sign(cast) * SLIGHTLY_WARM, relCast)
    m = measure(look)
  }

  // 2. Exposure: put the middle tones at a normal level.
  const median = pct(m.sorted, 0.5)
  if (median < 0.36 || median > 0.56) look.exposure = solve(look, 'exposure', -70, 80, 0.45, (x) => pct(x.sorted, 0.5))
  m = measure(look)

  // 3. Highlights: pull back what is blowing out to white.
  if (pct(m.sorted, 0.98) > 0.96) look.highlights = solve(look, 'highlights', -60, 0, 0.94, (x) => pct(x.sorted, 0.98))
  m = measure(look)

  // 4. Shadows: lift crushed dark areas a little (true black stays black in the shader).
  if (pct(m.sorted, 0.05) < 0.06) look.shadows = solve(look, 'shadows', 0, 50, 0.08, (x) => pct(x.sorted, 0.05))
  m = measure(look)

  // 5. Contrast: add punch to a flat, grey picture. Never reduce it.
  const spread = pct(m.sorted, 0.95) - pct(m.sorted, 0.05)
  if (spread < 0.55) look.contrast = solve(look, 'contrast', 0, 40, 0.6, (x) => pct(x.sorted, 0.95) - pct(x.sorted, 0.05))
  m = measure(look)

  return look
}
