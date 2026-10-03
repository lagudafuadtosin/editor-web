// Light and colour fixes for a clip. Every value runs from -100 to 100, 0 means untouched.
export type Look = {
  exposure: number
  brightness: number
  contrast: number
  shadows: number
  highlights: number
  warmth: number
  saturation: number
}

export const LOOK_CONTROLS: { key: keyof Look; label: string }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'saturation', label: 'Saturation' },
]

export const NEUTRAL: Look = { exposure: 0, brightness: 0, contrast: 0, shadows: 0, highlights: 0, warmth: 0, saturation: 0 }

export const isNeutral = (l?: Look) => !l || LOOK_CONTROLS.every(({ key }) => l[key] === 0)

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
in vec2 uv;
out vec4 color;
uniform sampler2D img;
uniform float exposure, brightness, contrast, shadows, highlights, warmth, saturation;
void main() {
  vec3 c = texture(img, uv).rgb;
  // White balance first, as a gain on red and blue, like a camera does. It scales with the light,
  // so brightening afterwards does not bring the colour cast back.
  c.r *= 1.0 + warmth * 0.3;
  c.b *= 1.0 - warmth * 0.3;
  c *= pow(2.0, exposure * 2.0);                       // up to 2 stops either way
  c += brightness * 0.3;
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Lifts or deepens the dark parts only. True black (bars, a black frame) stays black.
  c += shadows * 0.45 * pow(1.0 - clamp(l, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.05, l);
  c += highlights * 0.45 * pow(clamp(l, 0.0, 1.0), 2.0);       // brightens or pulls back the bright parts only
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(g), c, 1.0 + saturation);
  color = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

type Img = HTMLCanvasElement | OffscreenCanvas | ImageBitmap

// Runs a frame through the light fixes on the graphics card.
export class LookRenderer {
  readonly canvas = new OffscreenCanvas(2, 2)
  private gl: WebGL2RenderingContext
  private uniforms: Record<string, WebGLUniformLocation | null> = {}

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
    gl.useProgram(program)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    for (const { key } of LOOK_CONTROLS) this.uniforms[key] = gl.getUniformLocation(program, key)
  }

  render(img: Img, look: Look): OffscreenCanvas {
    const gl = this.gl
    if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
      this.canvas.width = img.width
      this.canvas.height = img.height
    }
    gl.viewport(0, 0, img.width, img.height)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    for (const { key } of LOOK_CONTROLS) gl.uniform1f(this.uniforms[key], look[key] / 100)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }
}

// Applies the look if there is one, otherwise hands the frame back untouched.
export function withLook(renderer: LookRenderer | null, img: Img, look?: Look): Img {
  return renderer && !isNeutral(look) ? renderer.render(img, look!) : img
}

type Pixels = { l: number[]; r: number[]; b: number[] }

function sample(img: Img): { l: Float32Array; r: Float32Array; b: Float32Array } {
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

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]

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
  // Moves one setting until a measured value reaches its target (the measure goes up as the setting goes up).
  const solve = (look: Look, key: keyof Look, lo: number, hi: number, target: number, read: (m: ReturnType<typeof measure>) => number) => {
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
