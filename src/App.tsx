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
import { CaptionsDialog } from './CaptionsDialog'
import { AnimationPanel, BorderPanel } from './EffectPanels'
import { SpeedPanel } from './SpeedPanel'
import { SoundPanel } from './SoundPanel'
import { Teleprompter } from './Teleprompter'
import { Home } from './Home'
import { InfoMenus } from './InfoMenus'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { IS_WEB, openDownload, DOWNLOAD_URL } from './edition'
import { Welcome } from './Welcome'
import { countUse } from './usage'
import { ScriptWriter } from './ScriptWriter'
import { checkFile } from './gate'
import { browserNoteSeen, browserOk, closeBrowserNote } from './browser'
import { AppMore } from './AppMore'
import { webMenu } from './webMenu'
import { allClips, frameOf, inPicture, moveLayer, straighten, toEdit, toPicture } from './picture'
import { LayersPanel } from './LayersPanel'
import { CollageDialog, COLLAGES, cellTransform } from './Collage'
import { pictureMenu } from './pictureMenu'
import { exportStill } from './export'

// The transitions the web version has; the rest are in the free app.
const WEB_TRANSITIONS: string[] = ['dissolve', 'dip', 'dipWhite']
import { BlendPanel, EffectsPanel, KeyPanel, LookPanel, SfxPanel, ShadePanel } from './FxPanels'
import { applyLayout, LAYOUTS, showingPictures } from './layouts'
import { BrandDialog, loadBrand } from './Brand'
import { renderAudio } from './export'
import { loudnessMeter } from './loudness'
import { ChevronRight, X } from 'lucide-react'
import { reverseRange } from './reverse'
import { Scopes } from './Scopes'
import { loadLottie } from './lottie'
import { findBeats, findCuts } from './analyse'
import { makeTitle, TITLES } from './titles'
import { Viewer, type Place } from './Viewer'
import { longestKeyGap, makeProxy, SLOW_KEY_GAP, wantsProxy } from './proxy'
import { findCopy, newCopy } from './proxyStore'
import { activeId, activeName, cutOutForNest, deleteSeq, newSeq, renameSeq, seqById, seqHash, seqList, switchSeq, usedBy, type Seq } from './sequences'
import { ChevronDown } from 'lucide-react'
import { flattenMulticam, syncBySound, type Cut } from './multicam'
import { analyseShake, sampleAt, trackBox } from './motion'
import { parseCube } from './look'
import { CanvasSink } from 'mediabunny'
import { imageFiles, imageStore, isImageFile, loadImage, restoreImage } from './images'
import { startFrom } from './templates'
import { loadKeys, type KeyAction } from './keys'
import { fileFromHandle, fromProjectFile, handleFor, keyOf, loadAutosave, rememberHandle, saveTake, takeFor, canWrite, writeProjectFile, type ProjectHandle,
  deleteProject, getProject, listProjects, moveOldAutosave, newProjectId, putProject, saveAutosave, clearAutosave, type ProjectRecord, type Handle, type Saved } from './persist'
import { addCaptionLayer, captionLines, fromSubtitles, toSrt, toVtt, type Line } from './captions'
import { hitBox, PreviewOverlay } from './PreviewOverlay'
import { autoLook, NEUTRAL, type Look } from './look'
import { buildOverview, type Overview } from './overview'
import {
  activeVideo, addMarker, addTrack, appendToMain, pruneEmptyTracks, closeGap, duration as projectDuration, emptyProject, findPlaced, FRAMES, gapAt, groupOf, insertAfter,
  isLocked, layout, moveClip, newId, placeOnLayer, removeClip, removeMarker, removeTrack, reserveIdsIn, rippleDelete, setGroup, shiftAfter, sourceAt,
  fitTransform, sourceSize, splitClip, transformOf, updateClip, updateMarker, updateTrack, type Clip, type Project, type Source, type Transform,
  trackedPoint, insertOnMain, overwriteOnMain, localAt, DEFAULT_KEY, DEFAULT_SHADE, DEFAULT_MASK, type Mask, type Matte, NO_FX, NO_SFX, addKeyAt, placeAt, transformAt, type Ease, shown, TRANSITIONS, type Transition,
} from './model'
import {
  Captions, Film, FilePlus, House, FolderOpen, Image as ImageIcon, LayoutGrid, Layers, Moon, Music, Pause, Play, Plus, Redo2, Save, Scissors,
  PenLine, ScrollText, SkipBack, SkipForward, Square, Sun, Trash2, Type, Undo2, Upload, Volume2, ZoomIn, ZoomOut, MousePointerClick,
} from 'lucide-react'
import { defaultShape, drawingFrom, shapeBox, SHAPES, STICKERS, type ShapeKind } from './shape'
import { ShapePanel } from './ShapePanel'
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

// The small arrow on a rail button's edge: the button keeps doing what it always did, the arrow opens the extras.
function RailMore({ onOpen, title }: { onOpen: (x: number, y: number) => void; title: string }) {
  return (
    <button className="rail-more" title={title} onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); e.currentTarget.blur(); onOpen(b.right + 4, b.top - 6) }}>
      <ChevronRight size={11} />
    </button>
  )
}

