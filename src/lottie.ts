// Lottie animations (the .json files from LottieFiles and After Effects): drawn frame by frame onto a canvas, so they
// sit on a layer like a picture that moves. The light player is used: it never runs code from the file (no
// expressions), which keeps the editor's no-eval security rule.
// @ts-expect-error the light canvas build has no types of its own
import lottie from 'lottie-web/build/player/esm/lottie_light_canvas.min.js'

type Item = { goToAndStop: (v: number, isFrame?: boolean) => void; destroy: () => void; totalFrames: number; frameRate: number }
type Loaded = { canvas: HTMLCanvasElement; anim: Item; w: number; h: number; fps: number; frames: number }

const store = new Map<string, Loaded>()

export function loadLottie(id: string, data: unknown): { w: number; h: number; seconds: number } {
  const d = data as { w?: number; h?: number; fr?: number; ip?: number; op?: number; layers?: unknown }
  if (!d || typeof d !== 'object' || !Array.isArray(d.layers) || !d.w || !d.h || !d.fr) throw new Error('this is not a Lottie animation')
  if (d.w > 4096 || d.h > 4096) throw new Error('the animation is larger than 4096 pixels')
  store.get(id)?.anim.destroy()
  const canvas = document.createElement('canvas')
  canvas.width = d.w
  canvas.height = d.h
  const anim = lottie.loadAnimation({
    renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)),
    rendererSettings: { context: canvas.getContext('2d'), clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
  }) as Item
  const frames = Math.max(1, (d.op ?? 1) - (d.ip ?? 0))
  store.set(id, { canvas, anim, w: d.w, h: d.h, fps: d.fr, frames })
  return { w: d.w, h: d.h, seconds: frames / d.fr }
}

// The animation's picture at a moment in the clip. It loops if the clip is longer than the animation.
export function lottieFrame(id: string, local: number): HTMLCanvasElement | null {
  const l = store.get(id)
  if (!l) return null
  const f = ((Math.max(0, local) * l.fps) % l.frames + l.frames) % l.frames
  l.anim.goToAndStop(f, true)
  return l.canvas
}

export const hasLottie = (id: string) => store.has(id)
