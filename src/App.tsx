import { useEffect, useRef, useState } from 'react'
import { openMedia } from './media'
import { Player } from './player'
import { Timeline } from './Timeline'
import { ExportDialog } from './ExportDialog'
import { exportProject, type ExportSettings } from './export'
import { LightPanel } from './LightPanel'
import { TransformPanel } from './TransformPanel'
import { TextPanel } from './TextPanel'
import { DEFAULT_TEXT, type TextStyle } from './text'
import { AnimationPanel, BorderPanel } from './EffectPanels'
import { SpeedPanel } from './SpeedPanel'
import { SoundPanel } from './SoundPanel'
import { Teleprompter } from './Teleprompter'
import { InfoMenus } from './InfoMenus'
import { imageFiles, loadImage, restoreImage } from './images'
import { clearAutosave, fileFromHandle, handleFor, keyOf, loadAutosave, rememberHandle, saveAutosave, saveTake, takeFor, type Handle, type Saved } from './persist'
import { checkFile, DOWNLOAD_URL } from './gate'
import { browserNoteSeen, browserOk, closeBrowserNote } from './browser'
import { hitBox, PreviewOverlay } from './PreviewOverlay'
import { autoLook, NEUTRAL, type Look } from './look'
import { buildOverview, type Overview } from './overview'
import {
  activeVideo, addTrack, appendToMain, duration as projectDuration, emptyProject, findPlaced, FRAMES, layout, moveClip, newId, placeOnLayer,
  removeClip, removeTrack, reserveIdsIn, sourceSize, splitClip, transformOf, updateClip, updateTrack, type Clip, type Project, type Source, type Transform,
} from './model'
import {
  Film, FilePlus, Layers, Moon, Music, Pause, Play, Plus, Redo2, Scissors,
  ScrollText, SkipBack, SkipForward, Square, Sun, Trash2, Type, Undo2, Upload, Volume2, ZoomIn, ZoomOut, MousePointerClick,
} from 'lucide-react'
import './App.css'

// A track's name, as the timeline shows it.
function trackLabel(p: Project, id: string): string {
  const v = p.video.findIndex((t) => t.id === id)
  if (v === 0) return 'Main'
  if (v > 0) return `Layer ${v}`
  return `Sound ${p.audio.findIndex((t) => t.id === id) + 1}`
}

