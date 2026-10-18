import { DEFAULT_TEXT } from './text'
import { emptyProject, FRAMES, newId, reserveIdsIn, type Clip, type Frame, type Project } from './model'

// Ways to start a new project: ours (a frame shape, sometimes a title ready to type over), and the person's own,
// saved from a project they made. A saved template keeps the text, blocks, adjustment layers and layers,
// never the videos, pictures or sound (those are the next video's own).

export type Template = { id: string; name: string; project?: Project }

const frameOf = (id: string): Frame => FRAMES.find((f) => f.id === id)!.frame
const box = (frame: Frame, y: number, w = 0.86) => ({
  x: frame.w / 2, y: frame.h * y, w: frame.w * w, h: 0, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true,
  crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0,
})

function withText(frame: Frame, clips: Omit<Clip, 'id'>[]): Project {
  const p = { ...emptyProject(), frame }
  return { ...p, video: [...p.video, { id: newId('v'), kind: 'video' as const, clips: clips.map((c) => ({ ...c, id: newId('c') })) }] }
}

// Ours start in any frame shape, picked beside them in New project.
export const BUILT_IN: Template[] = [
  { id: 'blank', name: 'Blank' },
  { id: 'hook', name: 'Talking to camera, with a hook title' },
  { id: 'endcard', name: 'With an end card' },
]

export function fromBuiltIn(id: string, frame: Frame = frameOf('9:16')): Project {
  const tall = frame.h > frame.w
  if (id === 'hook') {
    return withText(frame, [{
      kind: 'text', start: 0, in: 0, out: 3, transform: box(frame, tall ? 0.2 : 0.16, tall ? 0.86 : 0.7),
      text: { ...DEFAULT_TEXT, text: 'Your hook here', size: 96, background: true, backgroundColor: '#000000', backgroundOpacity: 0.7, outlineWidth: 0 },
      anim: { in: 'pop', out: 'fade', duration: 0.3 },
    }])
  }
  if (id === 'endcard' || id === 'youtube') {
    return withText(frame, [{
      kind: 'text', start: 0, in: 0, out: 5, transform: box(frame, 0.5, tall ? 0.86 : 0.6),
      text: { ...DEFAULT_TEXT, text: 'Thanks for watching\nSubscribe for more', size: 84 },
      anim: { in: 'fade', out: 'fade', duration: 0.5 },
    }])
  }
  return { ...emptyProject(), frame }
}

// A saved template keeps its own frame shape.
export const templateFrame = (id: string): Frame | undefined => loadTemplates().find((t) => t.id === id)?.project?.frame

const KEY = 'editor.templates'

export function loadTemplates(): Template[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === 'string' && t.project) : []
  } catch {
    return []
  }
}

export function saveTemplate(name: string, project: Project): void {
  const keep = (c: Clip) => c.kind === 'text' || c.kind === 'color' || c.kind === 'adjust' || c.kind === 'shape'
  const clean: Project = {
    frame: project.frame,
    video: project.video.map((t, i) => ({ ...t, clips: i === 0 ? [] : t.clips.filter(keep) })),
    audio: project.audio.map((t) => ({ ...t, clips: [] })),
    luts: project.luts,
  }
  const list = [...loadTemplates().filter((t) => t.name !== name), { id: `t${Date.now().toString(36)}`, name, project: clean }]
  localStorage.setItem(KEY, JSON.stringify(list.slice(-30)))
}

export function deleteTemplate(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadTemplates().filter((t) => t.id !== id)))
}

// The project a new one starts as. A saved template gets fresh ids, so two projects made from it never share any.
export function startFrom(id: string, frame?: Frame): Project {
  const own = loadTemplates().find((t) => t.id === id)
  if (!own?.project) return fromBuiltIn(id, frame)
  reserveIdsIn(own.project)
  const json = JSON.stringify(own.project).replace(/"(v|a|c|g|cap)(\d+)"/g, (_m, p: string) => `"${newId(p)}"`)
  return JSON.parse(json)
}
