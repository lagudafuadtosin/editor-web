import { clipLength, findPlaced, layout, newId, removeClip, tidy, type Clip, type Project, type Track } from './model'

// More than one timeline in a project. The one being edited is always project.video / project.audio; the others
// wait in project.sequences. A nested clip shows a whole other timeline as one clip: it plays a rendered copy of
// that timeline, made again whenever the timeline changes.

export type Seq = { id: string; name: string; video: Track[]; audio: Track[] }

export const MAIN_SEQ = 'main'
export const activeId = (p: Project) => p.seqId ?? MAIN_SEQ
export const activeName = (p: Project) => p.seqName ?? 'Main edit'

export function seqList(p: Project): { id: string; name: string; active: boolean }[] {
  const others = (p.sequences ?? []).filter((s) => s.id !== activeId(p))
  return [{ id: activeId(p), name: activeName(p), active: true }, ...others.map((s) => ({ id: s.id, name: s.name, active: false }))]
    .sort((a, b) => (a.id === MAIN_SEQ ? -1 : b.id === MAIN_SEQ ? 1 : 0))
}

export function seqById(p: Project, id: string): Seq | undefined {
  if (id === activeId(p)) return { id, name: activeName(p), video: p.video, audio: p.audio }
  return (p.sequences ?? []).find((s) => s.id === id)
}

// Puts the timeline being edited away and brings another one out.
export function switchSeq(p: Project, id: string): Project {
  if (id === activeId(p)) return p
  const target = (p.sequences ?? []).find((s) => s.id === id)
  if (!target) return p
  const current: Seq = { id: activeId(p), name: activeName(p), video: p.video, audio: p.audio }
  const rest = (p.sequences ?? []).filter((s) => s.id !== id)
  return { ...p, sequences: [...rest, current], seqId: target.id, seqName: target.name, video: target.video, audio: target.audio }
}

export function newSeq(p: Project, name: string, from?: Seq): Project {
  const id = newId('seq')
  const blank: Seq = { id, name, video: [{ id: newId('v'), kind: 'video', clips: [] }], audio: [{ id: newId('a'), kind: 'audio', clips: [] }] }
  const seq = from ? { ...copyTracks(from), id, name } : blank
  return switchSeq({ ...p, sequences: [...(p.sequences ?? []), seq] }, id)
}

// A copy with new ids throughout, so the two timelines never share a clip.
function copyTracks(s: Seq): Seq {
  const t = (tr: Track): Track => ({ ...tr, id: newId(tr.kind === 'video' ? 'v' : 'a'), clips: tr.clips.map((c) => ({ ...c, id: newId('c') })) })
  return { ...s, video: s.video.map(t), audio: s.audio.map(t) }
}

export function renameSeq(p: Project, id: string, name: string): Project {
  if (id === activeId(p)) return { ...p, seqName: name }
  return { ...p, sequences: (p.sequences ?? []).map((s) => (s.id === id ? { ...s, name } : s)) }
}

// Which timelines show a timeline as a nested clip (it cannot be deleted while one does).
export function usedBy(p: Project, id: string): string[] {
  const all: Seq[] = [{ id: activeId(p), name: activeName(p), video: p.video, audio: p.audio }, ...(p.sequences ?? []).filter((s) => s.id !== activeId(p))]
  return all.filter((s) => [...s.video, ...s.audio].some((t) => t.clips.some((c) => c.nest === id))).map((s) => s.name)
}

export function deleteSeq(p: Project, id: string): Project {
  if (id === activeId(p) || id === MAIN_SEQ || usedBy(p, id).length) return p
  return { ...p, sequences: (p.sequences ?? []).filter((s) => s.id !== id) }
}

// A cheap fingerprint of a timeline's contents, to tell whether its rendered copy is out of date.
export function seqHash(s: Seq): string {
  const text = JSON.stringify([s.video, s.audio])
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${text.length}:${h >>> 0}`
}

// The selected clips moved into a new timeline of their own (times kept relative to the earliest). The clips on the
// main track stay in order on its main track; the others keep their layers. Returns the new timeline, the project
// without those clips, and where the nested clip should go.
export function cutOutForNest(p: Project, ids: string[], name: string): { seq: Seq; rest: Project; at: { main: number | null; layer: number; start: number } } | null {
  const picked = ids.map((id) => findPlaced(p, id)).filter((x): x is NonNullable<typeof x> => !!x)
  if (!picked.length) return null
  const start = Math.min(...picked.map((x) => x.start))
  const mainPicked = picked.filter((x) => x.kind === 'video' && x.trackIndex === 0).sort((a, b) => a.start - b.start)
  const video: Track[] = [{ id: newId('v'), kind: 'video', clips: mainPicked.map((x) => ({ ...x.clip, id: newId('c') })) }]
  const audio: Track[] = []
  for (const x of picked) {
    if (x.kind === 'video' && x.trackIndex === 0) continue
    const list = x.kind === 'video' ? video : audio
    const idx = x.kind === 'video' ? x.trackIndex : x.trackIndex
    while (list.length <= idx) list.push({ id: newId(x.kind === 'video' ? 'v' : 'a'), kind: x.kind, clips: [] })
    list[idx].clips.push({ ...x.clip, id: newId('c'), start: x.start - start })
  }
  if (!audio.length) audio.push({ id: newId('a'), kind: 'audio', clips: [] })
  const seq: Seq = { id: newId('seq'), name, video, audio }
  // Where the nested clip goes: on the main track in the first picked main clip's place, or else on the lowest
  // layer that held a picked clip.
  const mainIndex = mainPicked.length ? layout(p).filter((x) => x.kind === 'video' && x.trackIndex === 0 && x.start < mainPicked[0].start - 1e-6).length : null
  const layer = Math.min(...picked.filter((x) => x.kind === 'video').map((x) => x.trackIndex), 99)
  let rest = p
  for (const x of picked) rest = removeClip(rest, x.clip.id)
  return { seq, rest: tidy(rest), at: { main: mainIndex, layer: layer === 99 ? 1 : Math.max(1, layer), start } }
}

export const nestLength = (s: Seq) => Math.max(0.1, ...[...s.video, ...s.audio].flatMap((t) => t.clips.map((c, i) => {
  // On the main track clips play one after another; elsewhere they sit where their start says.
  if (t === s.video[0]) return t.clips.slice(0, i + 1).reduce((n, x) => n + clipLength(x), 0)
  return c.start + clipLength(c)
})))

export type { Clip }