function formatTime(seconds: number): string {
  // Playback starts a split second ahead of the sound (a small scheduling lead), which is a moment of
  // negative time: show it as 0:00, never as minus.
  seconds = Math.max(0, seconds)
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

type History = { past: Project[]; present: Project; future: Project[] }

export default function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [history, setHistory] = useState<History>(() => ({ past: [], present: emptyProject(), future: [] }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [pxPerSec, setPxPerSec] = useState(20)
  // Dark is the look; grey is the lighter choice. Kept per PC.
  const [theme, setTheme] = useState<'dark' | 'grey'>(() => {
    try { return localStorage.getItem('editor.theme') === 'grey' ? 'grey' : 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('editor.theme', theme) } catch { /* private window */ }
  }, [theme])
  // The timeline's height, dragged from its top edge.
  const [tlHeight, setTlHeight] = useState(() => {
    try { return Number(localStorage.getItem('editor.timelineHeight')) || 300 } catch { return 300 }
  })
  function startTlResize(e: React.PointerEvent) {
    const y0 = e.clientY
    const h0 = tlHeight
    const move = (ev: PointerEvent) => setTlHeight(Math.max(170, Math.min(window.innerHeight - 260, h0 - (ev.clientY - y0))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTlHeight((h) => {
        try { localStorage.setItem('editor.timelineHeight', String(h)) } catch { /* private window */ }
        return h
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const [exporting, setExporting] = useState(false)
  // Saving: when the last autosave happened, a saved edit waiting to be reopened, and files it could not find.
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [restorable, setRestorable] = useState<Saved | null>(null)
  const [missing, setMissing] = useState<{ saved: Saved; ids: string[] } | null>(null)
  const [askNew, setAskNew] = useState(false)
  // Not Chrome or Edge on a computer: a note at the top, once, that can be closed.
  const [browserNote, setBrowserNote] = useState(() => !browserOk() && !browserNoteSeen())
  // editor.postbarrel.com/?teleprompter opens straight on the teleprompter (the "Use the free teleprompter" link).
  const [mode, setMode] = useState<'edit' | 'prompt'>(() => (new URLSearchParams(window.location.search).has('teleprompter') ? 'prompt' : 'edit'))
  const [checked, setChecked] = useState<'waiting' | 'ok' | 'failed'>('waiting') // has the saved edit been looked for
  const [autoBusy, setAutoBusy] = useState(false)
  // Pictures and sound wave for each opened file, filled in the background after it is added.
  const [overviews, setOverviews] = useState<Map<string, Overview>>(new Map())
  // Which sidebar sections are open. They fold away to leave room.
  // All closed until clicked.
  const [open, setOpen] = useState({ details: false, transform: false, light: false, sound: false, color: false, text: false, lines: false, anim: false, border: false, speed: false })
  const textRef = useRef<HTMLTextAreaElement>(null)
  // True after a press in the preview: the arrow keys nudge the selected box. A press anywhere else turns it off.
  const [nudging, setNudging] = useState(false)
  // Asking before a layer with clips on it is removed.
  const [confirmRemove, setConfirmRemove] = useState<{ kind: 'video' | 'audio'; index: number; name: string; count: number } | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<Player | null>(null)
  // The project as it was when a drag or slider started, so the whole drag is one undo step.
  const liveBase = useRef<Project | null>(null)
  // Shape of the timeline the player last loaded, so a look or a moved box does not restart playback.
  const structure = useRef('')

  const project = history.present
  const duration = projectDuration(project)
  const frame = project.frame

  function commit(next: Project) {
    if (next === project) return
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: [] }))
  }
  // A change while dragging: shown at once, saved to undo as one step when the drag ends.
  function live(next: (p: Project) => Project) {
    if (!liveBase.current) liveBase.current = project
    setHistory((h) => ({ ...h, present: next(h.present) }))
  }
  function commitLive() {
    const base = liveBase.current
    liveBase.current = null
    if (base) setHistory((h) => ({ past: [...h.past, base], present: h.present, future: [] }))
  }
  function undo() {
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h))
  }
  function redo() {
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h))
  }

  async function addFile(file: File, handle?: Handle) {
    setError(null)
    setLoading(true)
    try {
      // Read by its contents, not its name: only MP4 or MOV video, sound and pictures, up to 1 GB, get through.
      const verdict = await checkFile(file)
      if (!verdict.ok) {
        setError(`${file.name}: ${verdict.reason}`)
        return
      }
      if (verdict.kind === 'picture') {
        // A picture: 5 seconds on a layer at the playhead, fitted to the frame.
        const { id, bitmap } = await loadImage(file)
        const clip: Clip = { id: newId('c'), kind: 'image', imageId: id, imageSize: [bitmap.width, bitmap.height], label: file.name, start: 0, in: 0, out: 5 }
        setHistory((h) => ({ past: [...h.past, h.present], present: placeOnLayer(h.present, clip, 'video', 1, playerRef.current?.now() ?? 0), future: [] }))
        setSelectedId(clip.id)
        return
      }
      const media = await openMedia(file)
      if (!media.videoTrack && !media.audioTrack) throw new Error("its picture and sound can't be decoded in this browser")
      // Video only from MP4 or MOV; other containers belong to the free app.
      if (media.info.video && !/^(MP4|QuickTime)/i.test(media.info.format)) {
        setError(`${file.name}: ${media.info.format} video opens in the free app, not in the web version.`)
        return
      }
      const fileKey = { name: file.name, size: file.size, lastModified: file.lastModified }
      const source: Source = { id: newId('s'), name: file.name, media, file: fileKey }
      // Remember where the file is on the PC, so a saved edit can open it again later.
      if (handle) rememberHandle(keyOf(fileKey), handle).catch(() => {})
      setSources((s) => [...s, source])
      buildOverview(source, (o) => setOverviews((m) => new Map(m).set(source.id, o))).catch(() => {})
      const clip: Clip = { id: newId('c'), kind: 'media', sourceId: source.id, start: 0, in: 0, out: media.info.duration }
      // Video goes on the end of the main track. Sound-only files (music, voiceover) go on a sound track at the playhead.
      setHistory((h) => ({
        past: [...h.past, h.present],
        present: media.videoTrack ? appendToMain(h.present, clip) : placeOnLayer(h.present, clip, 'audio', 0, playerRef.current?.now() ?? 0),
        future: [],
      }))
      setSelectedId(clip.id)
    } catch (err) {
      setError(`Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const f of files) await addFile(f)
  }

  // Chrome's own file box gives a lasting pointer to each file, so saved edits can reopen them.
  const pickRef = useRef<HTMLInputElement>(null)
  async function pickFiles() {
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<Handle[]> }).showOpenFilePicker
    if (!picker) {
      pickRef.current?.click()
      return
    }
    let handles: Handle[]
    try {
      handles = await picker({
        multiple: true,
        types: [{ description: 'MP4 or MOV video, sound or picture', accept: { 'video/*': ['.mp4', '.mov'], 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] } }],
      })
    } catch {
      return // closed the box
    }
    for (const h of handles) await addFile(await h.getFile(), h)
  }

  // ---- Keeping your work ----
  function snapshot(): Saved {
    const used = new Set(layout(project).map((pl) => pl.clip.imageId).filter(Boolean))
    return {
      version: 1,
      savedAt: Date.now(),
      project,
      sources: sources.filter((src) => src.file).map((src) => ({ id: src.id, ...src.file! })),
      images: [...imageFiles].filter(([id]) => used.has(id)).map(([id, f]) => ({ id, ...f })),
    }
  }

  // Saves a second after each change, into this browser's own storage on the PC.
  useEffect(() => {
    // Never write until the saved edit has been looked for, and never over one the person has not decided about.
    if (checked !== 'ok' || restorable || missing || loading) return
    if (projectDuration(project) === 0 && !project.script) return
    const t = setTimeout(() => {
      const s = snapshot()
      saveAutosave(s).then(() => setSavedAt(s.savedAt)).catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  })

  // On opening the editor: is there an edit to bring back?
  useEffect(() => {
    loadAutosave()
      .then((s) => {
        if (s && s.project && (layout(s.project).length || s.project.script)) setRestorable(s)
        setChecked('ok')
      })
      .catch((err) => {
        setChecked('failed')
        setError(`Autosave is off: the saved edit could not be read (${err instanceof Error ? err.message : String(err)}). Reload to try again.`)
      })
  }, [])

  // Brings a saved edit back: pictures from the save, videos and sound from where they are on the PC.
  async function restore(saved: Saved, extra?: Map<string, File>): Promise<'ok' | 'missing' | 'failed'> {
    setLoading(true)
    setError(null)
    try {
      reserveIdsIn(saved)
      for (const im of saved.images) await restoreImage(im.id, im.name, im.type, im.data)
      const opened: Source[] = []
      const lost: string[] = []
      for (const src of saved.sources) {
        let file = extra?.get(src.id) ?? null
        if (!file) {
          const h = await handleFor(keyOf(src))
          if (h) file = await fileFromHandle(h)
        }
        if (!file) {
          // A teleprompter take: its bytes are kept in this browser.
          const take = await takeFor(keyOf(src)).catch(() => undefined)
          if (take) file = new File([take], src.name, { type: take.type, lastModified: src.lastModified })
        }
        // Files brought back go through the same check as new ones.
        if (file && !(await checkFile(file)).ok) file = null
        if (!file) {
          lost.push(src.id)
          continue
        }
        const media = await openMedia(file)
        if (media.info.video && !/^(MP4|QuickTime)/i.test(media.info.format)) {
          lost.push(src.id)
          continue
        }
        const source: Source = { id: src.id, name: src.name, media, file: { name: src.name, size: src.size, lastModified: src.lastModified } }
        opened.push(source)
        buildOverview(source, (o) => setOverviews((m) => new Map(m).set(source.id, o))).catch(() => {})
      }
      if (lost.length) {
        setMissing({ saved, ids: lost })
        // Keep what was found, so a second try only needs the missing ones.
        setSources(opened)
        return 'missing'
      }
      setSources(opened)
      setHistory({ past: [], present: saved.project, future: [] })
      setSelectedId(null)
      setMissing(null)
      setRestorable(null)
      playerRef.current?.seek(0)
      return 'ok'
    } catch (err) {
      setError(`Could not reopen the edit: ${err instanceof Error ? err.message : String(err)}`)
      return 'failed'
    } finally {
      setLoading(false)
    }
  }

  // The person points to files that have moved: matched to the saved ones by name and size.
  async function locateMissing() {
    if (!missing) return
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<Handle[]> }).showOpenFilePicker
    if (!picker) return
    let handles: Handle[]
    try {
      handles = await picker({ multiple: true })
    } catch {
      return
    }
    const found = new Map<string, File>()
    for (const h of handles) {
      const f = await h.getFile()
      const src = missing.saved.sources.find((x) => missing.ids.includes(x.id) && x.name === f.name && x.size === f.size)
        ?? missing.saved.sources.find((x) => missing.ids.includes(x.id) && x.name === f.name)
      if (src) {
        found.set(src.id, f)
        rememberHandle(keyOf(src), h).catch(() => {})
      }
    }
    await restore(missing.saved, found)
  }

  // New: an empty edit. The old one is not kept (there are no project files in the web version).
  function startNew() {
    playerRef.current?.pause()
    setHistory({ past: [], present: emptyProject(), future: [] })
    setSources([])
    setSelectedId(null)
    setMissing(null)
    setRestorable(null)
    setAskNew(false)
    setSavedAt(null)
    setMode('edit')
    clearAutosave().catch(() => {})
    playerRef.current?.seek(0)
  }

  // Remembered in this browser: the person ticked "Don't ask again" when removing a layer.
  const SKIP_ASK = 'editor.skipRemoveLayerAsk'
  const skipAsk = () => {
    try { return localStorage.getItem(SKIP_ASK) === '1' } catch { return false }
  }
  function requestRemoveTrack(kind: 'video' | 'audio', index: number) {
    const track = (kind === 'video' ? project.video : project.audio)[index]
    if (!track) return
    const name = kind === 'video' ? `Layer ${index}` : `Sound ${index + 1}`
    if (track.clips.length === 0 || skipAsk()) {
      if (track.clips.some((c) => c.id === selectedId)) setSelectedId(null)
      commit(removeTrack(project, kind, index))
      return
    }
    setDontAsk(false)
    setConfirmRemove({ kind, index, name, count: track.clips.length })
  }
  function confirmRemoveTrack() {
    if (!confirmRemove) return
    if (dontAsk) {
      try { localStorage.setItem(SKIP_ASK, '1') } catch { /* private window: just ask again next time */ }
    }
    const track = (confirmRemove.kind === 'video' ? project.video : project.audio)[confirmRemove.index]
    if (track?.clips.some((c) => c.id === selectedId)) setSelectedId(null)
    commit(removeTrack(project, confirmRemove.kind, confirmRemove.index))
    setConfirmRemove(null)
  }

  function addText() {
    const clip: Clip = { id: newId('c'), kind: 'text', text: { ...DEFAULT_TEXT }, start: 0, in: 0, out: 5 }
    commit(placeOnLayer(project, clip, 'video', 1, playerRef.current?.now() ?? 0))
    setSelectedId(clip.id)
    editText()
  }
  // Opens the Text section and puts the cursor in the typing box, with the words selected.
  function editText() {
    setOpen((o) => ({ ...o, text: true }))
    setTimeout(() => {
      textRef.current?.focus({ preventScroll: true }) // no page jump
      textRef.current?.select()
    }, 50)
  }

  function addColourBlock() {
    const clip: Clip = { id: newId('c'), kind: 'color', color: '#000000', start: 0, in: 0, out: 5 }
    commit(placeOnLayer(project, clip, 'video', 1, playerRef.current?.now() ?? 0))
    setSelectedId(clip.id)
  }

  // Dev only: hooks so a test can add files and export without the file and save boxes.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__openUrl = async (url: string) => {
      const blob = await (await fetch(url)).blob()
      await addFile(new File([blob], decodeURIComponent(url.split('/').pop()!), { type: blob.type }))
    }
    w.__project = project
    w.__restore = restore
    w.__loadAutosave = loadAutosave
    w.__commit = commit
    w.__select = setSelectedId
    w.__exportTest = async (settings: ExportSettings & { download?: string }) => {
      let buf = new Uint8Array(1 << 20)
      let size = 0
      const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
        write(chunk) {
          const end = chunk.position + chunk.data.byteLength
          if (end > buf.length) {
            const bigger = new Uint8Array(Math.max(end, buf.length * 2))
            bigger.set(buf)
            buf = bigger
          }
          buf.set(chunk.data, chunk.position)
          size = Math.max(size, end)
        },
      })
      const t0 = performance.now()
      await exportProject(sources, project, settings, writable, () => {}, new AbortController().signal)
      const bytes = buf.slice(0, size)
      w.__lastExport = bytes
      const back = await openMedia(new File([bytes], 'out'))
      if (settings.download) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([bytes]))
        a.download = settings.download
        a.click()
      }
      return { seconds: ((performance.now() - t0) / 1000).toFixed(1), bytes: size, info: back.info }
    }
  })

  // One player for the whole session.
  useEffect(() => {
    if (!previewRef.current) return
    const p = new Player(previewRef.current, (t, isPlaying) => {
      setTime(t)
      setPlaying(isPlaying)
    })
    playerRef.current = p
    if (import.meta.env.DEV) (window as unknown as { __player: Player }).__player = p
    return () => {
      p.dispose()
      playerRef.current = null
    }
  }, [])

  // Every edit goes to the player. Only a change to which clips play when (or their sound) restarts playback.
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const sig =
      `${sources.length}#${project.frame.w}x${project.frame.h}#` +
      layout(project).map((pl) => `${pl.kind}${pl.trackIndex}:${pl.clip.id}:${pl.start}:${pl.clip.in}:${pl.clip.out}:${pl.clip.volume ?? 1}:${pl.clip.speed ?? 1}:${pl.clip.keepPitch !== false}:${pl.clip.fadeIn ?? 0}:${pl.clip.fadeOut ?? 0}`).join('|') +
      // a track going quieter under the voice, and the waves it is worked out from
      `#${[...project.video, ...project.audio].map((t) => (t.duck ? `${t.id}<${t.duck.under}@${t.duck.level}` : '')).join(',')}#${[...overviews.values()].filter((o) => o.peaks).length}`
    p.setProject(sources, project, sig !== structure.current)
    structure.current = sig
  }, [sources, project, overviews])

  useEffect(() => {
    playerRef.current?.setVolume(volume)
  }, [volume])

  const selectedPl = findPlaced(project, selectedId)
  const selected = selectedPl?.clip ?? null
  const selectedSource = selected?.sourceId ? sources.find((s) => s.id === selected.sourceId) ?? null : null
  const fps = selectedSource?.media.info.video?.fps || sources.find((s) => s.media.info.video)?.media.info.video?.fps || 30
  // The selected clip's box, drawn over the preview only while it is showing at the playhead.
  const showingSelected = selectedPl && selectedPl.kind === 'video' && time >= selectedPl.start - 1e-6 && time < selectedPl.end
  const selectedTransform = selected && selectedPl?.kind === 'video' ? transformOf(frame, sources, selected) : null

  function updateSel(p: Project, patch: Partial<Clip>): Project {
    return selectedId ? updateClip(p, selectedId, patch) : p
  }

  async function autoFix(clip: Clip) {
    const p = playerRef.current
    if (!p?.lookRenderer) return
    setAutoBusy(true)
    try {
      const frames = await p.framesOf(clip, 5)
      if (frames.length) commit(updateClip(project, clip.id, { look: autoLook(frames, p.lookRenderer) }))
    } finally {
      setAutoBusy(false)
    }
  }

  function togglePlay() {
    const p = playerRef.current
    if (!p) return
    if (p.playing) p.pause()
    else p.play()
  }

  function step(seconds: number) {
    const p = playerRef.current
    if (!p) return
    p.pause()
    p.seek(p.now() + seconds)
  }

  // Splits the selected clip at the playhead, or the main-track clip there if the selected one is not under it.
  function split() {
    const t = playerRef.current?.now() ?? time
    let target = selectedPl && t > selectedPl.start && t < selectedPl.end ? selectedPl.clip.id : null
    if (!target) target = layout(project).find((pl) => pl.kind === 'video' && pl.trackIndex === 0 && t > pl.start && t < pl.end)?.clip.id ?? null
    if (!target) return
    const next = splitClip(project, target, t)
    commit(next)
    const right = layout(next).find((pl) => pl.start === t || (t > pl.start && t < pl.end && pl.clip.id !== target))
    if (right) setSelectedId(right.clip.id)
  }

  function remove() {
    if (!selectedId) return
    commit(removeClip(project, selectedId))
    setSelectedId(null)
  }

  // Click on the preview: select the top-most clip under the pointer.
  function pick(x: number, y: number) {
    const hits = activeVideo(project, time).filter((pl) => hitBox(transformOf(frame, sources, pl.clip), x, y))
    setSelectedId(hits.length ? hits[hits.length - 1].clip.id : null)
  }

  // Space play or pause, arrows step a frame (Shift: a second), S split, Delete remove, Ctrl+Z undo, Ctrl+Y redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (exporting || confirmRemove || askNew || mode === 'prompt') return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox') return
      // Arrows on a focused slider move the slider, not the playhead.
      if (el.tagName === 'INPUT' && e.code.startsWith('Arrow')) return
      if (el.tagName === 'SELECT') return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code.startsWith('Arrow') && nudging && selected && showingSelected && selectedTransform) {
        // Fine positioning: 1 pixel a press, 10 with Shift. Held keys repeat, and the run is one undo step.
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        const dx = e.code === 'ArrowLeft' ? -d : e.code === 'ArrowRight' ? d : 0
        const dy = e.code === 'ArrowUp' ? -d : e.code === 'ArrowDown' ? d : 0
        live((p) => {
          const c = findPlaced(p, selected.id)?.clip
          if (!c) return p
          const t = transformOf(p.frame, sources, c)
          return updateSel(p, { transform: { ...t, x: t.x + dx, y: t.y + dy } })
        })
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault()
        step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps))
      } else if (ctrl && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (ctrl && e.code === 'KeyY') {
        e.preventDefault()
        redo()
      } else if (!ctrl && e.code === 'KeyS') {
        e.preventDefault()
        split()
      } else if (!ctrl && (e.key === '+' || e.key === '=')) {
        setPxPerSec((z) => Math.min(200, Math.round(z * 1.5)))
      } else if (!ctrl && (e.key === '-' || e.key === '_')) {
        setPxPerSec((z) => Math.max(2, Math.round(z / 1.5)))
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        remove()
      }
    }
    // Letting go of an arrow after nudging saves the nudges as one undo step.
    function onKeyUp(e: KeyboardEvent) {
      if (e.code.startsWith('Arrow')) commitLive()
    }
    // A press outside the preview gives the arrow keys back to stepping frames.
    function onDown(e: PointerEvent) {
      if (!(e.target as HTMLElement).closest('.stage')) setNudging(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerdown', onDown)
    }
  })

  const blurThen = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    fn()
  }
  const fold = (key: keyof typeof open, title: string, body: React.ReactNode) => (
    <details className="fold" open={open[key]} onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; setOpen((o) => (o[key] === v ? o : { ...o, [key]: v })) }}>
      <summary>{title}</summary>
      {body}
    </details>
  )
  const setTransformLive = (t: Transform, scale?: number) => {
    if (!selected) return
    if (selected.kind === 'text' && scale && selected.text) {
      // A text box pulled from a corner: the letters (and their outline) scale from where the drag started.
      const before = findPlaced(liveBase.current ?? project, selected.id)?.clip.text ?? selected.text
      const text = { ...selected.text, size: Math.max(6, before.size * scale), outlineWidth: before.outlineWidth * scale }
      live((p) => updateSel(p, { transform: t, text }))
    } else live((p) => updateSel(p, { transform: t }))
  }
  const frameId = FRAMES.find((f) => f.frame.w === frame.w && f.frame.h === frame.h)?.id ?? '9:16'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>Postbarrel <b>Vid Editor</b></span>
        </div>
        <div className="tabs">
          <button className={mode === 'edit' ? 'on' : ''} onClick={blurThen(() => setMode('edit'))}><Film size={15} /> Edit</button>
          <button className={mode === 'prompt' ? 'on' : ''} onClick={blurThen(() => { playerRef.current?.pause(); setMode('prompt') })}><ScrollText size={15} /> Teleprompter</button>
        </div>
        <div className="title">
          <span className="edition">Free web version</span>
          <span className="saved-note" title="Saved in this browser on your PC">{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
        <div className="top-actions">
          <button className="icon-btn" onClick={blurThen(() => (projectDuration(project) > 0 ? setAskNew(true) : startNew()))} title="New edit"><FilePlus size={18} /></button>
          <span className="sep" />
          <button className="icon-btn" onClick={blurThen(undo)} disabled={!history.past.length} title="Undo (Ctrl+Z)"><Undo2 size={18} /></button>
          <button className="icon-btn" onClick={blurThen(redo)} disabled={!history.future.length} title="Redo (Ctrl+Y)"><Redo2 size={18} /></button>
          <span className="sep" />
          <label className="frame-pick" title="The shape of the video">
            <select value={frameId} onChange={(e) => commit({ ...project, frame: FRAMES.find((f) => f.id === e.target.value)!.frame })}>
              {FRAMES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <InfoMenus />
          <button className="icon-btn" onClick={blurThen(() => setTheme(theme === 'dark' ? 'grey' : 'dark'))} title={theme === 'dark' ? 'Grey look' : 'Dark look'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="export" disabled={duration === 0} onClick={blurThen(() => { playerRef.current?.pause(); setExporting(true) })}><Upload size={16} /> Export</button>
        </div>
      </header>
      <input ref={pickRef} type="file" multiple accept="video/*,audio/*,image/*,.avi,.mkv,.mov,.webm,.mp4,.ts,.mp3,.wav,.m4a,.flac,.ogg,.png,.jpg,.jpeg,.webp" onChange={onPick} hidden />
      <div className="notices">

      {browserNote && (
        <div className="banner warn">
          <span>This editor works best in Chrome or Microsoft Edge on a computer. Some things, like saving straight into a folder, may not work here.</span>
          <button onClick={() => { closeBrowserNote(); setBrowserNote(false) }}>Close</button>
        </div>
      )}
      {restorable && (
        <div className="banner">
          <span>Your last edit from {new Date(restorable.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} is saved in this browser.</span>
          <button className="primary" onClick={() => restore(restorable)}>Carry on</button>
          <button onClick={startNew}>Start new</button>
        </div>
      )}
      {missing && (
        <div className="banner warn">
          <span>
            {missing.ids.length === 1 ? 'One file was not found where it was' : `${missing.ids.length} files were not found where they were`}:{' '}
            {missing.saved.sources.filter((x) => missing.ids.includes(x.id)).map((x) => x.name).join(', ')}
          </span>
          <button className="primary" onClick={locateMissing}>Find {missing.ids.length === 1 ? 'it' : 'them'}</button>
          <button onClick={() => { setMissing(null) }} title="Keep what was found">Cancel</button>
        </div>
      )}
      {askNew && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setAskNew(false)}>
          <div className="modal">
            <h2>Start a new edit?</h2>
            <p className="note">The web version keeps one edit at a time, so this one is cleared. Export it first if you want to keep it. The free app keeps any number of projects.</p>
            <div className="modal-buttons">
              <button onClick={() => setAskNew(false)}>Cancel</button>
              <button className="primary danger" onClick={startNew}>Start new</button>
            </div>
          </div>
        </div>
      )}
      {loading && <div className="banner"><span>Reading the file…</span></div>}
      {error && (
        <div className="banner bad">
          <span>{error}</span>
          {/free app/.test(error) && <a className="banner-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Get the free app</a>}
          <button onClick={() => setError(null)}>Close</button>
        </div>
      )}
      </div>

      <Teleprompter
        active={mode === 'prompt'}
        frameAspect={project.frame.w / project.frame.h}
        script={project.script ?? ''}
        onScript={(script) => setHistory((h) => ({ ...h, present: { ...h.present, script } }))}
        onTake={async (file) => {
          await addFile(file)
          saveTake(keyOf(file), file).catch(() => setError('The take is on the timeline but could not be kept in this browser. Save it as a file.'))
        }}
      />
      <div className="edit-view" hidden={mode === 'prompt'}>
      <nav className="rail">
        <button className="rail-btn accent" onClick={blurThen(pickFiles)} title="Add video, picture or sound"><Plus size={22} /><span>Media</span></button>
        <button className="rail-btn" onClick={blurThen(addText)} title="Text on a layer at the playhead"><Type size={20} /><span>Text</span></button>
        <button className="rail-btn" onClick={blurThen(addColourBlock)} title="A plain block on a layer, black to start with"><Square size={20} /><span>Block</span></button>
        <span className="rail-sep" />
        <button className="rail-btn" onClick={blurThen(() => commit(addTrack(project, 'video')))} title="A new empty layer on top"><Layers size={20} /><span>Layer</span></button>
        <button className="rail-btn" onClick={blurThen(() => commit(addTrack(project, 'audio')))} title="A new empty sound track"><Music size={20} /><span>Sound</span></button>
      </nav>
      <main>
        <section className="preview">
          <div className="stage-box">
          <div className={`stage${nudging && showingSelected ? ' nudging' : ''}`} style={{ '--ar': frame.w / frame.h } as React.CSSProperties} title={nudging ? 'Arrow keys nudge the selected picture' : undefined}>
            <canvas ref={previewRef} />
            {duration === 0 && <p className="note empty-note">Add a video to start.</p>}
            <PreviewOverlay
              frame={frame}
              transform={showingSelected ? selectedTransform : null}
              onLive={setTransformLive}
              onCommit={commitLive}
              onPick={pick}
              textMode={selected?.kind === 'text'}
              onEditText={editText}
              onActivate={() => setNudging(true)}
            />
          </div>
          </div>
          <div className="controls">
            <span className="time">{formatTime(time)} <i>/ {formatTime(duration)}</i></span>
            <div className="transport">
              <button onClick={blurThen(() => step(-1 / fps))} title="Back one frame (Left)"><SkipBack size={18} /></button>
              <button className="play" onClick={blurThen(togglePlay)} title="Play or pause (Space)">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
              <button onClick={blurThen(() => step(1 / fps))} title="Forward one frame (Right)"><SkipForward size={18} /></button>
            </div>
            <label className="volume" title="Preview volume">
              <Volume2 size={16} />
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
            </label>
          </div>
        </section>

        <section className="details">
          {selected ? (
            <>
              <h2>{selected.kind === 'color' ? 'Colour block' : selected.kind === 'image' ? selected.label ?? 'Picture' : selected.kind === 'text' ? 'Text' : selectedSource?.name}</h2>
              {selected.kind === 'text' && selected.text &&
                fold('text', 'Text', (
                  <TextPanel
                    style={selected.text}
                    textRef={textRef}
                    onLive={(text: TextStyle) => live((p) => updateSel(p, { text }))}
                    onCommit={commitLive}
                    onSet={(text: TextStyle) => commit(updateSel(project, { text }))}
                  />
                ))}
              {selected.kind === 'color' &&
                fold('color', 'Colour', (
                  <div className="color-row">
                    <input type="color" value={selected.color ?? '#000000'} onChange={(e) => live((p) => updateSel(p, { color: e.target.value }))} onBlur={commitLive} />
                    <span>{selected.color ?? '#000000'}</span>
                  </div>
                ))}
              {selectedSource &&
                fold('details', 'Clip details', (
                  <table>
                    <tbody>
                      <tr><th>Clip</th><td>{formatTime(selected.in)} to {formatTime(selected.out)} ({formatTime(selected.out - selected.in)})</td></tr>
                      <tr><th>Container</th><td>{selectedSource.media.info.format}</td></tr>
                      <tr><th>Size</th><td>{formatBytes(selectedSource.media.info.fileSize)}</td></tr>
                      <tr><th>Full length</th><td>{formatTime(selectedSource.media.info.duration)}</td></tr>
                      {selectedSource.media.info.video && (
                        <>
                          <tr><th>Video</th><td>{selectedSource.media.info.video.codec}</td></tr>
                          <tr><th>Picture</th><td>{selectedSource.media.info.video.width} × {selectedSource.media.info.video.height}</td></tr>
                          <tr><th>Frame rate</th><td>{selectedSource.media.info.video.fps.toFixed(2)} fps</td></tr>
                        </>
                      )}
                      <tr><th>Audio</th><td>{selectedSource.media.info.audio ? `${selectedSource.media.info.audio.codec}, ${selectedSource.media.info.audio.sampleRate} Hz` : 'none'}</td></tr>
                    </tbody>
                  </table>
                ))}
              {selectedTransform &&
                fold('transform', 'Position and size', (
                  <TransformPanel
                    frame={frame}
                    transform={selectedTransform}
                    srcSize={sourceSize(sources, selected) ?? [frame.w, frame.h]}
                    onLive={setTransformLive}
                    onCommit={commitLive}
                    onSet={(t) => commit(updateSel(project, { transform: t }))}
                  />
                ))}
              {selected.kind === 'media' &&
                fold('speed', 'Speed', (
                  <SpeedPanel
                    speed={selected.speed ?? 1}
                    keepPitch={selected.keepPitch !== false}
                    sourceLength={selected.out - selected.in}
                    onSet={(speed) => commit(updateClip(project, selected.id, { speed }))}
                    onLive={(speed) => live((p) => updateClip(p, selected.id, { speed }))}
                    onCommit={commitLive}
                    onKeepPitch={(keepPitch) => commit(updateClip(project, selected.id, { keepPitch }))}
                  />
                ))}
              {selectedPl?.kind === 'video' &&
                fold('anim', 'Animation', (
                  <AnimationPanel
                    anim={selected.anim}
                    isText={selected.kind === 'text'}
                    onSet={(anim) => commit(updateSel(project, { anim }))}
                    onLive={(anim) => live((p) => updateSel(p, { anim }))}
                    onCommit={commitLive}
                  />
                ))}
              {(selected.kind === 'media' || selected.kind === 'image' || selected.kind === 'color') && selectedPl?.kind === 'video' &&
                fold('border', 'Border', (
                  <BorderPanel
                    border={selected.border}
                    onSet={(border) => commit(updateSel(project, { border }))}
                    onLive={(border) => live((p) => updateSel(p, { border }))}
                    onCommit={commitLive}
                  />
                ))}
              {(selectedSource?.media.videoTrack || selected.kind === 'image') &&
                fold('light', 'Fix light and colour', (
                  <LightPanel
                    look={selected.look ?? NEUTRAL}
                    busy={autoBusy}
                    onLive={(look: Look) => live((p) => updateSel(p, { look }))}
                    onCommit={commitLive}
                    onSet={(look: Look) => commit(updateSel(project, { look }))}
                    onAuto={() => autoFix(selected)}
                    onApplyAll={() => {
                      let next = project
                      for (const pl of layout(project)) if (pl.clip.kind === 'media') next = updateClip(next, pl.clip.id, { look: selected.look ?? NEUTRAL })
                      commit(next)
                    }}
                  />
                ))}
              {selectedSource?.media.audioTrack &&
                selectedPl &&
                fold('sound', 'Sound', (() => {
                  const track = (selectedPl.kind === 'video' ? project.video : project.audio)[selectedPl.trackIndex]
                  const len = selectedPl.end - selectedPl.start
                  return (
                    <SoundPanel
                      volume={selected.volume ?? 1}
                      fadeIn={selected.fadeIn ?? 0}
                      fadeOut={selected.fadeOut ?? 0}
                      maxFade={len / 2}
                      duck={track.duck}
                      trackLabel={trackLabel(project, track.id)}
                      voiceTracks={[...project.video, ...project.audio]
                        .filter((t) => t.id !== track.id && t.clips.some((c) => c.kind === 'media' && sources.find((s) => s.id === c.sourceId)?.media.audioTrack))
                        .map((t) => ({ id: t.id, label: trackLabel(project, t.id) }))}
                      onLive={(patch) => live((p) => updateSel(p, patch))}
                      onCommit={commitLive}
                      onSet={(patch) => commit(updateSel(project, patch))}
                      onDuck={(duck, isLive) => (isLive ? live((p) => updateTrack(p, track.id, { duck })) : commit(updateTrack(project, track.id, { duck })))}
                    />
                  )
                })())}
            </>
          ) : (
            <div className="empty-panel">
              <MousePointerClick size={28} />
              <p>Click a clip on the timeline, or a picture in the preview, to change it.</p>
            </div>
          )}
        </section>
      </main>

      <div className="tl-area" style={{ height: tlHeight }}>
      <div className="tl-resize" onPointerDown={startTlResize} title="Drag to make the timeline taller or shorter" />
      <div className="toolbar">
        <button className="icon-btn" onClick={blurThen(split)} disabled={duration === 0} title="Split at the playhead (S)"><Scissors size={17} /></button>
        <button className="icon-btn" onClick={blurThen(remove)} disabled={!selectedId} title="Delete the selected clip (Delete)"><Trash2 size={17} /></button>
        <div className="zoom">
          <button className="icon-btn" onClick={blurThen(() => setPxPerSec((z) => Math.max(2, Math.round(z / 1.5))))} title="Zoom out (-)"><ZoomOut size={17} /></button>
          <input type="range" min={2} max={200} step={1} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} title="Zoom" />
          <button className="icon-btn" onClick={blurThen(() => setPxPerSec((z) => Math.min(200, Math.round(z * 1.5))))} title="Zoom in (+)"><ZoomIn size={17} /></button>
        </div>
      </div>
      <Timeline
        project={project}
        sources={sources}
        time={time}
        duration={duration}
        pxPerSec={pxPerSec}
        selectedId={selectedId}
        overviews={overviews}
        onSeek={(t) => playerRef.current?.seek(t)}
        onSelect={setSelectedId}
        onTrimLive={(id, patch) => live((p) => updateClip(p, id, patch))}
        onCommit={commitLive}
        onMove={(id, kind, trackIndex, start, mainIndex) => commit(moveClip(project, id, kind, trackIndex, start, mainIndex))}
        onRemoveTrack={requestRemoveTrack}
        onAddTrack={(kind, after) => commit(addTrack(project, kind, after))}
      />
      </div>
      {confirmRemove && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setConfirmRemove(null)}>
          <div className="modal">
            <h2>Remove {confirmRemove.name}?</h2>
            <p className="note">
              It has {confirmRemove.count} clip{confirmRemove.count === 1 ? '' : 's'} on it. Removing the layer deletes everything on it. Undo (Ctrl+Z) brings it back.
            </p>
            <label className="check">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
              Don't ask again
            </label>
            <div className="modal-buttons">
              <button onClick={() => setConfirmRemove(null)}>Keep it</button>
              <button className="primary danger" onClick={confirmRemoveTrack}>Delete everything on it</button>
            </div>
          </div>
        </div>
      )}
      {exporting && <ExportDialog sources={sources} project={project} onClose={() => setExporting(false)} />}
      </div>
    </div>
  )
}