export default function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [history, setHistory] = useState<History>(() => ({ past: [], present: emptyProject(), future: [] }))
  const [selectedId, setSelectedIdOnly] = useState<string | null>(null)
  // Clips added to the selection with Ctrl+click, for grouping and deleting several at once.
  const [extraIds, setExtraIds] = useState<string[]>([])
  function setSelectedId(id: string | null) {
    setSelectedIdOnly(id)
    setExtraIds([])
    setPenFor(null)
  }
  // The right-click menu showing, if any, and the effects copied from a clip.
  const [menu, setMenuRaw] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // Web version: every menu keeps the basics and points to the free app for the rest.
  // The Picture tab: nothing about time.
  const setMenu = (m: { x: number; y: number; items: MenuItem[] } | null) => {
    if (m && mode === 'picture') m = { ...m, items: pictureMenu(m.items) }
    setMenuRaw(m && IS_WEB ? { ...m, items: webMenu(m.items) } : m)
  }
  const [copied, setCopied] = useState<Partial<Clip> | null>(null)
  // Copied movement: the keyframes (times are seconds into the clip) and the shape of the path between them.
  const [copiedKeys, setCopiedKeys] = useState<Pick<Clip, 'keys' | 'path'> | null>(null)
  const [noteEdit, setNoteEdit] = useState<{ id: string; note: string } | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [reversing, setReversing] = useState<number | null>(null)
  const [showScopes, setShowScopes] = useState(false)
  const [titlesOpen, setTitlesOpen] = useState(false)
  const [viewing, setViewing] = useState<Source | null>(null)
  const [viewAt, setViewAt] = useState<number | undefined>(undefined)
  // A screen recording: the screen recorder, and the webcam one beside it if the camera is on.
  const [screenRec, setScreenRec] = useState<{ stop: () => void } | null>(null)
  const [screenAsk, setScreenAsk] = useState(false)
  const [screenCam, setScreenCam] = useState(true)
  const [useProxies, setUseProxiesState] = useState(true)
  const [cached, setCached] = useState<[number, number] | null>(null)
  const [seqRename, setSeqRename] = useState<{ id: string; name: string } | null>(null)
  // Cutting between camera angles: the angle clips, the cuts made so far, and which angle is showing.
  const [mc, setMc] = useState<{ ids: string[]; cuts: Cut[]; angle: number; base: Project } | null>(null)
  const [boxFor, setBoxFor] = useState<string | null>(null) // drawing a box to track on this clip
  const [working, setWorking] = useState<{ what: string; f: number } | null>(null) // tracking or stabilising
  const [penFor, setPenFor] = useState<string | null>(null) // drawing a pen mask on this clip
  const penStarted = useRef<string | null>(null) // a new drawing starts with no points
  const [binOpen, setBinOpen] = useState(false)
  const [binFilter, setBinFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // A voiceover being recorded: where on the timeline it started, and the recorder.
  const [voice, setVoice] = useState<{ at: number; rec: MediaRecorder; stream: MediaStream } | null>(null)
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
  const [missing, setMissing] = useState<{ saved: Saved; ids: string[] } | null>(null)
  // Projects: the home screen lists them; currentId is the one open in the editor (null: on the home screen).
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [homeAsksName, setHomeAsksName] = useState(false)
  const createdAt = useRef(0)
  const [projectName, setProjectName] = useState('Untitled')
  const [renamingTop, setRenamingTop] = useState(false)
  const [fileHandle, setFileHandle] = useState<ProjectHandle | null>(null)
  // editor.postbarrel.com/?teleprompter opens straight on the teleprompter (the "Use the free teleprompter" link).
  const [mode, setMode] = useState<'edit' | 'prompt' | 'picture' | 'script'>(() => (new URLSearchParams(window.location.search).has('teleprompter') ? 'prompt' : 'edit'))
  // Web version: the one saved edit waiting for Carry on or Start new, the Start new question, and the browser note.
  const [restorable, setRestorable] = useState<Saved | null>(null)
  const [askNew, setAskNew] = useState(false)
  // Web version: the first screen, download the app or use the browser. Skipped by the ?teleprompter link.
  const [welcome, setWelcome] = useState(() => IS_WEB && !new URLSearchParams(window.location.search).has('teleprompter'))
  // Stickers to pick from, and freehand drawing on the preview.
  const [stickersOpen, setStickersOpen] = useState(false)
  const [drawingOn, setDrawingOn] = useState(false)
  const [collageOpen, setCollageOpen] = useState(false)
  const [browserNote, setBrowserNote] = useState(() => IS_WEB && !browserOk() && !browserNoteSeen())
  const [checked, setChecked] = useState<'waiting' | 'ok' | 'failed'>('waiting') // has the saved edit been looked for
  const [captioning, setCaptioning] = useState(false)
  // Ticked: a change to one caption's look, place or animation goes to every caption line (each keeps its words).
  const [capAll, setCapAll] = useState(true)
  const [autoBusy, setAutoBusy] = useState(false)
  // Pictures and sound wave for each opened file, filled in the background after it is added.
  const [overviews, setOverviews] = useState<Map<string, Overview>>(new Map())
  // Which sidebar sections are open. They fold away to leave room.
  // All closed until clicked.
  const [open, setOpen] = useState({ details: false, transform: false, light: false, sound: false, color: false, shape: true, text: false, lines: false, anim: false, border: false, speed: false,
    fx: false, key: false, blend: false, shade: false, lut: false, sfx: false, keys: false, tIn: false, mask: false, matte: false,
    track: false, follow: false, stab: false, straighten: false, fill: false,
  })
  const textRef = useRef<HTMLTextAreaElement>(null)
  // True after a press in the preview: the arrow keys nudge the selected box. A press anywhere else turns it off.
  const [nudging, setNudging] = useState(false)
  // Asking before a layer with clips on it is removed.
  const [confirmRemove, setConfirmRemove] = useState<{ kind: 'video' | 'audio'; index: number; name: string; count: number } | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const kHeld = useRef(false) // K is down: J and L step one frame
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
      // Web version: read by its contents, not its name. Only MP4 or MOV video, sound and pictures, up to 1 GB.
      let picture = isImageFile(file)
      if (IS_WEB) {
        const verdict = await checkFile(file)
        if (!verdict.ok) {
          setError(`${file.name}: ${verdict.reason}`)
          return
        }
        picture = verdict.kind === 'picture'
      }
      countUse(mode === 'picture' ? 'picture' : 'edit')
      if (picture) {
        // A picture: 5 seconds on a layer at the playhead, fitted to the frame.
        const { id, bitmap } = await loadImage(file)
        const clip: Clip = { id: newId('c'), kind: 'image', imageId: id, imageSize: [bitmap.width, bitmap.height], label: file.name, start: 0, in: 0, out: 5 }
        setHistory((h) => ({ past: [...h.past, h.present], present: placeOnLayer(h.present, clip, 'video', 1, playerRef.current?.now() ?? 0), future: [] }))
        setSelectedId(clip.id)
        return
      }
      if (mode === 'picture') {
        setError(`${file.name}: in the Picture tab, add photos. Videos and sound go in the Edit tab.`)
        return
      }
      const media = await openMedia(file)
      if (!media.videoTrack && !media.audioTrack) throw new Error("its picture and sound can't be decoded in this browser")
      if (IS_WEB && media.info.video && !/^(MP4|QuickTime)/i.test(media.info.format)) {
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
      // A video with keyframes far apart moves slowly when you drag the playhead, so a preview copy is made
      // in the background straight away (as Premiere and Resolve do with proxies). Export still uses the original.
      if (!IS_WEB && media.videoTrack) {
        longestKeyGap(media).then((gap) => {
          if (gap > SLOW_KEY_GAP) void makeProxyFor(source, `${file.name} is slow to move through (full pictures only every ${Math.round(gap)} seconds). Making a smooth preview copy`)
        }).catch(() => {})
      }
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
        types: [IS_WEB
          ? { description: 'MP4 or MOV video, sound or picture', accept: { 'video/*': ['.mp4', '.mov'], 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] } }
          : { description: 'Video, picture or sound', accept: { 'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.ts', '.avi'], 'audio/*': ['.mp3', '.wav', '.m4a', '.flac', '.ogg'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] } }],
      })
    } catch {
      return // closed the box
    }
    for (const h of handles) {
      try {
        await addFile(await h.getFile(), h)
      } catch (err) {
        setError(`${h.name} could not be opened: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Files dropped onto the editor from File Explorer are added like files picked with Media.
  const addFileRef = useRef(addFile)
  addFileRef.current = addFile
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      // Ask for the lasting pointers before the first await, while the drop is still readable
      const items = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file')
      const handles = items.map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<Handle | null> }).getAsFileSystemHandle?.())
      const files = items.map((i) => i.getAsFile())
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file) continue
        const handle = (await handles[i]?.catch(() => null)) ?? undefined
        await addFileRef.current(file, handle && (handle as { kind?: string }).kind === 'file' ? handle : undefined)
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // ---- Keeping your work ----
  function snapshot(): Saved {
    // Pictures used on any timeline, not only the one open now.
    const allTracks = [...project.video, ...project.audio, ...(project.sequences ?? []).flatMap((s) => [...s.video, ...s.audio])]
    const used = new Set([...allTracks.flatMap((t) => t.clips), ...allClips(project)].flatMap((c) => [
      c.imageId,
    ]).filter(Boolean))
    return {
      version: 1,
      savedAt: Date.now(),
      project,
      sources: sources.filter((src) => src.file).map((src) => ({ id: src.id, ...src.file! })),
      images: [...imageFiles].filter(([id]) => used.has(id)).map(([id, f]) => ({ id, ...f })),
      name: projectName,
    }
  }

  useEffect(() => {
    document.title = `${projectName} · Postbarrel Vid Editor`
  }, [projectName])

  // Writes the edit into its project file. If the file cannot be written, saving carries on in the browser only.
  async function writeToFile(h: ProjectHandle, snap: Saved) {
    try {
      await writeProjectFile(h, snap)
    } catch (err) {
      setFileHandle(null)
      setError(`Could not save into ${h.name} (${err instanceof Error ? err.message : String(err)}). Your work is still kept in this browser; press Save to pick the file again.`)
    }
  }

  // A small picture of the edit for its card on the home screen.
  function thumbnail(): string | undefined {
    const c = previewRef.current
    if (!c || !c.width || projectDuration(project) === 0) return undefined
    const t = document.createElement('canvas')
    t.height = 180
    t.width = Math.round((180 * c.width) / c.height)
    t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height)
    return t.toDataURL('image/jpeg', 0.7)
  }

  // Saves the open project now: into its place in the project list, and into its .edit file if it has one.
  async function saveNow() {
    if (!currentId || missing) return
    const snap = snapshot()
    const old = await getProject(currentId).catch(() => undefined)
    // A version every ten minutes of work, newest first, twenty at most.
    let versions = old?.versions ?? []
    if (old && (!versions.length || snap.savedAt - versions[0].at > 10 * 60_000) && old.saved.project.video.some((t) => t.clips.length)) {
      versions = [{ at: old.savedAt, project: old.saved.project, sources: old.saved.sources }, ...versions].slice(0, 20)
    }
    await putProject({
      id: currentId, name: projectName, createdAt: createdAt.current || snap.savedAt, savedAt: snap.savedAt,
      thumb: thumbnail() ?? old?.thumb, saved: snap, file: fileHandle ?? undefined, versions,
    })
    setSavedAt(snap.savedAt)
    if (fileHandle) await writeToFile(fileHandle, snap)
  }

  // Saves a second after each change.
  useEffect(() => {
    // Web version: one edit, saved in this browser; never over a saved edit the person has not decided about.
    if (IS_WEB) {
      if (checked !== 'ok' || restorable || missing || loading) return
      if (projectDuration(project) === 0 && !project.script) return
      const t = setTimeout(() => {
        const s = snapshot()
        saveAutosave(s).then(() => setSavedAt(s.savedAt)).catch(() => {})
      }, 1000)
      return () => clearTimeout(t)
    }
    // Never write until the projects have been read, and never while files are missing.
    if (checked !== 'ok' || !currentId || missing || loading) return
    const t = setTimeout(() => { saveNow().catch(() => {}) }, 1000)
    return () => clearTimeout(t)
  })

  const refreshProjects = () => listProjects().then(setProjects).catch(() => {})

  // On opening the editor: read the project list (an older single autosave becomes the first project).
  useEffect(() => {
    if (IS_WEB) {
      // Web version: is there an edit to bring back?
      loadAutosave()
        .then((s) => {
          if (s && s.project && (layout(s.project).length || s.project.script)) setRestorable(s)
          setChecked('ok')
        })
        .catch((err) => {
          setChecked('failed')
          setError(`Autosave is off: the saved edit could not be read (${err instanceof Error ? err.message : String(err)}). Reload to try again.`)
        })
      return
    }
    moveOldAutosave()
      .catch(() => {})
      .then(() => listProjects())
      .then((list) => {
        setProjects(list)
        setChecked('ok')
      })
      .catch((err) => {
        setChecked('failed')
        setError(`Your projects could not be read (${err instanceof Error ? err.message : String(err)}). Reload to try again.`)
      })
  }, [])

  // Brings a saved edit back: pictures from the save, videos and sound from where they are on the PC.
  async function restore(saved: Saved, extra?: Map<string, File>): Promise<'ok' | 'missing' | 'failed'> {
    setLoading(true)
    setError(null)
    try {
      reserveIdsIn(saved)
      for (const im of saved.images) await restoreImage(im.id, im.name, im.type, im.data)
      for (const [lid, data] of Object.entries(saved.project.lotties ?? {})) {
        try { loadLottie(lid, data) } catch { /* a broken animation shows as an empty picture */ }
      }
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
        // Web version: files brought back go through the same check as new ones.
        if (IS_WEB && file && !(await checkFile(file)).ok) file = null
        if (!file) {
          lost.push(src.id)
          continue
        }
        const media = await openMedia(file)
        if (IS_WEB && media.info.video && !/^(MP4|QuickTime)/i.test(media.info.format)) {
          lost.push(src.id)
          continue
        }
        const source: Source = { id: src.id, name: src.name, media, file: { name: src.name, size: src.size, lastModified: src.lastModified } }
        // Its preview copy, if one was made before.
        const proxyFile = (await findCopy(keyOf(src))) ?? (await takeFor(`proxy:${keyOf(src)}`).catch(() => undefined)) // older copies were kept with the takes
        if (proxyFile) source.proxy = await openMedia(new File([proxyFile], `${src.name} (preview copy).mp4`, { type: 'video/mp4' })).catch(() => undefined)
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
      setHistory({ past: [], present: toEdit(saved.project), future: [] })
      setSelectedId(null)
      setMissing(null)
      setRestorable(null)
      setProjectName(saved.name || 'Untitled')
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
    const leftover: { f: File; h: Handle }[] = []
    for (const h of handles) {
      const f = await h.getFile()
      const src = missing.saved.sources.find((x) => missing.ids.includes(x.id) && x.name === f.name && x.size === f.size)
        ?? missing.saved.sources.find((x) => missing.ids.includes(x.id) && x.name === f.name)
      if (src) {
        found.set(src.id, f)
        rememberHandle(keyOf(src), h).catch(() => {})
      } else leftover.push({ f, h })
    }
    // A file that was renamed: if exactly one file is still missing and exactly one picked file matched
    // nothing, they are the same file under a new name.
    const still = missing.ids.filter((id) => !found.has(id))
    if (still.length === 1 && leftover.length === 1) {
      const src = missing.saved.sources.find((x) => x.id === still[0])!
      found.set(src.id, leftover[0].f)
      rememberHandle(keyOf({ name: leftover[0].f.name, size: leftover[0].f.size, lastModified: leftover[0].f.lastModified }), leftover[0].h).catch(() => {})
    }
    await restore(missing.saved, found)
  }

  const saveTypes = [{ description: 'Postbarrel Vid Editor project', accept: { 'application/json': ['.edit'] } }]
  const savePicker = () => (window as unknown as { showSaveFilePicker?: (o: object) => Promise<ProjectHandle> }).showSaveFilePicker
  const fileName = (h: { name: string }) => h.name.replace(/\.edit$/i, '') || 'Untitled'

  // Save: into the project file if there is one, otherwise ask where (and keep saving there from now on).
  async function saveProjectFile() {
    if (fileHandle) {
      const snap = snapshot()
      await writeToFile(fileHandle, snap)
      setSavedAt(snap.savedAt)
      return
    }
    const picker = savePicker()
    if (!picker) return
    try {
      const h = await picker({ suggestedName: `${projectName}.edit`, types: saveTypes })
      const snap = snapshot()
      await writeProjectFile(h, snap)
      setFileHandle(h)
      setSavedAt(snap.savedAt)
    } catch { /* closed the box */ }
  }

  // Open a .edit file: it joins the project list, opens, and keeps saving back into the file.
  async function openProjectFile() {
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<ProjectHandle[]> }).showOpenFilePicker
    if (!picker) return
    try {
      const [h] = await picker({ types: saveTypes })
      const saved = await fromProjectFile(await (await h.getFile()).text())
      const name = saved.name || fileName(h)
      const id = newProjectId()
      const now = Date.now()
      await putProject({ id, name, createdAt: now, savedAt: now, saved: { ...saved, name }, file: h })
      await saveNow().catch(() => {})
      await openProject(id)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') setError(`Could not open the project: ${err.message}`)
    }
  }

  // Empties the editor, ready for another project.
  function resetEditor() {
    playerRef.current?.pause()
    setHistory({ past: [], present: emptyProject(), future: [] })
    setSources([])
    setSelectedId(null)
    setMissing(null)
    setSavedAt(null)
    setFileHandle(null)
    setMode('edit')
    playerRef.current?.seek(0)
  }

  // Web version, New: an empty edit. The old one is not kept (the web version keeps one edit at a time).
  function startNew() {
    resetEditor()
    setRestorable(null)
    setAskNew(false)
    clearAutosave().catch(() => {})
  }

  async function newProject(name: string, template = 'blank') {
    resetEditor()
    const id = newProjectId()
    const now = Date.now()
    const start = template === 'blank' ? emptyProject() : startFrom(template)
    await putProject({ id, name, createdAt: now, savedAt: now, saved: { version: 1, savedAt: now, name, project: start, sources: [], images: [] } })
    setHistory({ past: [], present: start, future: [] })
    createdAt.current = now
    setProjectName(name)
    setCurrentId(id)
  }

  // Going back to an earlier version: the one there now is kept as a version first, so it can be got back too.
  async function restoreVersion(id: string, index: number) {
    const rec = await getProject(id)
    const v = rec?.versions?.[index]
    if (!rec || !v) return
    const now = Date.now()
    const keep = { at: rec.savedAt, project: rec.saved.project, sources: rec.saved.sources }
    const sources = [...rec.saved.sources, ...v.sources.filter((s) => !rec.saved.sources.some((x) => x.id === s.id))]
    // The one there now is kept, unless the newest version already is exactly it.
    const same = JSON.stringify(rec.versions![0]?.project) === JSON.stringify(keep.project)
    await putProject({ ...rec, savedAt: now, saved: { ...rec.saved, savedAt: now, project: v.project, sources }, versions: (same ? rec.versions! : [keep, ...rec.versions!]).slice(0, 20) })
    await refreshProjects()
    await openProject(id)
  }

  async function openProject(id: string) {
    const rec = await getProject(id)
    if (!rec) return
    resetEditor()
    createdAt.current = rec.createdAt
    // The project only becomes the open one once it has been read back, so autosave never writes a half-read edit.
    const result = await restore({ ...rec.saved, name: rec.name })
    if (result === 'failed') return
    setCurrentId(id)
    setProjectName(rec.name)
    // It keeps saving into its .edit file too, once the person says yes (this runs from their click).
    if (rec.file && (await canWrite(rec.file))) setFileHandle(rec.file)
  }

  async function goHome() {
    await saveNow().catch(() => {})
    resetEditor()
    setCurrentId(null)
    setProjectName('Untitled')
    await refreshProjects()
  }

  async function renameProject(id: string, name: string) {
    const rec = await getProject(id)
    if (rec) await putProject({ ...rec, name, saved: { ...rec.saved, name } })
    if (id === currentId) setProjectName(name)
    await refreshProjects()
  }

  async function duplicateProject(id: string) {
    const rec = await getProject(id)
    if (!rec) return
    const now = Date.now()
    const name = `${rec.name} copy`
    await putProject({ ...rec, id: newProjectId(), name, createdAt: now, savedAt: now, file: undefined, saved: { ...rec.saved, name } })
    await refreshProjects()
  }

  async function removeProject(id: string) {
    await deleteProject(id)
    await refreshProjects()
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

  function captionsMade(made: Line[]) {
    // The speech model can stretch the last word past the end of the sound it heard: no caption runs past the edit.
    const end = duration
    const lines = made
      .filter((l) => l.start < end - 0.05)
      .map((l) => ({ ...l, end: Math.min(l.end, end), words: l.words?.filter((w) => w.start < end).map((w) => ({ ...w, end: Math.min(w.end, end) })) }))
    const { project: next, firstId } = addCaptionLayer(project, frame, lines)
    commit(next)
    setSelectedId(firstId)
    setOpen((o) => ({ ...o, lines: true }))
    setCaptioning(false)
  }
  // Saves the caption lines as an .srt file, the standard subtitle file.
  async function saveSrt(group: string, vtt = false) {
    const srt = vtt ? toVtt(project, group) : toSrt(project, group)
    const ext = vtt ? 'vtt' : 'srt'
    const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker
    try {
      if (picker) {
        const h = await picker({ suggestedName: `captions.${ext}`, types: [{ description: 'Subtitles', accept: vtt ? { 'text/vtt': ['.vtt'] } : { 'application/x-subrip': ['.srt'] } }] })
        const w = await h.createWritable()
        await w.write(srt)
        await w.close()
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([srt], { type: vtt ? 'text/vtt' : 'application/x-subrip' }))
        a.download = `captions.${ext}`
        a.click()
      }
    } catch { /* closed the save box */ }
  }

  // ---- The rail's extra menus (the small arrow on Media, Text, Captions, Layer and Sound) ----

  const playhead = () => playerRef.current?.now() ?? time

  function addAdjustment() {
    const clip: Clip = { id: newId('c'), kind: 'adjust', start: 0, in: 0, out: 5, look: { ...NEUTRAL } }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playhead()))
    setSelectedId(clip.id)
    setOpen((o) => ({ ...o, light: true }))
  }

  function addCountdown() {
    const t = playhead()
    let next = project
    const track = project.video.length
    let first: string | null = null
    for (const [i, n] of ['3', '2', '1'].entries()) {
      const clip: Clip = {
        id: newId('c'), kind: 'text', start: 0, in: 0, out: 1,
        text: { ...DEFAULT_TEXT, text: n, size: 320, outlineWidth: 14 },
        transform: { x: frame.w / 2, y: frame.h / 2, w: frame.w * 0.6, h: 0, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
        anim: { in: 'pop', out: 'fade', duration: 0.3 },
      }
      next = placeOnLayer(next, clip, 'video', track, t + i)
      first ??= clip.id
    }
    commit(next)
    setSelectedId(first)
  }

  function addCredits() {
    const clip: Clip = {
      id: newId('c'), kind: 'text', start: 0, in: 0, out: 10,
      text: { ...DEFAULT_TEXT, text: 'Thanks for watching\n\nMade by\nYour name\n\nMusic\nSong name, artist\n\nFootage\nWhere it came from', size: 64, outlineWidth: 6, bold: false },
      transform: { x: frame.w / 2, y: frame.h / 2, w: frame.w * 0.8, h: 0, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
      anim: { in: 'none', out: 'none', duration: 0.4, during: 'rollUp' },
    }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playhead()))
    setSelectedId(clip.id)
    editText()
  }

  function addBrandText() {
    const b = loadBrand()
    const clip: Clip = { id: newId('c'), kind: 'text', start: 0, in: 0, out: 5, text: { ...DEFAULT_TEXT, font: b.font, color: b.colors[0], outlineColor: b.colors[2], wordColor: b.colors[1] } }
    commit(placeOnLayer(project, clip, 'video', 1, playhead()))
    setSelectedId(clip.id)
    editText()
  }

  async function addLogo() {
    const b = loadBrand()
    if (!b.logo) {
      setBrandOpen(true)
      return
    }
    const blob = await (await fetch(b.logo.data)).blob()
    const { id, bitmap } = await loadImage(new File([blob], b.logo.name, { type: blob.type }))
    const w = frame.w * 0.22
    const h = (w * bitmap.height) / bitmap.width
    const clip: Clip = {
      id: newId('c'), kind: 'image', imageId: id, imageSize: [bitmap.width, bitmap.height], label: b.logo.name, start: 0, in: 0, out: 5,
      transform: { x: frame.w - w / 2 - frame.w * 0.05, y: h / 2 + frame.w * 0.08, w, h, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
    }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playhead()))
    setSelectedId(clip.id)
  }

  async function importSubtitles() {
    const file = await new Promise<File | null>((ok) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.srt,.vtt'
      input.onchange = () => ok(input.files?.[0] ?? null)
      input.click()
    })
    if (!file) return
    const lines = fromSubtitles(await file.text())
    if (!lines.length) {
      setError(`No caption lines could be read from ${file.name}.`)
      return
    }
    captionsMade(lines)
  }

  function setWordMode(group: string, wordMode: 'off' | 'highlight' | 'single') {
    let next = project
    for (const pl of captionLines(project, group)) {
      const t = pl.clip.text
      if (t) next = updateClip(next, pl.clip.id, { text: { ...t, wordMode, wordColor: t.wordColor ?? loadBrand().colors[1] ?? '#f5e642' } })
    }
    commit(next)
  }

  // A voiceover: the timeline plays from the playhead while the microphone records; on Stop it lands
  // on a sound track where it started.
  async function startVoiceover() {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setError('The microphone could not be opened. Check that it is plugged in and allowed.')
      return
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const at = playhead()
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      playerRef.current?.pause()
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const n = (project.audio.flatMap((t) => t.clips).length) + 1
      const file = new File([blob], `Voiceover ${n}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type, lastModified: Date.now() })
      await playerRef.current?.seek(at)
      await addFile(file)
      saveTake(keyOf(file), file).catch(() => setError('The voiceover is on the timeline but could not be kept in this browser.'))
      setVoice(null)
    }
    rec.start(1000)
    setVoice({ at, rec, stream })
    playerRef.current?.play()
  }
  function stopVoiceover() {
    if (voice && voice.rec.state !== 'inactive') voice.rec.stop()
  }

  // Loudness: the whole mix is measured the way the platforms measure it, then every clip's volume moves
  // by the same amount so the mix lands on the target.
  async function setLoudness(target: number) {
    setError(null)
    setNotice('Measuring how loud the whole edit is…')
    try {
      const meter = loudnessMeter(48000)
      await renderAudio({ add: async (b) => meter.push(b) }, project, sources, duration, new AbortController().signal, () => {})
      const { lufs, peak } = meter.result()
      if (!Number.isFinite(lufs)) {
        setNotice(null)
        setError('There is no sound to measure.')
        return
      }
      const gain = Math.pow(10, (target - lufs) / 20)
      let next = project
      // Volume goes up to 200%. If a clip needs more than that it stops there, and the edit lands short.
      let least = gain
      for (const pl of layout(project)) {
        if (pl.clip.kind !== 'media') continue
        const was = pl.clip.volume ?? 1
        const now = Math.min(2, was * gain)
        least = Math.min(least, now / was)
        next = updateClip(next, pl.clip.id, { volume: Math.round(now * 100) / 100 })
      }
      commit(next)
      const reached = lufs + 20 * Math.log10(least)
      const short = target - reached > 0.5
      setNotice(
        `It measured ${lufs.toFixed(1)} LUFS.` +
        (short
          ? ` The clips are now at their highest volume, which gets it to about ${reached.toFixed(1)} LUFS, ${(target - reached).toFixed(1)} short of ${target}. To go further, add a Sound effect to the voice with "Even out" turned up and "Never too loud" on, then run this again.`
          : ` Every clip's volume moved by ${(20 * Math.log10(gain)).toFixed(1)} dB, so it is now about ${target} LUFS.`) +
        (!short && peak * gain > 1 ? ' The loudest moments may clip: add a Sound effect with "Never too loud" on the main clips.' : ''),
      )
    } catch (err) {
      setNotice(null)
      setError(`Could not measure the loudness: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function railMenu(which: 'media' | 'text' | 'captions' | 'block' | 'layer' | 'sound', x: number, y: number) {
    const t = playhead()
    const showing = showingPictures(project, t).length
    const capGroup = selected?.caption ?? layout(project).find((pl) => pl.clip.caption)?.clip.caption ?? null
    const hasWords = !!capGroup && captionLines(project, capGroup).some((pl) => pl.clip.words?.length)
    const items: MenuItem[] =
      which === 'media' ? [
        { label: 'Add video, picture or sound…', onClick: pickFiles },
        { label: 'Media list', hint: 'every file in this edit, with tags', onClick: () => setBinOpen(true) },
        { label: 'Slideshow from photos…', hint: '3 s each, slow zoom, cross fades', onClick: pickSlideshow },
        { label: 'Add a Lottie animation…', hint: '.json from LottieFiles', onClick: addLottie },
        { label: 'Record the screen…', hint: 'with your webcam if you like', disabled: !!screenRec, onClick: () => setScreenAsk(true) },
        'line',
        { label: 'Make preview copies', hint: 'smoother editing of big or slow-to-seek videos', onClick: makeProxies },
        { label: 'Play with preview copies', checked: useProxies, onClick: () => { const on = !useProxies; setUseProxiesState(on); playerRef.current?.setUseProxies(on) } },
      ] : which === 'text' ? [
        { label: 'Text', onClick: addText },
        { label: 'Title templates…', hint: 'lower third, subscribe, quote…', onClick: () => setTitlesOpen(true) },
        { label: 'Text in my brand', onClick: addBrandText },
        { label: 'Add my logo', hint: loadBrand().logo ? undefined : 'set it in Brand kit', onClick: addLogo },
        { label: 'Countdown 3, 2, 1', onClick: addCountdown },
        { label: 'Credits roll', onClick: addCredits },
        'line',
        { label: 'Brand kit…', hint: 'font, colours, logo', onClick: () => setBrandOpen(true) },
      ] : which === 'captions' ? [
        { label: 'Make captions from the voice…', disabled: duration === 0, onClick: () => { playerRef.current?.pause(); setCaptioning(true) } },
        { label: 'Import an SRT or VTT file…', onClick: importSubtitles },
        'line',
        { label: 'Word by word: highlight the word being said', disabled: !hasWords, hint: hasWords ? undefined : 'make captions first', onClick: () => setWordMode(capGroup!, 'highlight') },
        { label: 'Word by word: one word at a time', disabled: !hasWords, onClick: () => setWordMode(capGroup!, 'single') },
        { label: 'Word by word: off', disabled: !hasWords, onClick: () => setWordMode(capGroup!, 'off') },
        'line',
        { label: 'Save captions as SRT', disabled: !capGroup, onClick: () => saveSrt(capGroup!) },
        { label: 'Save captions as VTT', disabled: !capGroup, onClick: () => saveSrt(capGroup!, true) },
      ] : which === 'block' ? [
        { label: 'Colour block', hint: 'a plain block, black to start with', onClick: addColourBlock },
        { label: 'Emoji and stickers…', onClick: () => setStickersOpen(true) },
        { label: 'Draw…', hint: 'freehand, with the mouse', onClick: () => { setSelectedId(null); setDrawingOn(true) } },
        'line',
        ...SHAPES.map((k) => ({ label: k.label, onClick: () => addShape(k.id) }) as MenuItem),
      ] : which === 'layer' ? [
        { label: 'New empty layer', onClick: () => commit(addTrack(project, 'video')) },
        { label: 'Adjustment layer', hint: 'changes everything under it', onClick: addAdjustment },
        'line',
        ...LAYOUTS.map((l) => ({
          label: l.label, disabled: showing < l.needs, hint: showing < l.needs ? `needs ${l.needs} pictures at the playhead` : undefined,
          onClick: () => commit(applyLayout(project, sources, t, l.id)),
        }) as MenuItem),
      ] : [
        { label: 'New empty sound track', onClick: () => commit(addTrack(project, 'audio')) },
        { label: 'Record a voiceover from the playhead', hint: 'headphones stop echo', disabled: !!voice, onClick: startVoiceover },
        'line',
        { label: 'Loudness for TikTok, Reels and YouTube', hint: '-14 LUFS', disabled: duration === 0, onClick: () => setLoudness(-14) },
        { label: 'Loudness for podcasts', hint: '-16 LUFS', disabled: duration === 0, onClick: () => setLoudness(-16) },
      ]
    setMenu({ x, y, items })
  }

  // The media list: every file in this edit, with the person's own tags, and a way to put one on again.
  function addAgain(id: string, kind: 'source' | 'image') {
    if (kind === 'image') {
      const bmp = imageStore.get(id)
      if (!bmp) return
      const clip: Clip = { id: newId('c'), kind: 'image', imageId: id, imageSize: [bmp.width, bmp.height], label: imageFiles.get(id)?.name, start: 0, in: 0, out: 5 }
      commit(placeOnLayer(project, clip, 'video', 1, playhead()))
      setSelectedId(clip.id)
      return
    }
    const src = sources.find((s) => s.id === id)
    if (!src) return
    const clip: Clip = { id: newId('c'), kind: 'media', sourceId: src.id, start: 0, in: 0, out: src.media.info.duration }
    commit(src.media.videoTrack ? appendToMain(project, clip) : placeOnLayer(project, clip, 'audio', 0, playhead()))
    setSelectedId(clip.id)
  }

  // A shape on a layer at the playhead, in the middle of the frame, ready to move and resize.
  function addShape(kind: ShapeKind) {
    const clip: Clip = { id: newId('c'), kind: 'shape', shape: defaultShape(kind), transform: shapeBox(project.frame, kind), start: 0, in: 0, out: 5 }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playerRef.current?.now() ?? 0))
    setSelectedId(clip.id)
    setOpen((o) => ({ ...o, shape: true }))
  }

  // A sticker: an emoji as big text, in the middle of the frame, on a layer at the playhead.
  function addSticker(emoji: string) {
    const clip: Clip = {
      id: newId('c'), kind: 'text', start: 0, in: 0, out: 5,
      text: { ...DEFAULT_TEXT, text: emoji, size: 280, outlineWidth: 0, bold: false },
      transform: { x: frame.w / 2, y: frame.h / 2, w: frame.w * 0.5, h: 0, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
    }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playerRef.current?.now() ?? 0))
    setSelectedId(clip.id)
    setStickersOpen(false)
  }

  // Collage: a background colour, then each photo filling its box, each on its own layer.
  async function makeCollage(files: File[], layoutId: string, gap: number, background: string) {
    setCollageOpen(false)
    setLoading(true)
    setError(null)
    try {
      const cells = COLLAGES.find((c) => c.id === layoutId)!.cells
      let next = project
      const bg: Clip = { id: newId('c'), kind: 'color', color: background, start: 0, in: 0, out: 5, transform: fitTransform(frame, frame.w, frame.h) }
      next = placeOnLayer(next, bg, 'video', next.video.length, 0)
      for (const [i, file] of files.entries()) {
        if (IS_WEB) {
          const v = await checkFile(file)
          if (!v.ok || v.kind !== 'picture') { setError(`${file.name}: ${v.ok ? 'only pictures go in a collage' : v.reason}`); continue }
        }
        const { id, bitmap } = await loadImage(file)
        const clip: Clip = { id: newId('c'), kind: 'image', imageId: id, imageSize: [bitmap.width, bitmap.height], label: file.name, start: 0, in: 0, out: 5,
          transform: cellTransform(frame, cells[i], gap, bitmap.width, bitmap.height) }
        next = placeOnLayer(next, clip, 'video', next.video.length, 0)
      }
      commit(next)
    } catch (err) {
      setError(`Could not make the collage: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // Slideshow: photos on the end of the main track, 3 seconds each, filling the frame, with a slow zoom (in, then
  // out, in turn) and a cross fade between them.
  function pickSlideshow() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => { if (input.files?.length) makeSlideshow([...input.files]) }
    input.click()
  }
  async function makeSlideshow(files: File[]) {
    setLoading(true)
    setError(null)
    try {
      let next = project
      let first = !layout(next).some((pl) => pl.kind === 'video' && pl.trackIndex === 0)
      for (const [i, file] of files.entries()) {
        if (IS_WEB) {
          const v = await checkFile(file)
          if (!v.ok || v.kind !== 'picture') { setError(`${file.name}: ${v.ok ? 'only pictures go in a slideshow' : v.reason}`); continue }
        }
        const { id, bitmap } = await loadImage(file)
        const clip: Clip = {
          id: newId('c'), kind: 'image', imageId: id, imageSize: [bitmap.width, bitmap.height], label: file.name, start: 0, in: 0, out: 3,
          transform: fitTransform(frame, bitmap.width, bitmap.height, 'fill'),
          anim: { in: 'none', out: 'none', duration: 0.6, during: i % 2 ? 'zoomOut' : 'zoomIn' },
          ...(first ? {} : { tIn: { type: 'dissolve' as const, d: 0.6 } }),
        }
        first = false
        next = appendToMain(next, clip)
      }
      commit(next)
      setNotice(`Slideshow: ${files.length} photo${files.length === 1 ? '' : 's'} on the main track, 3 seconds each.`)
    } catch (err) {
      setError(`Could not make the slideshow: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // A freehand stroke becomes a drawing on its own layer.
  function addStroke(points: [number, number][]) {
    const { style, box } = drawingFrom(points, '#facc15', Math.max(6, Math.round(frame.w / 80)))
    const clip: Clip = {
      id: newId('c'), kind: 'shape', shape: style, start: 0, in: 0, out: 5,
      transform: { ...box, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: false, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
    }
    commit(placeOnLayer(project, clip, 'video', project.video.length, playerRef.current?.now() ?? 0))
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
  const showingSelected = selectedPl && selectedPl.kind === 'video' && selectedPl.clip.kind !== 'adjust' && !project.video[selectedPl.trackIndex]?.hidden && time >= selectedPl.start - 1e-6 && time < selectedPl.end
  // Seconds into the selected clip at the playhead: keyframed boxes are shown, and changed, where they are now.
  const selLocal = selectedPl ? Math.max(0, Math.min(selectedPl.end - selectedPl.start, time - selectedPl.start)) : 0
  const followPt = selected?.follow ? trackedPoint(project, sources, selected.follow.clip, time, sampleAt) : null
  const selectedTransform = selected && selectedPl?.kind === 'video'
    ? (() => {
        const t = transformAt(frame, sources, selected, selLocal)
        return followPt && selected.follow ? { ...t, x: followPt.x + selected.follow.ox, y: followPt.y + selected.follow.oy } : t
      })()
    : null

  function updateSel(p: Project, patch: Partial<Clip>): Project {
    const sel = selectedId ? findPlaced(p, selectedId)?.clip : null
    if (!sel) return p
    if (!sel.caption || !capAll) return updateClip(p, sel.id, patch)
    let next = p
    for (const pl of captionLines(p, sel.caption)) {
      const own = { ...patch }
      // The selected line takes the change as typed; the others take the look but keep their own words.
      if (patch.text && pl.clip.id !== sel.id) own.text = { ...patch.text, text: pl.clip.text?.text ?? '' }
      next = updateClip(next, pl.clip.id, own)
    }
    return next
  }

  // A change in the Sound panel goes to every picked clip that has sound, not just the first one.
  // Fades are kept to half of each clip's own length.
  function updateSound(p: Project, patch: Partial<Clip>): Project {
    const ids = selection(p).filter((id) => {
      const c = findPlaced(p, id)?.clip
      return c?.kind === 'media' && !!sources.find((s) => s.id === c.sourceId)?.media.audioTrack
    })
    if (ids.length < 2) return updateSel(p, patch)
    let next = p
    for (const id of ids) {
      const pl = findPlaced(next, id)
      if (!pl) continue
      const half = (pl.end - pl.start) / 2
      const own = { ...patch }
      if (own.fadeIn !== undefined) own.fadeIn = Math.min(own.fadeIn, half)
      if (own.fadeOut !== undefined) own.fadeOut = Math.min(own.fadeOut, half)
      next = updateClip(next, id, own)
    }
    return next
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

  // The selected clip, any Ctrl+clicked ones, and everything grouped with them.
  function selection(p: Project = project): string[] {
    const ids = new Set<string>()
    for (const id of [selectedId, ...extraIds]) if (id) for (const g of groupOf(p, id)) ids.add(g)
    return [...ids]
  }

  // Delete removes; ripple also closes the gap each one leaves on its layer. Clips on locked tracks stay.
  function remove(ripple = false, targets = selection()) {
    const ids = targets.filter((id) => !isLocked(project, id))
    if (!ids.length) return
    // Latest first, so pulling one clip's followers left never moves a clip still to be deleted.
    const order = ids.map((id) => findPlaced(project, id)!).sort((a, b) => b.start - a.start)
    let next = project
    for (const pl of order) next = ripple ? rippleDelete(next, pl.clip.id) : removeClip(next, pl.clip.id)
    commit(pruneEmptyTracks(next))
    setSelectedId(null)
  }

  // ---- The right-click menus ----

  // Freeze frame: the picture at the playhead held for two seconds, cut into the clip at that point.
  async function freezeFrame(id: string) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((x) => x.id === pl.clip.sourceId) : null
    const track = src?.media.videoTrack
    if (!pl || !src || !track) return
    const t = Math.min(pl.end - 1e-3, Math.max(pl.start, playerRef.current?.now() ?? time))
    setLoading(true)
    try {
      const shot = await new CanvasSink(track).getCanvas(sourceAt(pl.clip, t - pl.start))
      if (!shot) throw new Error('that frame could not be read')
      const c = shot.canvas
      const blob = c instanceof OffscreenCanvas ? await c.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((ok, no) => (c as HTMLCanvasElement).toBlob((b) => (b ? ok(b) : no(new Error('no picture'))), 'image/png'))
      const imgId = newId('img')
      const bitmap = await createImageBitmap(blob)
      imageStore.set(imgId, bitmap)
      imageFiles.set(imgId, { name: 'Freeze frame.png', type: 'image/png', data: blob })
      const still: Clip = {
        id: newId('c'), kind: 'image', imageId: imgId, imageSize: [bitmap.width, bitmap.height], label: 'Freeze frame', start: 0, in: 0, out: 2,
        transform: transformOf(project.frame, sources, pl.clip), look: pl.clip.look, border: pl.clip.border,
      }
      let next: Project
      if (t - pl.start < 0.1) {
        // At the very start: the still goes in front of the clip.
        if (pl.kind === 'video' && pl.trackIndex === 0) {
          next = { ...project, video: project.video.map((tr, i) => (i ? tr : { ...tr, clips: tr.clips.flatMap((c) => (c.id === id ? [still, c] : [c])) })) }
        } else {
          next = shiftAfter(project, pl.kind, pl.trackIndex, pl.start, 2)
          next = placeOnLayer(next, still, pl.kind, pl.trackIndex, pl.start)
        }
      } else if (pl.end - t < 0.1) {
        next = insertAfter(project, id, still)
      } else {
        const cut = splitClip(project, id, t)
        const left = layout(cut).find((x) => x.kind === pl.kind && x.trackIndex === pl.trackIndex && Math.abs(x.end - t) < 1e-6)
        next = left ? insertAfter(cut, left.clip.id, still) : cut
      }
      commit(next)
      setSelectedId(still.id)
    } catch (err) {
      setError(`Could not make a freeze frame: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // Replace: a different file in the clip's place, keeping its length, look, position and everything else.
  async function replaceClip(id: string) {
    const pl = findPlaced(project, id)
    if (!pl) return
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<Handle[]> }).showOpenFilePicker
    let file: File
    let handle: Handle | undefined
    try {
      if (picker) {
        const [h] = await picker({ multiple: false, types: [{ description: pl.clip.kind === 'image' ? 'Picture' : 'Video or sound', accept: pl.clip.kind === 'image' ? { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] } : { 'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.ts', '.avi'], 'audio/*': ['.mp3', '.wav', '.m4a', '.flac', '.ogg'] } }] })
        handle = h
        file = await h.getFile()
      } else {
        file = await new Promise<File>((ok, no) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.onchange = () => (input.files?.[0] ? ok(input.files[0]) : no(new Error('none')))
          input.click()
        })
      }
    } catch {
      return // closed the box
    }
    setError(null)
    setLoading(true)
    try {
      if (pl.clip.kind === 'image') {
        if (!isImageFile(file)) throw new Error('a picture can only be replaced with a picture')
        const { id: imgId, bitmap } = await loadImage(file)
        commit(updateClip(project, id, { imageId: imgId, imageSize: [bitmap.width, bitmap.height], label: file.name }))
        return
      }
      const media = await openMedia(file)
      if (pl.kind === 'video' && !media.videoTrack) throw new Error('a video clip needs a file with a picture')
      if (!media.audioTrack && !media.videoTrack) throw new Error("its picture and sound can't be decoded in this browser")
      const fileKey = { name: file.name, size: file.size, lastModified: file.lastModified }
      const source: Source = { id: newId('s'), name: file.name, media, file: fileKey }
      if (handle) rememberHandle(keyOf(fileKey), handle).catch(() => {})
      setSources((x) => [...x, source])
      buildOverview(source, (o) => setOverviews((m) => new Map(m).set(source.id, o))).catch(() => {})
      // Same length if the new file is long enough, starting at the same point if it can.
      const len = pl.clip.out - pl.clip.in
      const dur = media.info.duration
      const inP = Math.max(0, Math.min(pl.clip.in, dur - len))
      commit(updateClip(project, id, { sourceId: source.id, in: inP, out: Math.min(dur, inP + len) }))
    } catch (err) {
      setError(`Could not replace it with ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // Reverse: a reversed copy of the clip's stretch is made on this PC and takes the clip's place (undo puts the original back).
  async function reverseClip(id: string) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((s) => s.id === pl.clip.sourceId) : null
    if (!pl || !src) return
    setError(null)
    setReversing(0)
    try {
      const blob = await reverseRange(src.media, pl.clip.in, pl.clip.out, setReversing)
      const file = new File([blob], `${src.name.replace(/\.[^.]+$/, '')} reversed ${Math.round(pl.clip.in)}s.mp4`, { type: 'video/mp4', lastModified: Date.now() })
      const media = await openMedia(file)
      const fileKey = { name: file.name, size: file.size, lastModified: file.lastModified }
      const source: Source = { id: newId('s'), name: file.name, media, file: fileKey }
      setSources((x) => [...x, source])
      buildOverview(source, (o) => setOverviews((m) => new Map(m).set(source.id, o))).catch(() => {})
      saveTake(keyOf(fileKey), file).catch(() => setError('The reversed clip is in place but could not be kept in this browser.'))
      commit(updateClip(project, id, { sourceId: source.id, in: 0, out: media.info.duration, ramp: undefined }))
    } catch (err) {
      setError(`Could not reverse it: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReversing(null)
    }
  }

  // A Lottie animation: kept inside the project, placed on a layer at the playhead like a moving picture.
  async function addLottie() {
    const file = await new Promise<File | null>((ok) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.lottie.json'
      input.onchange = () => ok(input.files?.[0] ?? null)
      input.click()
    })
    if (!file) return
    try {
      if (file.size > 10_000_000) throw new Error('the file is over 10 MB')
      const data = JSON.parse(await file.text())
      const id = newId('lot')
      const { w, h, seconds } = loadLottie(id, data)
      const clip: Clip = { id: newId('c'), kind: 'image', lottieId: id, imageSize: [w, h], label: file.name, start: 0, in: 0, out: Math.max(1, Math.min(60, seconds)) }
      commit(placeOnLayer({ ...project, lotties: { ...(project.lotties ?? {}), [id]: data } }, clip, 'video', project.video.length, playhead()))
      setSelectedId(clip.id)
    } catch (err) {
      setError(`Could not use ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Screen recording. The screen and the webcam are recorded as two files at the same moment: the screen goes on
  // the main track, the webcam on a layer above as a round picture in the corner. (Drawing them together live
  // would freeze whenever the editor's window is in the background, which it always is while recording the screen.)
  async function startScreen() {
    setScreenAsk(false)
    setError(null)
    let screen: MediaStream
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
    } catch {
      return // the person closed the screen picker
    }
    let cam: MediaStream | null = null
    if (screenCam) {
      try {
        cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } })
      } catch {
        setError('The webcam or microphone could not be opened, so only the screen is being recorded.')
      }
    }
    const pick = (types: string[]) => types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const type = pick(['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'])
    const record = (stream: MediaStream) => {
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      const done = new Promise<Blob>((ok) => { rec.onstop = () => ok(new Blob(chunks, { type: rec.mimeType || 'video/webm' })) })
      rec.start(1000)
      return { rec, done }
    }
    const a = record(screen)
    const b = cam ? record(cam) : null
    const at = projectDuration(project)
    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      for (const r of [a, b]) if (r && r.rec.state !== 'inactive') r.rec.stop()
      const [sb, cb] = await Promise.all([a.done, b?.done ?? Promise.resolve(null)])
      screen.getTracks().forEach((t) => t.stop())
      cam?.getTracks().forEach((t) => t.stop())
      setScreenRec(null)
      const ext = (x: Blob) => (x.type.includes('mp4') ? 'mp4' : 'webm')
      const n = Date.now()
      try {
        const sf = new File([sb], `Screen ${new Date(n).toLocaleTimeString().replace(/:/g, '.')}.${ext(sb)}`, { type: sb.type, lastModified: n })
        const sm = await openMedia(sf)
        const sKey = { name: sf.name, size: sf.size, lastModified: sf.lastModified }
        const ss: Source = { id: newId('s'), name: sf.name, media: sm, file: sKey }
        const added: Source[] = [ss]
        let next = appendToMain(project, { id: newId('c'), kind: 'media', sourceId: ss.id, start: 0, in: 0, out: sm.info.duration })
        saveTake(keyOf(sKey), sf).catch(() => {})
        if (cb) {
          const cf = new File([cb], `Webcam ${new Date(n).toLocaleTimeString().replace(/:/g, '.')}.${ext(cb)}`, { type: cb.type, lastModified: n + 1 })
          const cm = await openMedia(cf)
          const cKey = { name: cf.name, size: cf.size, lastModified: cf.lastModified }
          const cs: Source = { id: newId('s'), name: cf.name, media: cm, file: cKey }
          added.push(cs)
          saveTake(keyOf(cKey), cf).catch(() => {})
          // A round picture in the bottom corner: the middle of the webcam, cropped square.
          const vw = cm.info.video?.width ?? 1280
          const vh = cm.info.video?.height ?? 720
          const size = frame.w * 0.3
          const crop = vw > vh ? ((vw - vh) / 2 / vw) * 100 : 0
          const w = vw > vh ? size / (1 - (2 * crop) / 100) : size
          next = placeOnLayer(next, {
            id: newId('c'), kind: 'media', sourceId: cs.id, start: 0, in: 0, out: cm.info.duration,
            transform: { x: frame.w - size / 2 - frame.w * 0.05, y: frame.h - size / 2 - frame.w * 0.12, w, h: (w * vh) / vw, rotation: 0, opacity: 1, flipH: true, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: crop, r: crop }, feather: 0 },
            border: { width: 6, color: '#ffffff', radius: size, shadow: true },
          }, 'video', 1, at)
        }
        setSources((x) => [...x, ...added])
        for (const s of added) buildOverview(s, (o) => setOverviews((m) => new Map(m).set(s.id, o))).catch(() => {})
        commit(next)
      } catch (err) {
        setError(`The recording could not be opened: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Pressing the browser's own "Stop sharing" ends it too.
    screen.getVideoTracks()[0]?.addEventListener('ended', () => stop())
    setScreenRec({ stop })
  }

  // Preview copies for every big video that has none yet, kept in this browser for next time.
  async function makeProxies() {
    // Big videos, and any video whose keyframes are far apart (slow to jump around in, whatever its size)
    const todo: Source[] = []
    for (const s of sources) {
      if (s.proxy || !s.media.videoTrack) continue
      if (wantsProxy(s.media) || (await longestKeyGap(s.media).catch(() => 0)) > SLOW_KEY_GAP) todo.push(s)
    }
    if (!todo.length) {
      setNotice('Every video here is already easy to play: no preview copies are needed.')
      return
    }
    for (const [i, s] of todo.entries()) {
      if (!(await makeProxyFor(s, `Making preview copies: ${i + 1} of ${todo.length}`, false))) return
    }
    setNotice(`Made ${todo.length} preview cop${todo.length === 1 ? 'y' : 'ies'}. Playback uses them; export always uses the originals.`)
  }

  // One preview copy, kept in this browser for next time. True when it worked.
  const proxyJobs = useRef(new Set<string>())
  async function makeProxyFor(s: Source, label: string, sayDone = true): Promise<boolean> {
    if (proxyJobs.current.has(s.id)) return true
    proxyJobs.current.add(s.id)
    try {
      const copy = await newCopy(s.file ? keyOf(s.file) : `${s.name}|${s.id}`)
      try {
        await makeProxy(s.media, (f) => setNotice(`${label}: ${Math.round(f * 100)}%`), copy.writable as never)
      } catch (err) {
        await copy.drop()
        throw err
      }
      const proxy = await openMedia(await copy.done())
      setSources((list) => list.map((x) => (x.id === s.id ? { ...x, proxy } : x)))
      if (sayDone) setNotice(`${s.name}: preview copy ready, it now moves smoothly. Export still uses the original.`)
      return true
    } catch (err) {
      setNotice(null)
      setError(`Could not make a preview copy of ${s.name}: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      proxyJobs.current.delete(s.id)
    }
  }

  // Render cache: the stretch of a clip rendered once, at preview size, and played as it is until anything changes.
  async function renderCache(from: number, to: number) {
    setNotice('Rendering this part for smooth playback…')
    try {
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
      const short = Math.min(project.frame.w, project.frame.h)
      const res = Math.min(720, short)
      // Video only (an M4A-free MP4): the sound plays live as always.
      const noSound = { ...project, audio: project.audio.map((t) => ({ ...t, clips: [] })), video: project.video.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, volume: 0 })) })) }
      await exportProject(sources, noSound, { container: 'mp4', resolution: res, fps: 30, quality: 'high', range: [from, to] }, writable as never,
        (f) => setNotice(`Rendering this part for smooth playback… ${Math.round(f * 100)}%`), new AbortController().signal)
      const media = await openMedia(new File([buf.slice(0, size)], 'render cache.mp4', { type: 'video/mp4' }))
      playerRef.current?.setCache({ project, from, to, media })
      setCached([from, to])
      setNotice('Rendered. This part now plays from the render until you change anything.')
    } catch (err) {
      setNotice(null)
      setError(`Could not render it: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ---- Timelines and nested clips ----

  // A timeline rendered to a file at the project's size, picture and sound together: what a nested clip plays.
  async function renderSeq(seq: Seq, p: Project = project): Promise<Source> {
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
    const inner: Project = { ...p, video: seq.video, audio: seq.audio, sequences: undefined }
    await exportProject(sources, inner, { container: 'mp4', resolution: Math.min(1080, Math.min(p.frame.w, p.frame.h)), fps: 'original', quality: 'best' }, writable as never,
      (f) => setNotice(`Making the nested clip "${seq.name}"… ${Math.round(f * 100)}%`), new AbortController().signal)
    const file = new File([buf.slice(0, size)], `Nested ${seq.name} ${Date.now()}.mp4`, { type: 'video/mp4', lastModified: Date.now() })
    const media = await openMedia(file)
    const key = { name: file.name, size: file.size, lastModified: file.lastModified }
    const source: Source = { id: newId('s'), name: `Nested: ${seq.name}`, media, file: key }
    saveTake(keyOf(key), file).catch(() => {})
    setSources((x) => [...x, source])
    buildOverview(source, (o) => setOverviews((m) => new Map(m).set(source.id, o))).catch(() => {})
    return source
  }

  async function nestSelected(ids: string[]) {
    const n = (project.sequences?.length ?? 0) + 1
    const cut = cutOutForNest(project, ids, `Nested ${n}`)
    if (!cut) return
    try {
      const src = await renderSeq(cut.seq)
      const clip: Clip = { id: newId('c'), kind: 'media', sourceId: src.id, start: cut.at.start, in: 0, out: src.media.info.duration, nest: cut.seq.id }
      let next: Project = { ...cut.rest, sequences: [...(cut.rest.sequences ?? []), cut.seq], nestRenders: { ...(cut.rest.nestRenders ?? {}), [cut.seq.id]: { hash: seqHash(cut.seq), sourceId: src.id } } }
      if (cut.at.main !== null) next = { ...next, video: next.video.map((t, i) => (i ? t : { ...t, clips: [...t.clips.slice(0, cut.at.main!), clip, ...t.clips.slice(cut.at.main!)] })) }
      else next = placeOnLayer(next, clip, 'video', cut.at.layer, cut.at.start)
      commit(next)
      setSelectedId(clip.id)
      setNotice(`Nested into "${cut.seq.name}". Right-click it and choose "Open the nested timeline" to change what is inside.`)
    } catch (err) {
      setNotice(null)
      setError(`Could not nest them: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Opening a timeline: any nested clip in it whose timeline has changed since it was rendered is made again first.
  async function openSeq(id: string) {
    playerRef.current?.pause()
    let next = switchSeq(project, id)
    const stale = [...new Set([...next.video, ...next.audio].flatMap((t) => t.clips.map((c) => c.nest)).filter((x): x is string => !!x))]
      .map((sid) => seqById(next, sid)).filter((s): s is Seq => !!s && next.nestRenders?.[s.id]?.hash !== seqHash(s))
    try {
      for (const s of stale) {
        const src = await renderSeq(s, next)
        const dur = src.media.info.duration
        const fix = (t: (typeof next.video)[number]) => ({ ...t, clips: t.clips.map((c) => (c.nest === s.id ? { ...c, sourceId: src.id, in: Math.min(c.in, Math.max(0, dur - 0.1)), out: Math.min(Math.max(c.out, c.in + 0.1), dur) } : c)) })
        next = { ...next, video: next.video.map(fix), audio: next.audio.map(fix), nestRenders: { ...(next.nestRenders ?? {}), [s.id]: { hash: seqHash(s), sourceId: src.id } } }
      }
      if (stale.length) setNotice(`Brought ${stale.length} nested clip${stale.length === 1 ? '' : 's'} up to date.`)
    } catch (err) {
      setError(`A nested clip could not be brought up to date: ${err instanceof Error ? err.message : String(err)}`)
    }
    commit(next)
    setSelectedId(null)
  }

  // Multicam. Each angle's picture is shown or hidden live while it plays (not saved), and Stop turns the cuts
  // into plain clips in one undo step.
  function showAngle(ids: string[], angle: number, base: Project) {
    let next = base
    ids.forEach((id, i) => {
      const c = findPlaced(base, id)?.clip
      if (c) next = updateClip(next, id, { transform: { ...transformOf(base.frame, sources, c), opacity: i === angle ? 1 : 0 } })
    })
    setHistory((h) => ({ ...h, present: next }))
  }
  function startMulticam(ids: string[]) {
    const base = project
    const from = Math.min(...ids.map((id) => findPlaced(base, id)?.start ?? 0))
    setMc({ ids, cuts: [{ t: from, angle: 0 }], angle: 0, base })
    showAngle(ids, 0, base)
    playerRef.current?.seek(from).then(() => playerRef.current?.play())
  }
  function cutTo(angle: number) {
    if (!mc || angle >= mc.ids.length) return
    const t = playerRef.current?.now() ?? time
    setMc({ ...mc, angle, cuts: [...mc.cuts.filter((c) => c.t < t - 0.05), { t, angle }] })
    showAngle(mc.ids, angle, mc.base)
  }
  function finishMulticam(keep: boolean) {
    if (!mc) return
    playerRef.current?.pause()
    const base = mc.base
    if (keep) setHistory((h) => ({ past: [...h.past, base], present: flattenMulticam(base, mc.ids, mc.cuts), future: [] }))
    else setHistory((h) => ({ ...h, present: base }))
    setMc(null)
    setSelectedId(null)
  }

  // ---- Tracking and stabilising ----

  // The box drawn on the preview, turned into fractions of the clip's own picture.
  function setTrackBox(id: string, x0: number, y0: number, x1: number, y1: number) {
    const pl = findPlaced(project, id)
    if (!pl) return
    const tr = transformAt(frame, sources, pl.clip, (playerRef.current?.now() ?? time) - pl.start)
    const fx = (x: number) => Math.max(0, Math.min(1, (x - (tr.x - tr.w / 2)) / tr.w))
    const fy = (y: number) => Math.max(0, Math.min(1, (y - (tr.y - tr.h / 2)) / tr.h))
    const box = { x: (fx(x0) + fx(x1)) / 2, y: (fy(y0) + fy(y1)) / 2, w: Math.abs(fx(x1) - fx(x0)), h: Math.abs(fy(y1) - fy(y0)) }
    commit(updateClip(project, id, { track: { box, points: [] } }))
    setBoxFor(null)
  }

  // Follows the box from the playhead to the end of the clip.
  async function runTrack(id: string) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((s) => s.id === pl.clip.sourceId) : null
    if (!pl || !src || !pl.clip.track) return
    const from = sourceAt(pl.clip, Math.max(0, (playerRef.current?.now() ?? time) - pl.start))
    setWorking({ what: 'Tracking', f: 0 })
    try {
      const points = await trackBox(src.media, from, pl.clip.out, pl.clip.track.box, (f) => setWorking({ what: 'Tracking', f }))
      commit(updateClip(project, id, { track: { ...pl.clip.track, points } }))
      setNotice(`Tracked ${points.length} frames. Now blur it, stick text to it, or make another clip follow it.`)
    } catch (err) {
      setError(`Could not track it: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setWorking(null)
    }
  }

  // Blur what was tracked: a soft oval mask that moves with it, with the blur only inside it.
  function blurTracked(id: string) {
    const c = findPlaced(project, id)?.clip
    const t = c?.track
    if (!c || !t?.points.length) return
    const first = t.points[0]
    commit(updateClip(project, id, {
      mask: { shape: 'ellipse', x: first[1], y: first[2], w: t.box.w * 1.3, h: t.box.h * 1.3, feather: 30, invert: false, mode: 'colour', followFrom: [first[1], first[2]] },
      fx: { ...(c.fx ?? NO_FX), blur: 80, mosaic: 0 },
    }))
    setOpen((o) => ({ ...o, mask: true, fx: true }))
  }

  // Text that rides above what was tracked.
  function textOnTracked(id: string) {
    const t = playerRef.current?.now() ?? time
    const pt = trackedPoint(project, sources, id, t, sampleAt)
    const pl = findPlaced(project, id)
    if (!pt || !pl) return
    const clip: Clip = {
      id: newId('c'), kind: 'text', start: 0, in: 0, out: Math.max(0.5, pl.end - t),
      text: { ...DEFAULT_TEXT, text: 'Your text', size: 64 },
      follow: { clip: id, ox: 0, oy: -frame.h * 0.08 },
    }
    commit(placeOnLayer(project, clip, 'video', project.video.length, t))
    setSelectedId(clip.id)
    editText()
  }

  async function runStab(id: string, strength: number, zoom: number) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((s) => s.id === pl.clip.sourceId) : null
    if (!pl || !src) return
    setWorking({ what: 'Stabilising', f: 0 })
    try {
      const data = await analyseShake(src.media, pl.clip.in, pl.clip.out, strength, (f) => setWorking({ what: 'Stabilising', f }), zoom)
      commit(updateClip(project, id, { stab: { strength, zoom, data } }))
    } catch (err) {
      setError(`Could not stabilise it: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setWorking(null)
    }
  }

  // The three tabs. Opening Picture swaps the picture in where the edit's tracks are (the edit waits in the project);
  // leaving it swaps the edit back. Undo starts afresh on each side.
  function switchTab(next: 'edit' | 'prompt' | 'picture' | 'script') {
    playerRef.current?.pause()
    if (next === 'picture' && !inPicture(project)) {
      setHistory({ past: [], present: toPicture(project), future: [] })
      setSelectedId(null)
      setTimeout(() => playerRef.current?.seek(0), 0)
    } else if (next !== 'picture' && inPicture(project)) {
      setHistory({ past: [], present: toEdit(project), future: [] })
      setSelectedId(null)
    }
    setMode(next)
  }

  // The picture takes the shape of its photo: the selected one, or the biggest.
  function photoSize() {
    const pics = layout(project).filter((pl) => pl.clip.kind === 'image' && pl.clip.imageSize)
    const pl = pics.find((x) => x.clip.id === selectedId) ?? pics.sort((a, b) => b.clip.imageSize![0] * b.clip.imageSize![1] - a.clip.imageSize![0] * a.clip.imageSize![1])[0]
    if (!pl) { setNotice('Add a photo first: the picture then takes its shape.'); return }
    const [w, h] = pl.clip.imageSize!
    const frame = frameOf(w, h)
    // The photo fills its new frame exactly.
    commit(updateClip({ ...project, frame }, pl.clip.id, { transform: { ...fitTransform(frame, w, h, 'fill') } }))
  }

  // Use in edit: the finished picture goes into the video edit at the playhead, as a picture on a layer.
  async function useInEdit() {
    try {
      setLoading(true)
      const blob = await exportStill(sources, project, 0, Math.min(2160, Math.min(project.frame.w, project.frame.h)), 'png', true)
      const file = new File([blob], `Picture ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', '.')}.png`, { type: 'image/png' })
      setHistory({ past: [], present: toEdit(project), future: [] })
      setSelectedId(null)
      setMode('edit')
      setLoading(false)
      await addFile(file)
      setNotice('The picture is in your edit at the playhead, on a layer.')
    } catch (err) {
      setError(`Could not use the picture: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function seqMenu(x: number, y: number) {
    const list = seqList(project)
    const cur = activeId(project)
    setMenu({
      x, y, items: [
        ...list.map((s) => ({ label: s.name, checked: s.active, onClick: () => openSeq(s.id) }) as MenuItem),
        'line',
        { label: 'New empty timeline', onClick: () => { commit(newSeq(project, `Timeline ${list.length + 1}`)); setSelectedId(null) } },
        { label: 'Copy this timeline', onClick: () => { commit(newSeq(project, `${activeName(project)} copy`, { id: cur, name: activeName(project), video: project.video, audio: project.audio })); setSelectedId(null) } },
        { label: 'Rename this timeline…', onClick: () => setSeqRename({ id: cur, name: activeName(project) }) },
        ...list.filter((s) => !s.active && s.id !== 'main').map((s) => {
          const users = usedBy(project, s.id)
          return { label: `Delete "${s.name}"`, danger: true, disabled: users.length > 0, hint: users.length ? `nested in ${users[0]}` : undefined, onClick: () => commit(deleteSeq(project, s.id)) } as MenuItem
        }),
      ],
    })
  }

  // From the source viewer: the part between in and out, placed where the person chose.
  function placeFromViewer(src: Source, from: number, to: number, how: Place) {
    const clip: Clip = { id: newId('c'), kind: 'media', sourceId: src.id, start: 0, in: from, out: to }
    const t = playhead()
    const video = !!src.media.videoTrack
    let next: Project
    if (!video) next = placeOnLayer(project, clip, 'audio', 0, how === 'end' ? projectDuration(project) : t)
    else if (how === 'end') next = appendToMain(project, clip)
    else if (how === 'insert') next = insertOnMain(project, clip, t)
    else if (how === 'overwrite') next = overwriteOnMain(project, clip, t)
    else next = placeOnLayer(project, clip, 'video', 1, t)
    commit(next)
    setSelectedId(clip.id)
    setViewing(null)
  }

  function addTitle(id: string) {
    const clips = makeTitle(id, frame)
    const t = playhead()
    let next = project
    for (const c of clips) next = placeOnLayer(next, c, 'video', next.video.length, t)
    commit(next)
    setSelectedId(clips[clips.length - 1].id)
    setTitlesOpen(false)
  }

  // Beats: markers on every beat of a clip's sound, on the timeline where they play.
  async function markBeats(id: string) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((s) => s.id === pl.clip.sourceId) : null
    if (!pl || !src) return
    setNotice('Listening for the beat…')
    try {
      const { beats, bpm } = await findBeats(src.media, pl.clip.in, pl.clip.out)
      let next = project
      for (const b of beats) {
        const at = pl.start + localAt(pl.clip, b)
        if (at >= pl.start && at < pl.end) next = addMarker(next, at, '')
      }
      commit(next)
      setNotice(`${beats.length} beats marked, about ${bpm} beats a minute. Clips and their edges now snap to the beats when dragged near them.`)
    } catch (err) {
      setNotice(null)
      setError(`Could not find the beat: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Scene changes: a finished video is split wherever its picture jumps to a new shot.
  async function splitScenes(id: string) {
    const pl = findPlaced(project, id)
    const src = pl?.clip.sourceId ? sources.find((s) => s.id === pl.clip.sourceId) : null
    if (!pl || !src) return
    setNotice('Looking for where the scene changes…')
    try {
      const cuts = await findCuts(src.media, pl.clip.in, pl.clip.out, (f) => setNotice(`Looking for where the scene changes… ${Math.round(f * 100)}%`))
      let next = project
      // Latest first, so each split leaves the earlier part of the clip where it was.
      for (const c of cuts.slice().reverse()) {
        const cur = layout(next).find((x) => x.clip.sourceId === pl.clip.sourceId && x.kind === pl.kind && x.trackIndex === pl.trackIndex && c > x.clip.in && c < x.clip.out)
        if (cur) next = splitClip(next, cur.clip.id, cur.start + localAt(cur.clip, c))
      }
      commit(next)
      setNotice(cuts.length ? `Split at ${cuts.length} scene change${cuts.length === 1 ? '' : 's'}.` : 'No scene changes found in this clip.')
    } catch (err) {
      setNotice(null)
      setError(`Could not look for scene changes: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // What "Copy effects" takes: the light and colour, colour look, effects, green screen, blend, shadow and glow,
  // border, animation, speed and sound settings. Not the position, the words, a mask or anything tracked.
  function effectsOf(c: Clip): Partial<Clip> {
    return {
      look: c.look, lut: c.lut, fx: c.fx, key: c.key, blend: c.blend, shade: c.shade, border: c.border, anim: c.anim,
      speed: c.speed, keepPitch: c.keepPitch, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, sfx: c.sfx,
    }
  }
  function pasteEffects(targets: string[], effects: Partial<Clip> | null = copied) {
    if (!effects) return
    let next = project
    for (const id of targets) {
      const c = findPlaced(next, id)?.clip
      if (!c || isLocked(next, id)) continue
      const patch: Partial<Clip> = { ...effects }
      // Speed only means something on video and sound; a look only on pictures and video.
      if (c.kind !== 'media') {
        delete patch.speed
        delete patch.keepPitch
        delete patch.volume
        delete patch.fadeIn
        delete patch.fadeOut
        delete patch.sfx
      }
      // Looks, effects and green screen only work on pictures and video.
      if (c.kind === 'text' || c.kind === 'color' || c.kind === 'shape') {
        delete patch.look
        delete patch.lut
        delete patch.fx
        delete patch.key
      }
      next = updateClip(next, id, patch)
    }
    commit(next)
  }

  // Pastes the copied movement: every keyframe that falls inside each clip's own length.
  function pasteKeys(targets: string[]) {
    if (!copiedKeys?.keys) return
    let next = project
    for (const id of targets) {
      const pl = findPlaced(next, id)
      if (!pl || isLocked(next, id) || pl.kind !== 'video') continue
      const keys = copiedKeys.keys.filter((k) => k.t <= pl.end - pl.start + 1e-6).map((k) => ({ ...k }))
      if (keys.length) next = updateClip(next, id, { keys, path: copiedKeys.path })
    }
    commit(next)
  }

  function clipMenu(id: string, x: number, y: number) {
    const pl = findPlaced(project, id)
    if (!pl) return
    const c = pl.clip
    const t = playerRef.current?.now() ?? time
    const under = t >= pl.start && t < pl.end
    const locked = isLocked(project, id)
    // The menu works on what was right-clicked: the selection if the clip is part of it, otherwise that clip and its group.
    const current = selection()
    const sel = current.includes(id) ? current : groupOf(project, id)
    const grouped = sel.some((i) => findPlaced(project, i)?.clip.group)
    setMenu({
      x, y, items: [
        { label: 'Duplicate', hint: 'a copy right after it', disabled: locked, onClick: () => commit(insertAfter(project, id, { ...structuredClone(c), id: newId('c'), group: undefined })) },
        'line',
        { label: 'Freeze frame here', hint: 'at the playhead', disabled: c.kind !== 'media' || pl.kind !== 'video' || !under || locked, onClick: () => freezeFrame(id) },
        { label: c.kind === 'image' ? 'Replace picture…' : 'Replace clip…', hint: 'keeps its edits', disabled: (c.kind !== 'media' && c.kind !== 'image') || locked, onClick: () => replaceClip(id) },
        { label: 'Render this part for smooth playback', hint: 'until anything changes', onClick: () => renderCache(pl.start, pl.end) },
        ...(c.nest ? [{ label: 'Open the nested timeline', onClick: () => openSeq(c.nest!) } as MenuItem] : []),
        { label: sel.length > 1 ? `Nest these ${sel.length} into one clip` : 'Nest into its own timeline', disabled: locked, onClick: () => nestSelected(sel) },
        {
          label: sel.length > 1 ? `Sync these ${sel.length} by sound` : 'Sync by sound', hint: 'Ctrl+click the other angles first',
          disabled: sel.length < 2 || sel.some((i) => !sources.find((s) => s.id === findPlaced(project, i)?.clip.sourceId)?.media.audioTrack),
          onClick: () => {
            const next = syncBySound(project, sel)
            if (!next) setError('The sound of a clip is still being read. Try again in a moment.')
            else commit(next)
          },
        },
        {
          label: 'Cut between angles…', hint: 'press 1 to 4 while it plays',
          disabled: sel.length < 2 || sel.length > 4 || sel.some((i) => !sources.find((s) => s.id === findPlaced(project, i)?.clip.sourceId)?.media.videoTrack),
          onClick: () => startMulticam(sel),
        },
        { label: 'Open in the viewer', hint: 'pick another part of the file', disabled: c.kind !== 'media', onClick: () => setViewing(sources.find((s) => s.id === c.sourceId) ?? null) },
        { label: 'Reverse', hint: 'plays backwards', disabled: c.kind !== 'media' || locked || reversing !== null, onClick: () => reverseClip(id) },
        { label: 'Split where the scene changes', disabled: c.kind !== 'media' || !sources.find((s) => s.id === c.sourceId)?.media.videoTrack || locked, onClick: () => splitScenes(id) },
        { label: 'Mark the beats', hint: 'markers on the music', disabled: c.kind !== 'media' || !sources.find((s) => s.id === c.sourceId)?.media.audioTrack, onClick: () => markBeats(id) },
        'line',
        { label: 'Copy effects', disabled: c.kind === 'text' && !c.anim && !c.border, onClick: () => setCopied(effectsOf(c)) },
        { label: 'Paste effects', disabled: !copied, onClick: () => pasteEffects(sel) },
        { label: 'Copy keyframes', hint: c.keys?.length ? `${c.keys.length} keyframes` : 'this clip has none', disabled: !c.keys?.length, onClick: () => setCopiedKeys({ keys: c.keys, path: c.path }) },
        { label: 'Paste keyframes', hint: 'same moves, same times', disabled: !copiedKeys, onClick: () => pasteKeys(sel) },
        'line',
        { label: sel.length > 1 ? `Group these ${sel.length}` : 'Group', hint: 'Ctrl+click to pick more', disabled: sel.length < 2, onClick: () => commit(setGroup(project, sel, newId('g'))) },
        { label: 'Ungroup', disabled: !grouped, onClick: () => commit(setGroup(project, sel, undefined)) },
        'line',
        { label: 'Add marker at the playhead', hint: 'M', onClick: () => commit(addMarker(project, t)) },
        ...(c.volPoints ? [{ label: 'Remove the volume line', onClick: () => commit(updateClip(project, id, { volPoints: undefined })) } as MenuItem] : []),
        'line',
        { label: 'Delete', hint: 'Delete', disabled: locked, danger: true, onClick: () => remove(false, sel) },
        { label: 'Delete and close the gap', hint: 'Shift+Delete', disabled: locked, danger: true, onClick: () => remove(true, sel) },
      ],
    })
  }

  function rowMenu(kind: 'video' | 'audio', index: number, t: number, x: number, y: number) {
    const gap = gapAt(project, kind, index, t)
    setMenu({
      x, y, items: [
        { label: 'Close this gap', hint: gap ? `${(gap[1] - gap[0]).toFixed(1)} s` : undefined, disabled: !gap || !!(kind === 'video' ? project.video : project.audio)[index]?.locked, onClick: () => commit(closeGap(project, kind, index, t)) },
        { label: 'Add marker here', onClick: () => commit(addMarker(project, t)) },
      ],
    })
  }

  function trackMenu(kind: 'video' | 'audio', index: number, x: number, y: number) {
    const tr = (kind === 'video' ? project.video : project.audio)[index]
    if (!tr) return
    const set = (patch: Partial<typeof tr>) => commit(updateTrack(project, tr.id, patch))
    setMenu({
      x, y, items: [
        { label: 'Lock', hint: 'no moving, trimming or deleting', checked: !!tr.locked, onClick: () => set({ locked: !tr.locked }) },
        { label: 'Mute', hint: 'its sound is not heard', checked: !!tr.muted, onClick: () => set({ muted: !tr.muted }) },
        { label: 'Solo', hint: 'hear only solo tracks', checked: !!tr.solo, onClick: () => set({ solo: !tr.solo }) },
        ...(kind === 'video' ? [{ label: 'Hide', hint: 'not shown or exported', checked: !!tr.hidden, onClick: () => set({ hidden: !tr.hidden }) } as MenuItem] : []),
      ],
    })
  }

  function markerMenu(id: string, x: number, y: number) {
    const m = (project.markers ?? []).find((k) => k.id === id)
    if (!m) return
    setMenu({
      x, y, items: [
        { label: m.note ? 'Change the note…' : 'Add a note…', onClick: () => setNoteEdit({ id, note: m.note }) },
        { label: 'Move it to the playhead', onClick: () => commit(updateMarker(project, id, { t: playerRef.current?.now() ?? time })) },
        { label: 'Delete marker', danger: true, onClick: () => commit(removeMarker(project, id)) },
      ],
    })
  }

  // Moving a grouped clip on a layer takes the rest of its group with it, the same distance.
  function move(id: string, kind: 'video' | 'audio', trackIndex: number, start: number, mainIndex: number) {
    const before = findPlaced(project, id)
    // The others in its group that can follow: on a layer or sound track, and not locked.
    const followers = before?.clip.group
      ? groupOf(project, id).filter((o) => o !== id).map((o) => findPlaced(project, o)!).filter((o) => o && !(o.kind === 'video' && o.trackIndex === 0) && !isLocked(project, o.clip.id))
      : []
    // Lifted off first, so the moved clip never lands on top of one of its own group.
    let next = project
    // Dropped above the top layer: a new layer is made for it
    if (kind === 'video' && trackIndex >= next.video.length) next = addTrack(next, 'video')
    for (const o of followers) next = removeClip(next, o.clip.id)
    next = moveClip(next, id, kind, trackIndex, start, mainIndex)
    const after = findPlaced(next, id)
    const d = after && before ? after.start - before.start : 0
    for (const o of followers) next = placeOnLayer(next, o.clip, o.kind, o.trackIndex, o.start + d)
    commit(pruneEmptyTracks(next))
  }

  // Click on the preview: select the top-most clip under the pointer.
  function pick(x: number, y: number) {
    const hits = activeVideo(project, time).filter((pl) => pl.clip.kind !== 'adjust' && hitBox(transformAt(frame, sources, pl.clip, time - pl.start), x, y))
    setSelectedId(hits.length ? hits[hits.length - 1].clip.id : null)
  }

  // Space play or pause, arrows step a frame (Shift: a second), S split, Delete remove, Ctrl+Z undo, Ctrl+Y redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (exporting || confirmRemove || captioning || askNew || (!IS_WEB && !currentId) || renamingTop || mode === 'prompt' || mode === 'script') return
      // A picture does not play: only undo, redo, delete and nudging work there.
      if (mode === 'picture' && !(e.ctrlKey || e.metaKey || e.code.startsWith('Arrow') || e.code === 'Delete' || e.code === 'Backspace')) return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox') return
      // Typing in a text box: Space, letters and Delete are the words, never shortcuts.
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return
      // Arrows on a focused slider move the slider, not the playhead.
      if (el.tagName === 'INPUT' && e.code.startsWith('Arrow')) return
      if (el.tagName === 'SELECT') return
      const ctrl = e.ctrlKey || e.metaKey
      // Cutting between angles: 1 to 4 choose the camera, Escape stops.
      if (mc) {
        const d = /^Digit([1-4])$/.exec(e.code)
        if (d) { e.preventDefault(); cutTo(Number(d[1]) - 1); return }
        if (e.code === 'Escape') { finishMulticam(true); return }
      }
      const keys = loadKeys()
      const is = (a: KeyAction) => !ctrl && e.code === keys[a]
      if (is('play')) {
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
          const t = transformAt(p.frame, sources, c, selLocal)
          return updateSel(p, placeAt(c, selLocal, { ...t, x: t.x + dx, y: t.y + dy }))
        })
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault()
        step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps))
      } else if (ctrl && e.code === 'KeyA' && mode === 'edit') {
        // Every clip on the open timeline, except on locked tracks
        e.preventDefault()
        const ids = [...project.video, ...project.audio].flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id)))
        setSelectedIdOnly(ids[0] ?? null)
        setExtraIds(ids.slice(1))
      } else if (ctrl && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (ctrl && e.code === 'KeyY') {
        e.preventDefault()
        redo()
      } else if (is('split')) {
        e.preventDefault()
        split()
      } else if (is('zoomIn') || (!ctrl && e.key === '+' && keys.zoomIn === 'Equal')) {
        setPxPerSec((z) => Math.min(200, Math.round(z * 1.5)))
      } else if (is('zoomOut') || (!ctrl && e.key === '_' && keys.zoomOut === 'Minus')) {
        setPxPerSec((z) => Math.max(2, Math.round(z / 1.5)))
      } else if (e.code === keys.remove || e.code === 'Backspace' || (e.shiftKey && e.code === 'Delete')) {
        e.preventDefault()
        remove(e.shiftKey)
      } else if (is('marker')) {
        e.preventDefault()
        commit(addMarker(project, playerRef.current?.now() ?? time))
      } else if (is('stop')) {
        kHeld.current = true
        playerRef.current?.pause()
      } else if (is('forward')) {
        e.preventDefault()
        if (kHeld.current) step(1 / fps)
        else if (!playerRef.current?.playing) playerRef.current?.play()
      } else if (is('back')) {
        // Back: one frame with K held, otherwise a fifteenth of a second a press. Held down, it keeps going.
        e.preventDefault()
        step(kHeld.current ? -1 / fps : -1 / 15)
      }
    }
    // Letting go of an arrow after nudging saves the nudges as one undo step.
    function onKeyUp(e: KeyboardEvent) {
      if (e.code.startsWith('Arrow')) commitLive()
      if (e.code === loadKeys().stop) kHeld.current = false
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
  const fold = (key: keyof typeof open, title: string, body: React.ReactNode, onRemove?: () => void) => (
    <details className="fold" open={open[key]} onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; setOpen((o) => (o[key] === v ? o : { ...o, [key]: v })) }}>
      <summary>
        {title}
        {onRemove && <button className="fold-remove" title={`Take ${title.toLowerCase()} off this clip`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}>×</button>}
      </summary>
      {body}
    </details>
  )

  // "+ Add": the extra things a clip can have. Nothing of them shows until it is added.
  function addMenu(x: number, y: number) {
    if (!selected || !selectedPl) return
    const onScreen = selectedPl.kind === 'video'
    const picture = onScreen && (selected.kind === 'media' || selected.kind === 'image' || selected.kind === 'adjust')
    const sound = selected.kind === 'media' && !!selectedSource?.media.audioTrack
    const add = (key: keyof typeof open, patch: Partial<Clip>) => () => {
      commit(updateSel(project, patch))
      setOpen((o) => ({ ...o, [key]: true }))
    }
    const items: MenuItem[] = []
    if (picture) {
      items.push({ label: 'Effect', hint: 'blur, glow, grain, VHS, shake…', checked: !!selected.fx, disabled: !!selected.fx, onClick: add('fx', { fx: { ...NO_FX } }) })
      if (selected.kind !== 'adjust') items.push({ label: 'Green screen', checked: !!selected.key, disabled: !!selected.key, onClick: add('key', { key: { ...DEFAULT_KEY } }) })
      if (selected.kind === 'media') {
        items.push({ label: 'Stabilise', hint: 'smooth out a shaky camera', checked: !!selected.stab, disabled: !!selected.stab || !!working, onClick: () => { setOpen((o) => ({ ...o, stab: true })); runStab(selected.id, 60, 1.08) } })
        items.push({ label: 'Track something', hint: 'follow a face, a sign, a ball…', checked: !!selected.track, disabled: !!selected.track, onClick: () => { commit(updateSel(project, { track: { box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, points: [] } })); setOpen((o) => ({ ...o, track: true })); setBoxFor(selected.id) } })
      }
      items.push({ label: 'Mask', hint: 'keep part of the picture, or colour just part', checked: !!selected.mask, disabled: !!selected.mask, onClick: add('mask', { mask: { ...DEFAULT_MASK } }) })
      items.push({ label: 'Colour look', hint: IS_WEB ? 'film looks' : 'film looks, .cube files', checked: !!selected.lut, disabled: !!selected.lut, onClick: add('lut', { lut: { id: 'look:warm', strength: 100 } }) })
    }
    if (onScreen && selected.kind !== 'adjust') {
      const tracked = layout(project).filter((x) => x.clip.track?.points.length && x.clip.id !== selected.id)
      if (!selected.follow && tracked.length) {
        for (const tc of tracked) items.push({
          label: `Follow what is tracked in "${tc.clip.label ?? sources.find((s) => s.id === tc.clip.sourceId)?.name ?? 'a clip'}"`,
          onClick: () => {
            const pt = trackedPoint(project, sources, tc.clip.id, time, sampleAt)
            const tr = transformAt(frame, sources, selected, selLocal)
            if (!pt) { setError('Move the playhead to a moment where the tracked clip is showing, then try again.'); return }
            commit(updateSel(project, { follow: { clip: tc.clip.id, ox: tr.x - pt.x, oy: tr.y - pt.y } }))
            setOpen((o) => ({ ...o, follow: true }))
          },
        })
      }
      items.push({ label: 'Track matte', hint: 'the layer above gives the shape', checked: !!selected.matte, disabled: !!selected.matte, onClick: add('matte', { matte: 'alpha' }) })
      if (selected.kind === 'media' || selected.kind === 'image') items.push({ label: 'Blurred fill behind it', hint: 'fills the frame with a soft copy', checked: !!selected.fillBlur, disabled: !!selected.fillBlur, onClick: add('fill', { fillBlur: 60 }) })
      items.push({ label: 'Blend mode', checked: !!selected.blend, disabled: !!selected.blend, onClick: add('blend', { blend: 'screen' }) })
      items.push({ label: 'Shadow and glow', checked: !!selected.shade, disabled: !!selected.shade, onClick: add('shade', { shade: { ...DEFAULT_SHADE } }) })
      items.push({ label: 'Animation', hint: 'zoom, bounce, slow pan…', onClick: () => setOpen((o) => ({ ...o, anim: true })) })
      items.push({
        label: 'Keyframes', hint: 'move it over time', checked: !!selected.keys, disabled: !!selected.keys,
        onClick: () => { commit(updateSel(project, addKeyAt(frame, sources, selected, selLocal))); setOpen((o) => ({ ...o, keys: true })) },
      })
    }
    // A transition needs a clip right before this one on the same track, touching it.
    const hasPrev = shown(project).some((x) => x.kind === selectedPl.kind && x.trackIndex === selectedPl.trackIndex && Math.abs(x.end - selectedPl.start) < 1e-3 && x.clip.id !== selected.id)
    if (onScreen || sound) {
      items.push({
        label: 'Transition from the clip before', hint: hasPrev ? 'fade, wipe, slide, zoom…' : 'needs a clip touching it on the left',
        checked: !!selected.tIn, disabled: !!selected.tIn || !hasPrev,
        onClick: add('tIn', { tIn: { type: 'dissolve', d: 0.6 } }),
      })
    }
    if (sound) {
      if (items.length) items.push('line')
      items.push({ label: 'Sound effect', hint: 'tone, compressor, echo, pitch…', checked: !!selected.sfx, disabled: !!selected.sfx, onClick: add('sfx', { sfx: { ...NO_SFX } }) })
      items.push({
        label: 'Volume line', hint: 'on the clip in the timeline', checked: !!selected.volPoints, disabled: !!selected.volPoints,
        onClick: add('sound', { volPoints: [{ t: 0, v: 1 }, { t: Math.max(0.1, selectedPl.end - selectedPl.start), v: 1 }] }),
      })
    }
    if (!items.length) items.push({ label: 'Nothing to add to this clip', disabled: true, onClick: () => {} })
    setMenu({ x, y, items })
  }

  // A .cube colour look file, kept inside the project so the edit carries it.
  async function loadCube() {
    const file = await new Promise<File | null>((ok) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.cube'
      input.onchange = () => ok(input.files?.[0] ?? null)
      input.click()
    })
    if (!file || !selected) return
    try {
      if (file.size > 8_000_000) throw new Error('the file is larger than a colour look should be')
      const lut = parseCube(await file.text(), file.name)
      const id = newId('lut')
      commit(updateSel({ ...project, luts: { ...(project.luts ?? {}), [id]: lut } }, { lut: { id, strength: selected.lut?.strength ?? 100 } }))
    } catch (err) {
      setError(`Could not use ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const setTransformLive = (t: Transform, scale?: number) => {
    if (!selected) return
    // A clip following a tracked object: moving it changes how far it sits from the object.
    if (selected.follow && followPt) {
      const follow = { ...selected.follow, ox: t.x - followPt.x, oy: t.y - followPt.y }
      live((p) => updateSel(p, { follow, transform: { ...(findPlaced(p, selected.id)?.clip.transform ?? t), w: t.w, h: t.h, rotation: t.rotation, opacity: t.opacity } }))
      return
    }
    if (selected.kind === 'text' && scale && selected.text) {
      // A text box pulled from a corner: the letters (and their outline) scale from where the drag started.
      const before = findPlaced(liveBase.current ?? project, selected.id)?.clip.text ?? selected.text
      const text = { ...selected.text, size: Math.max(6, before.size * scale), outlineWidth: before.outlineWidth * scale }
      live((p) => updateSel(p, { ...placeAt(findPlaced(p, selected.id)?.clip ?? selected, selLocal, t), text }))
    } else live((p) => updateSel(p, placeAt(findPlaced(p, selected.id)?.clip ?? selected, selLocal, t)))
  }
  const frameId = FRAMES.find((f) => f.frame.w === frame.w && f.frame.h === frame.h)?.id ?? (mode === 'picture' ? `${frame.w}x${frame.h}` : '9:16')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>Postbarrel <b>Vid Editor</b></span>
        </div>
        <div className="tabs">
          <button title="Edit" className={mode === 'edit' ? 'on' : ''} onClick={blurThen(() => switchTab('edit'))}><Film size={15} /> Edit</button>
          {IS_WEB && <button title="Write a script from your notes" className={mode === 'script' ? 'on' : ''} onClick={blurThen(() => switchTab('script'))}><PenLine size={15} /> Script</button>}
          <button title="Teleprompter" className={mode === 'prompt' ? 'on' : ''} onClick={blurThen(() => switchTab('prompt'))}><ScrollText size={15} /> Teleprompter</button>
          <button title="Picture" className={mode === 'picture' ? 'on' : ''} onClick={blurThen(() => switchTab('picture'))}><ImageIcon size={15} /> Picture</button>
        </div>
        <div className="title">
          {IS_WEB ? <span className="edition">Free web version</span> : renamingTop ? (
            <input className="project-name-edit" autoFocus defaultValue={projectName} maxLength={120}
              onBlur={(e) => { const n = e.target.value.trim(); if (n && currentId) renameProject(currentId, n); setRenamingTop(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenamingTop(false) }} />
          ) : (
            <button className="project-name" onClick={() => setRenamingTop(true)} title="Rename this project">{projectName}</button>
          )}
          <span className="saved-note" title={fileHandle ? `Saved into ${fileHandle.name} and in this browser` : 'Saved in this browser on your PC'}>{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
        <div className="top-actions">
          {IS_WEB ? (
            <button className="icon-btn" onClick={blurThen(() => (projectDuration(project) > 0 ? setAskNew(true) : startNew()))} title="New edit"><FilePlus size={18} /></button>
          ) : (
            <>
              <button className="icon-btn" onClick={blurThen(async () => { await goHome(); setHomeAsksName(true) })} title="New project"><FilePlus size={18} /></button>
              <button className="icon-btn" onClick={blurThen(openProjectFile)} title="Open a project file"><FolderOpen size={18} /></button>
              <button className="icon-btn" onClick={blurThen(saveProjectFile)} title={fileHandle ? `Save now (it also saves by itself into ${fileHandle.name})` : 'Save this edit as a project file'}><Save size={18} /></button>
            </>
          )}
          <span className="sep" />
          <button className="icon-btn" onClick={blurThen(undo)} disabled={!history.past.length} title="Undo (Ctrl+Z)"><Undo2 size={18} /></button>
          <button className="icon-btn" onClick={blurThen(redo)} disabled={!history.future.length} title="Redo (Ctrl+Y)"><Redo2 size={18} /></button>
          <span className="sep" />
          <label className="frame-pick" title="The shape of the video">
            <select value={frameId} onChange={(e) => {
              if (e.target.value === 'photo') { photoSize(); return }
              const f = FRAMES.find((x) => x.id === e.target.value)
              if (f) commit({ ...project, frame: f.frame })
            }}>
              {FRAMES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              {mode === 'picture' && !FRAMES.some((f) => f.id === frameId) && <option value={frameId}>{frame.w} × {frame.h}</option>}
              {mode === 'picture' && <option value="photo">The photo's own size</option>}
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

      {IS_WEB && welcome && <Welcome onWeb={() => setWelcome(false)} />}
      {IS_WEB && browserNote && (
        <div className="banner warn">
          <span>This editor works best in Chrome or Microsoft Edge on a computer. Some things, like saving straight into a folder, may not work here.</span>
          <button onClick={() => { closeBrowserNote(); setBrowserNote(false) }}>Close</button>
        </div>
      )}
      {IS_WEB && restorable && (
        <div className="banner">
          <span>Your last edit from {new Date(restorable.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} is saved in this browser.</span>
          <button className="primary" onClick={() => restore(restorable)}>Carry on</button>
          <button onClick={startNew}>Start new</button>
        </div>
      )}
      {IS_WEB && askNew && (
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
      {!IS_WEB && !currentId && checked !== 'waiting' && (
        <Home
          projects={projects}
          theme={theme}
          onTheme={() => setTheme(theme === 'dark' ? 'grey' : 'dark')}
          asksName={homeAsksName}
          onAskedName={() => setHomeAsksName(false)}
          onNew={newProject}
          onOpen={openProject}
          onRestoreVersion={restoreVersion}
          onOpenFile={openProjectFile}
          onRename={renameProject}
          onDuplicate={duplicateProject}
          onDelete={removeProject}
        />
      )}
      {missing && (
        <div className="banner warn">
          <span>
            {missing.ids.length === 1 ? 'One file was not found where it was' : `${missing.ids.length} files were not found where they were`}:{' '}
            {missing.saved.sources.filter((x) => missing.ids.includes(x.id)).map((x) => x.name).join(', ')}
          </span>
          <button className="primary" onClick={locateMissing}>Find {missing.ids.length === 1 ? 'it' : 'them'}</button>
          {IS_WEB
            ? <button onClick={() => setMissing(null)} title="Keep what was found">Cancel</button>
            : <button onClick={() => { resetEditor(); setCurrentId(null); refreshProjects() }} title="Back to the projects, nothing changed">Cancel</button>}
        </div>
      )}
      {drawingOn && (
        <div className="banner">
          <span>Drawing: drag on the picture. Each stroke is its own layer: click it later to change its colour or thickness.</span>
          <button className="primary" onClick={() => setDrawingOn(false)}>Done</button>
        </div>
      )}
      {collageOpen && <CollageDialog frame={frame} onMake={makeCollage} onClose={() => setCollageOpen(false)} />}
      {stickersOpen && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setStickersOpen(false)}>
          <div className="modal">
            <h2>Emoji and stickers</h2>
            <div className="sticker-grid">
              {STICKERS.map((s) => <button key={s} onClick={() => addSticker(s)} title="Add this sticker">{s}</button>)}
            </div>
            <div className="modal-buttons"><button onClick={() => setStickersOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
      {loading && <div className="banner"><span>Reading the file…</span></div>}
      {notice && <div className="banner"><span>{notice}</span><button onClick={() => setNotice(null)}>Close</button></div>}
      {mc && (
        <div className="banner">
          <span>Cutting between angles: press {mc.ids.map((_, i) => i + 1).join(', ')} while it plays. Showing angle {mc.angle + 1}. {mc.cuts.length - 1} cut{mc.cuts.length === 2 ? '' : 's'}.</span>
          {mc.ids.map((_, i) => <button key={i} className={mc.angle === i ? 'primary' : ''} onClick={() => cutTo(i)}>{i + 1}</button>)}
          <button onClick={() => finishMulticam(false)}>Cancel</button>
          <button className="primary" onClick={() => finishMulticam(true)}>Stop and keep</button>
        </div>
      )}
      {screenRec && (
        <div className="banner bad">
          <span><span className="rec-dot" /> Recording the screen…</span>
          <button className="primary" onClick={screenRec.stop}>Stop</button>
        </div>
      )}
      {voice && (
        <div className="banner bad">
          <span><span className="rec-dot" /> Recording a voiceover from {formatTime(voice.at)}…</span>
          <button className="primary" onClick={stopVoiceover}>Stop</button>
        </div>
      )}
      {error && (
        <div className="banner bad">
          <span>{error}</span>
          {IS_WEB && /free app/.test(error) && <a className="banner-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Get the free app</a>}
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
          countUse('take')
          await addFile(file)
          saveTake(keyOf(file), file).catch(() => setError('The take is on the timeline but could not be kept in this browser. Save it as a file.'))
        }}
      />
      {IS_WEB && (
        <ScriptWriter
          active={mode === 'script'}
          onUse={(script) => {
            setHistory((h) => ({ ...h, present: { ...h.present, script } }))
            switchTab('prompt')
          }}
        />
      )}
      <div className="edit-view" hidden={mode === 'prompt' || mode === 'script'}>
      <nav className="rail">
        {!IS_WEB && (
          <>
            <button className="rail-btn" onClick={blurThen(goHome)} title="All projects"><House size={20} /><span>Home</span></button>
            <span className="rail-sep" />
          </>
        )}
        <div className="rail-item">
          <button className="rail-btn accent" onClick={blurThen(pickFiles)} title="Add video, picture or sound"><Plus size={22} /><span>Media</span></button>
          <RailMore onOpen={(x, y) => railMenu('media', x, y)} title="More: media list" />
        </div>
        <div className="rail-item">
          <button className="rail-btn" onClick={blurThen(addText)} title="Text on a layer at the playhead"><Type size={20} /><span>Text</span></button>
          <RailMore onOpen={(x, y) => railMenu('text', x, y)} title="More: countdown, credits, brand kit" />
        </div>
        {mode !== 'picture' && (
        <div className="rail-item">
          {IS_WEB ? (
            <button className="rail-btn app-only" onClick={blurThen(openDownload)} title="Captions from your voice are in the free app: opens the download page"><Captions size={20} /><span>Captions</span><span className="app-tag rail-tag">App</span></button>
          ) : (
            <>
              <button className="rail-btn" onClick={blurThen(() => { playerRef.current?.pause(); setCaptioning(true) })} disabled={duration === 0} title="Captions from your voice, made on this PC"><Captions size={20} /><span>Captions</span></button>
              <RailMore onOpen={(x, y) => railMenu('captions', x, y)} title="More: word by word, import SRT, save VTT" />
            </>
          )}
        </div>
        )}
        <div className="rail-item">
          <button className="rail-btn" onClick={blurThen(addColourBlock)} title="A plain block on a layer, black to start with"><Square size={20} /><span>Block</span></button>
          <RailMore onOpen={(x, y) => railMenu('block', x, y)} title="More: shapes (circle, star, arrow, speech bubble…)" />
        </div>
        {mode === 'picture' && (
          <button className="rail-btn" onClick={blurThen(() => setCollageOpen(true))} title="Photos in a grid"><LayoutGrid size={20} /><span>Collage</span></button>
        )}
        {mode !== 'picture' && (
          <>
        <span className="rail-sep" />
        <div className="rail-item">
          <button className="rail-btn" onClick={blurThen(() => commit(addTrack(project, 'video')))} title="A new empty layer on top"><Layers size={20} /><span>Layer</span></button>
          <RailMore onOpen={(x, y) => railMenu('layer', x, y)} title="More: adjustment layer, split screen, picture in picture" />
        </div>
        <div className="rail-item">
          <button className="rail-btn" onClick={blurThen(() => commit(addTrack(project, 'audio')))} title="A new empty sound track"><Music size={20} /><span>Sound</span></button>
          <RailMore onOpen={(x, y) => railMenu('sound', x, y)} title="More: record a voiceover, loudness" />
        </div>
          </>
        )}
      </nav>
      <main>
        <section className="preview">
          <div className="stage-box">
          {showScopes && <Scopes source={previewRef} onClose={() => setShowScopes(false)} />}
          <div className={`stage${nudging && showingSelected ? ' nudging' : ''}`} style={{ '--ar': frame.w / frame.h } as React.CSSProperties} title={nudging ? 'Arrow keys nudge the selected picture' : undefined}>
            <canvas ref={previewRef} />
            {duration === 0 && <p className="note empty-note">{mode === 'picture' ? 'Add a photo with Media to start.' : 'Add a video to start.'}</p>}
            <PreviewOverlay
              frame={frame}
              transform={showingSelected ? selectedTransform : null}
              boxDraw={boxFor && selected?.id === boxFor ? (x0, y0, x1, y1) => setTrackBox(boxFor, x0, y0, x1, y1) : undefined}
              freehand={drawingOn ? addStroke : undefined}
              onLive={setTransformLive}
              pen={penFor && selected?.id === penFor && selected.mask && selectedTransform ? {
                // Points are kept as fractions of the clip's box, so the shape moves and scales with the clip.
                points: (selected.mask.points ?? []).map(([fx, fy]) => [selectedTransform.x + (fx - 0.5) * selectedTransform.w, selectedTransform.y + (fy - 0.5) * selectedTransform.h] as [number, number]),
                onAdd: (x, y) => {
                  const t = selectedTransform
                  const pt: [number, number] = [(x - (t.x - t.w / 2)) / t.w, (y - (t.y - t.h / 2)) / t.h]
                  const fresh = penFor !== penStarted.current
                  penStarted.current = penFor
                  commit(updateSel(project, { mask: { ...selected.mask!, points: [...(fresh ? [] : selected.mask!.points ?? []), pt] } }))
                },
              } : undefined}
              onCommit={commitLive}
              onPick={pick}
              textMode={selected?.kind === 'text'}
              onEditText={editText}
              onActivate={() => setNudging(true)}
            />
          </div>
          </div>
          <div className="controls" hidden={mode === 'picture'}>
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
              <div className="details-head">
                <h2>{selected.kind === 'color' ? 'Colour block' : selected.kind === 'shape' ? SHAPES.find((k) => k.id === selected.shape?.kind)?.label ?? 'Shape' : selected.kind === 'adjust' ? 'Adjustment layer' : selected.kind === 'image' ? selected.label ?? 'Picture' : selected.caption ? 'Caption' : selected.kind === 'text' ? 'Text' : selectedSource?.name}</h2>
                <button className="add-btn" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); e.currentTarget.blur(); addMenu(b.left, b.bottom + 4) }} title="Add an effect, green screen, colour look, blend, shadow or sound effect">
                  <Plus size={14} /> Add
                </button>
              </div>
              {selected.caption && (
                <label className="check cap-all">
                  <input type="checkbox" checked={capAll} onChange={(e) => setCapAll(e.target.checked)} />
                  Apply changes to all captions
                </label>
              )}
              {selected.caption &&
                fold('lines', 'Caption lines', (
                  <div className="cap-lines">
                    {captionLines(project, selected.caption).map((pl) => (
                      <div key={pl.clip.id} className={`cap-line${pl.clip.id === selected.id ? ' current' : ''}`}>
                        <button className="cap-time" title="Go to this line" onClick={() => { setSelectedId(pl.clip.id); playerRef.current?.seek(pl.start + 0.01) }}>
                          {formatTime(pl.start).slice(0, -1)}
                        </button>
                        <input
                          spellCheck
                          value={pl.clip.text?.text ?? ''}
                          onFocus={() => { setSelectedId(pl.clip.id); playerRef.current?.seek(pl.start + 0.01) }}
                          onChange={(e) => live((p) => updateClip(p, pl.clip.id, { text: { ...(pl.clip.text ?? DEFAULT_TEXT), text: e.target.value } }))}
                          onBlur={commitLive}
                        />
                      </div>
                    ))}
                    <div className="light-buttons">
                      <button title="Copy this line's look and place to every caption" onClick={() => {
                        let next = project
                        for (const pl of captionLines(project, selected.caption!)) {
                          if (pl.clip.id === selected.id) continue
                          next = updateClip(next, pl.clip.id, { text: { ...selected.text!, text: pl.clip.text?.text ?? '' }, transform: selected.transform })
                        }
                        commit(next)
                      }}>Use this look on all</button>
                      <button onClick={() => saveSrt(selected.caption!)}>Save as SRT</button>
                    </div>
                  </div>
                ))}
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
              {selected.kind === 'shape' && selected.shape &&
                fold('shape', 'Shape', (
                  <ShapePanel value={selected.shape} onLive={(shape) => live((p) => updateSel(p, { shape }))} onSet={(shape) => commit(updateSel(project, { shape }))} onCommit={commitLive} />
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
              {selected.kind === 'adjust' &&
                fold('transform', 'Amount', (
                  <label className="slider-row">
                    <span>How much</span>
                    <input type="range" min={0} max={100} value={Math.round((selected.transform?.opacity ?? 1) * 100)}
                      onChange={(e) => live((p) => updateSel(p, { transform: { ...transformOf(frame, sources, selected), opacity: Number(e.target.value) / 100 } }))}
                      onPointerUp={commitLive} onKeyUp={commitLive} />
                    <span className="value">{Math.round((selected.transform?.opacity ?? 1) * 100)}%</span>
                  </label>
                ))}
              {selectedTransform && selected.kind !== 'adjust' &&
                fold('transform', 'Position and size', (
                  <TransformPanel
                    frame={frame}
                    transform={selectedTransform}
                    srcSize={sourceSize(sources, selected) ?? [frame.w, frame.h]}
                    onLive={setTransformLive}
                    onCommit={commitLive}
                    onSet={(t) => commit(updateSel(project, placeAt(selected, selLocal, t)))}
                  />
                ))}
              {selectedTransform && (selected.kind === 'image' || selected.kind === 'media') && Math.abs(selectedTransform.rotation) <= 20 &&
                fold('straighten', 'Straighten', (
                  <div className="effects">
                    <label className="slider-row">
                      <span>Turn</span>
                      <input type="range" min={-20} max={20} step={0.1} value={selectedTransform.rotation}
                        onChange={(e) => setTransformLive(straighten(selectedTransform, Number(e.target.value)))}
                        onPointerUp={commitLive} onKeyUp={commitLive} onDoubleClick={() => commit(updateSel(project, placeAt(selected, selLocal, straighten(selectedTransform, 0))))} />
                      <span className="value">{selectedTransform.rotation.toFixed(1)}°</span>
                    </label>
                    <p className="note">For a tilted photo. It zooms in just enough that no corners show. Double-click to put it back.</p>
                  </div>
                ))}
              {selected.keys &&
                fold('keys', 'Keyframes', (
                  <div className="effects">
                    <p className="note">Move or change the box at another moment and a keyframe is made there. In between, it moves by itself.</p>
                    <div className="light-buttons">
                      <button onClick={() => commit(updateSel(project, addKeyAt(frame, sources, selected, selLocal)))}>◆ Keyframe at the playhead</button>
                    </div>
                    <div className="chips">
                      <button className={(selected.path ?? 'straight') === 'straight' ? 'on' : ''} onClick={() => commit(updateSel(project, { path: 'straight' }))}>Straight path</button>
                      <button className={selected.path === 'curved' ? 'on' : ''} onClick={() => commit(updateSel(project, { path: 'curved' }))}>Curved path</button>
                    </div>
                    <div className="jobs">
                      {selected.keys.map((k, i) => (
                        <div key={i} className={`job${Math.abs(k.t - selLocal) < 0.02 ? ' here' : ''}`}>
                          <button className="link" onClick={() => playerRef.current?.seek(selectedPl!.start + k.t)} title="Go to this keyframe">◆ {formatTime(k.t)}</button>
                          {i > 0 ? (
                            <select value={k.ease} title="How it moves into this keyframe"
                              onChange={(e) => commit(updateSel(project, { keys: selected.keys!.map((x, j) => (j === i ? { ...x, ease: e.target.value as Ease } : x)) }))}>
                              <option value="smooth">Smooth</option>
                              <option value="linear">Steady</option>
                              <option value="in">Speeds up</option>
                              <option value="out">Slows down</option>
                              <option value="hold">Jumps (no movement)</option>
                            </select>
                          ) : <span className="note">start</span>}
                          <button onClick={() => commit(updateSel(project, { keys: selected.keys!.filter((_, j) => j !== i) }))} title="Remove this keyframe">×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ), () => commit(updateSel(project, { keys: undefined, transform: selectedTransform ?? selected.transform })))}
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
                    ramp={selected.ramp}
                    onRamp={(ramp) => commit(updateClip(project, selected.id, { ramp }))}
                    onRampLive={(ramp) => live((p) => updateClip(p, selected.id, { ramp }))}
                    onReverse={() => reverseClip(selected.id)}
                    reversing={reversing}
                  />
                ))}
              {selectedPl?.kind === 'video' && selected.kind !== 'adjust' && mode !== 'picture' &&
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
              {(selectedSource?.media.videoTrack || selected.kind === 'image' || selected.kind === 'adjust') &&
                fold('light', 'Fix light and colour', (
                  <LightPanel
                    look={selected.look ?? NEUTRAL}
                    busy={autoBusy}
                    onLive={(look: Look) => live((p) => updateSel(p, { look }))}
                    onCommit={commitLive}
                    onSet={(look: Look) => commit(updateSel(project, { look }))}
                    onAuto={selected.kind === 'adjust' ? undefined : () => autoFix(selected)}
                    scopes={showScopes}
                    onScopes={setShowScopes}
                    onApplyAll={() => {
                      let next = project
                      for (const pl of layout(project)) if (pl.clip.kind === 'media') next = updateClip(next, pl.clip.id, { look: selected.look ?? NEUTRAL })
                      commit(next)
                    }}
                  />
                ))}
              {selected.lut &&
                fold('lut', 'Colour look', (
                  <LookPanel value={selected.lut} luts={project.luts ?? {}} onLive={(lut) => live((p) => updateSel(p, { lut }))} onSet={(lut) => commit(updateSel(project, { lut }))} onCommit={commitLive} onLoad={loadCube} />
                ), () => commit(updateSel(project, { lut: undefined })))}
              {selected.fx &&
                fold('fx', 'Effect', (
                  <EffectsPanel value={selected.fx} onLive={(fx) => live((p) => updateSel(p, { fx }))} onSet={(fx) => commit(updateSel(project, { fx }))} onCommit={commitLive} />
                ), () => commit(updateSel(project, { fx: undefined })))}
              {selected.key &&
                fold('key', 'Green screen', (
                  <KeyPanel value={selected.key} onLive={(key) => live((p) => updateSel(p, { key }))} onSet={(key) => commit(updateSel(project, { key }))} onCommit={commitLive} />
                ), () => commit(updateSel(project, { key: undefined })))}
              {!!selected.fillBlur &&
                fold('fill', 'Blurred fill', (
                  <div className="effects">
                    <label className="slider-row">
                      <span>Softness</span>
                      <input type="range" min={10} max={100} value={selected.fillBlur} onChange={(e) => live((p) => updateSel(p, { fillBlur: Number(e.target.value) }))} onPointerUp={commitLive} onKeyUp={commitLive} />
                      <span className="value">{selected.fillBlur}</span>
                    </label>
                    <p className="note">A soft copy of the same picture fills the frame behind it, so a wide or square photo fits a tall video with no black bars.</p>
                  </div>
                ), () => commit(updateSel(project, { fillBlur: undefined })))}
              {selected.blend &&
                fold('blend', 'Blend mode', (
                  <BlendPanel value={selected.blend} onSet={(blend) => commit(updateSel(project, { blend }))} />
                ), () => commit(updateSel(project, { blend: undefined })))}
              {selected.shade &&
                fold('shade', 'Shadow and glow', (
                  <ShadePanel value={selected.shade} onLive={(shade) => live((p) => updateSel(p, { shade }))} onSet={(shade) => commit(updateSel(project, { shade }))} onCommit={commitLive} />
                ), () => commit(updateSel(project, { shade: undefined })))}
              {selected.stab &&
                fold('stab', 'Stabilise', (
                  <div className="effects">
                    <label className="slider-row">
                      <span>Smoothness</span>
                      <input type="range" min={10} max={100} value={selected.stab.strength} onChange={(e) => live((p) => updateSel(p, { stab: { ...selected.stab!, strength: Number(e.target.value) } }))} onPointerUp={commitLive} />
                      <span className="value">{selected.stab.strength}</span>
                    </label>
                    <label className="slider-row">
                      <span>Zoom (hides edges)</span>
                      <input type="range" min={1} max={1.3} step={0.01} value={selected.stab.zoom} onChange={(e) => live((p) => updateSel(p, { stab: { ...selected.stab!, zoom: Number(e.target.value) } }))} onPointerUp={commitLive} />
                      <span className="value">{Math.round((selected.stab.zoom - 1) * 100)}%</span>
                    </label>
                    <div className="light-buttons">
                      <button disabled={!!working} onClick={() => runStab(selected.id, selected.stab!.strength, selected.stab!.zoom)}>
                        {working?.what === 'Stabilising' ? `Reading the shake… ${Math.round(working.f * 100)}%` : selected.stab.data.length ? 'Read it again with this smoothness' : 'Read the shake'}
                      </button>
                    </div>
                    <p className="note">{selected.stab.data.length ? `Steadied over ${selected.stab.data.length} frames.` : 'Not read yet.'} More smoothness takes out bigger wobbles but can feel floaty.</p>
                  </div>
                ), () => commit(updateSel(project, { stab: undefined })))}
              {selected.track &&
                fold('track', 'Tracking', (
                  <div className="effects">
                    <div className="light-buttons">
                      <button onClick={() => setBoxFor(boxFor === selected.id ? null : selected.id)}>
                        {boxFor === selected.id ? 'Cancel' : 'Draw a box round it again'}
                      </button>
                      <button disabled={!!working || boxFor === selected.id} onClick={() => runTrack(selected.id)}>
                        {working?.what === 'Tracking' ? `Tracking… ${Math.round(working.f * 100)}%` : 'Track it from the playhead'}
                      </button>
                    </div>
                    {boxFor === selected.id && <p className="warn-note">Now drag a box round the thing on the picture.</p>}
                    <p className="note">{selected.track.points.length ? `Tracked over ${selected.track.points.length} frames.` : 'Draw a box round the thing to follow, then track it. It follows position, not size or turn.'}</p>
                    {selected.track.points.length > 0 && (
                      <div className="light-buttons">
                        <button onClick={() => blurTracked(selected.id)}>Blur it</button>
                        <button onClick={() => textOnTracked(selected.id)}>Stick text to it</button>
                      </div>
                    )}
                  </div>
                ), () => { setBoxFor(null); commit(updateSel(project, { track: undefined })) })}
              {selected.follow &&
                fold('follow', 'Follows a tracked object', (
                  <p className="note effects">This clip moves with what is tracked in another clip. Drag it to change how far from it it sits.</p>
                ), () => commit(updateSel(project, { follow: undefined, transform: selectedTransform ?? selected.transform })))}
              {selected.mask &&
                fold('mask', 'Mask', (() => {
                  const m = selected.mask!
                  const setM = (patch: Partial<Mask>) => live((p) => updateSel(p, { mask: { ...m, ...patch } }))
                  const row = (label: string, key: 'x' | 'y' | 'w' | 'h', min = 0, max = 1) => (
                    <label className="slider-row">
                      <span>{label}</span>
                      <input type="range" min={min} max={max} step={0.005} value={m[key]} onChange={(e) => setM({ [key]: Number(e.target.value) })} onPointerUp={commitLive} onKeyUp={commitLive} />
                      <span className="value">{Math.round(m[key] * 100)}%</span>
                    </label>
                  )
                  return (
                    <div className="effects">
                      <div className="chips">
                        {([['rect', 'Rectangle'], ['round', 'Rounded'], ['ellipse', 'Oval'], ['pen', 'Draw it']] as const).map(([id, label]) => (
                          <button key={id} className={m.shape === id ? 'on' : ''} onClick={() => commit(updateSel(project, { mask: { ...m, shape: id } }))}>{label}</button>
                        ))}
                      </div>
                      {m.shape === 'pen' ? (
                        <div className="light-buttons">
                          <button className={penFor === selected.id ? 'primary' : ''} onClick={() => { if (penFor !== selected.id) penStarted.current = null; setPenFor(penFor === selected.id ? null : selected.id) }}>
                            {penFor === selected.id ? 'Done drawing' : m.points?.length ? 'Draw it again' : 'Draw on the picture'}
                          </button>
                          {penFor === selected.id && <span className="note">Click round the shape on the picture. {m.points?.length ?? 0} points.</span>}
                        </div>
                      ) : (
                        <>
                          {row('Across', 'x')}
                          {row('Up / down', 'y')}
                          {row('Width', 'w', 0.02, 1.5)}
                          {row('Height', 'h', 0.02, 1.5)}
                        </>
                      )}
                      <label className="slider-row">
                        <span>Soft edge</span>
                        <input type="range" min={0} max={200} value={m.feather} onChange={(e) => setM({ feather: Number(e.target.value) })} onPointerUp={commitLive} onKeyUp={commitLive} />
                        <span className="value">{m.feather}</span>
                      </label>
                      <label className="check"><input type="checkbox" checked={m.invert} onChange={(e) => commit(updateSel(project, { mask: { ...m, invert: e.target.checked } }))} />Turn it inside out</label>
                      <div className="chips">
                        <button className={m.mode === 'cut' ? 'on' : ''} onClick={() => commit(updateSel(project, { mask: { ...m, mode: 'cut' } }))}>Show only this part</button>
                        <button className={m.mode === 'colour' ? 'on' : ''} onClick={() => commit(updateSel(project, { mask: { ...m, mode: 'colour' } }))} title="The light, colour, look and effects change only inside the shape">Colour only this part</button>
                      </div>
                    </div>
                  )
                })(), () => { setPenFor(null); commit(updateSel(project, { mask: undefined })) })}
              {selected.matte &&
                fold('matte', 'Track matte', (
                  <div className="effects">
                    <p className="note">The layer straight above this one gives the shape, and is not shown itself. Text works well: the video shows through the letters.</p>
                    <div className="chips">
                      {([['alpha', 'Inside its shape'], ['alphaInv', 'Outside its shape'], ['luma', 'Its bright parts'], ['lumaInv', 'Its dark parts']] as [Matte, string][]).map(([id, label]) => (
                        <button key={id} className={selected.matte === id ? 'on' : ''} onClick={() => commit(updateSel(project, { matte: id }))}>{label}</button>
                      ))}
                    </div>
                  </div>
                ), () => commit(updateSel(project, { matte: undefined })))}
              {selected.tIn &&
                fold('tIn', 'Transition in', (
                  <div className="effects">
                    <div className="chips">
                      {TRANSITIONS.filter((tr) => !IS_WEB || WEB_TRANSITIONS.includes(tr.id)).map((tr) => (
                        <button key={tr.id} className={selected.tIn!.type === tr.id ? 'on' : ''} onClick={() => commit(updateSel(project, { tIn: { ...selected.tIn!, type: tr.id } }))}>{tr.label}</button>
                      ))}
                    </div>
                    {IS_WEB && <AppMore what="wipe, slide, push, zoom, spin, blur, circle and more transitions" />}
                    <label className="slider-row">
                      <span>Length</span>
                      <input type="range" min={0.2} max={2} step={0.1} value={selected.tIn.d}
                        onChange={(e) => live((p) => updateSel(p, { tIn: { ...selected.tIn!, d: Number(e.target.value) } }))} onPointerUp={commitLive} onKeyUp={commitLive} />
                      <span className="value">{selected.tIn.d.toFixed(1)}s</span>
                    </label>
                    <p className="note">Centred on the cut, so the edit stays the same length. The sound crossfades with it.</p>
                    <div className="light-buttons">
                      <button onClick={() => {
                        // The same transition on every cut of this track.
                        const tIn: Transition = { ...selected.tIn! }
                        let next = project
                        const all = shown(project).filter((x) => x.kind === selectedPl!.kind && x.trackIndex === selectedPl!.trackIndex)
                        for (const x of all) if (all.some((y) => Math.abs(y.end - x.start) < 1e-3 && y.clip.id !== x.clip.id)) next = updateClip(next, x.clip.id, { tIn })
                        commit(next)
                      }}>Use on every cut of this track</button>
                    </div>
                  </div>
                ), () => commit(updateSel(project, { tIn: undefined })))}
              {selected.sfx &&
                fold('sfx', 'Sound effect', (
                  <SfxPanel value={selected.sfx} onLive={(sfx) => live((p) => updateSel(p, { sfx }))} onSet={(sfx) => commit(updateSel(project, { sfx }))} onCommit={commitLive} />
                ), () => commit(updateSel(project, { sfx: undefined })))}
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
                      onLive={(patch) => live((p) => updateSound(p, patch))}
                      onCommit={commitLive}
                      onSet={(patch) => commit(updateSound(project, patch))}
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

      {mode === 'picture' && (
        <div className="tl-area" style={{ height: tlHeight }}>
          <div className="tl-resize" onPointerDown={startTlResize} title="Drag to make this taller or shorter" />
          <LayersPanel
            project={project}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(i, dir) => commit(moveLayer(project, i, dir))}
            onHide={(i) => commit(updateTrack(project, project.video[i].id, { hidden: !project.video[i].hidden }))}
            onDelete={(id) => { commit(removeClip(project, id)); if (id === selectedId) setSelectedId(null) }}
            onExport={() => setExporting(true)}
            onUseInEdit={useInEdit}
            busy={loading}
          />
        </div>
      )}
      <div className="tl-area" style={{ height: tlHeight }} hidden={mode === 'picture'}>
      <div className="tl-resize" onPointerDown={startTlResize} title="Drag to make the timeline taller or shorter" />
      <div className="toolbar">
        <button className="seq-btn" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); e.currentTarget.blur(); seqMenu(b.left, b.bottom + 4) }} title="Switch timelines, or make a new one">
          {activeName(project)} <ChevronDown size={13} />
        </button>
        <button className="icon-btn" onClick={blurThen(split)} disabled={duration === 0} title="Split at the playhead (S)"><Scissors size={17} /></button>
        <button className="icon-btn" onClick={blurThen(() => remove(false))} disabled={!selectedId} title="Delete the selected clip (Delete). Shift+Delete also closes the gap"><Trash2 size={17} /></button>
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
        onMove={move}
        onRemoveTrack={requestRemoveTrack}
        onAddTrack={(kind, after) => commit(addTrack(project, kind, after))}
        extraIds={extraIds}
        onToggleSelect={(id) => {
          if (!selectedId) setSelectedIdOnly(id)
          else if (id === selectedId) {
            setSelectedIdOnly(extraIds[0] ?? null)
            setExtraIds(extraIds.slice(1))
          } else setExtraIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
        }}
        onSelectMany={(ids) => {
          setSelectedIdOnly(ids[0] ?? null)
          setExtraIds(ids.slice(1))
        }}
        onLive={(next) => live(() => next)}
        onClipMenu={clipMenu}
        onRowMenu={rowMenu}
        onTrackMenu={trackMenu}
        onMarkerMenu={markerMenu}
        onSetClip={(id, patch) => commit(updateClip(project, id, patch))}
        cached={cached && playerRef.current?.cachedRange ? cached : null}
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
      {brandOpen && <BrandDialog onClose={() => setBrandOpen(false)} />}
      {seqRename && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setSeqRename(null)}>
          <form className="modal" onSubmit={(e) => { e.preventDefault(); commit(renameSeq(project, seqRename.id, seqRename.name.trim() || 'Timeline')); setSeqRename(null) }}>
            <h2>Rename timeline</h2>
            <input autoFocus value={seqRename.name} maxLength={60} onChange={(e) => setSeqRename({ ...seqRename, name: e.target.value })} />
            <div className="modal-buttons">
              <button type="button" onClick={() => setSeqRename(null)}>Cancel</button>
              <button type="submit" className="primary">Rename</button>
            </div>
          </form>
        </div>
      )}
      {screenAsk && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setScreenAsk(false)}>
          <div className="modal">
            <h2>Record the screen</h2>
            <p className="note">Next, your browser asks which screen, window or tab to record. Come back here and press Stop when you are done. It goes on the end of the main track.</p>
            <label className="check"><input type="checkbox" checked={screenCam} onChange={(e) => setScreenCam(e.target.checked)} />Also record my webcam and microphone (a round picture in the corner)</label>
            <div className="modal-buttons">
              <button onClick={() => setScreenAsk(false)}>Cancel</button>
              <button className="primary" onClick={startScreen}>Choose what to record</button>
            </div>
          </div>
        </div>
      )}
      {viewing && <Viewer source={viewing} at={viewAt} onPlace={(a, b, how) => placeFromViewer(viewing, a, b, how)} onClose={() => { setViewing(null); setViewAt(undefined) }} />}
      {titlesOpen && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setTitlesOpen(false)}>
          <div className="modal">
            <div className="info-head">
              <h2>Title templates</h2>
              <button className="icon-btn" onClick={() => setTitlesOpen(false)} title="Close"><X size={18} /></button>
            </div>
            <p className="note">Put on new layers at the playhead, grouped so they move together. Click any word to change it.</p>
            <div className="title-grid">
              {TITLES.map((t) => <button key={t.id} onClick={() => addTitle(t.id)}>{t.name}</button>)}
            </div>
          </div>
        </div>
      )}
      {binOpen && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setBinOpen(false)}>
          <div className="modal bin">
            <div className="info-head">
              <h2>Media list</h2>
              <button className="icon-btn" onClick={() => setBinOpen(false)} title="Close"><X size={18} /></button>
            </div>
            <input className="bin-search" placeholder="Find by name or tag" value={binFilter} onChange={(e) => setBinFilter(e.target.value)} />
            <div className="bin-list">
              {[
                ...sources.map((s) => ({ id: s.id, kind: 'source' as const, name: s.name, info: `${s.media.videoTrack ? 'Video' : 'Sound'}, ${formatTime(s.media.info.duration)}` })),
                ...[...imageFiles.entries()].map(([id, f]) => ({ id, kind: 'image' as const, name: f.name, info: 'Picture' })),
              ]
                .filter((m) => !binFilter.trim() || `${m.name} ${project.tags?.[m.id] ?? ''}`.toLowerCase().includes(binFilter.trim().toLowerCase()))
                .map((m) => (
                  <div key={m.id} className="bin-row">
                    <div className="bin-name"><b>{m.name}</b><span>{m.info}</span></div>
                    <input placeholder="Tags, e.g. b-roll intro" value={project.tags?.[m.id] ?? ''}
                      onChange={(e) => live((p) => ({ ...p, tags: { ...(p.tags ?? {}), [m.id]: e.target.value } }))} onBlur={commitLive} />
                    {m.kind === 'source' ? (
                      <button onClick={() => { setViewing(sources.find((s) => s.id === m.id) ?? null); setBinOpen(false) }} title="Watch it and pick the part you want">View</button>
                    ) : (
                      <button onClick={() => addAgain(m.id, m.kind)} title="Put it on the timeline again">Add</button>
                    )}
                  </div>
                ))}
              {!sources.length && !imageFiles.size && <p className="note">Nothing opened yet. Use Media to add files.</p>}
            </div>
          </div>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {noteEdit && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setNoteEdit(null)}>
          <form className="modal" onSubmit={(e) => { e.preventDefault(); commit(updateMarker(project, noteEdit.id, { note: noteEdit.note.trim() })); setNoteEdit(null) }}>
            <h2>Marker note</h2>
            <input autoFocus value={noteEdit.note} maxLength={80} placeholder="For example: cut the cough" onChange={(e) => setNoteEdit({ ...noteEdit, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setNoteEdit(null) }} />
            <div className="modal-buttons">
              <button type="button" onClick={() => setNoteEdit(null)}>Cancel</button>
              <button type="submit" className="primary">Save</button>
            </div>
          </form>
        </div>
      )}
      {captioning && <CaptionsDialog project={project} sources={sources} selected={selected} onDone={captionsMade} onClose={() => setCaptioning(false)} />}
      {exporting && <ExportDialog sources={sources} project={project} onClose={() => setExporting(false)} selectedRange={selectedPl ? [selectedPl.start, selectedPl.end] : null} at={mode === 'picture' ? 0 : playerRef.current?.now() ?? time} pictureOnly={mode === 'picture'} />}
      </div>
    </div>
  )
}
