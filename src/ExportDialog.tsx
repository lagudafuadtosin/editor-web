import { useEffect, useRef, useState } from 'react'
import { CODECS_FOR, CONTAINERS as ALL_CONTAINERS, encodableCodecs, exportProject, exportStill, outputSize, RESOLUTIONS as ALL_RESOLUTIONS, STILLS, type ExportSettings, type StillType } from './export'
import { IS_WEB } from './edition'
import { countUse } from './usage'
import { AppMore } from './AppMore'

// The web version exports MP4 and MOV up to 1080p; the other formats and sizes are in the free app.
const CONTAINERS = IS_WEB ? ALL_CONTAINERS.filter((c) => c.id === 'mp4' || c.id === 'mov') : ALL_CONTAINERS
const RESOLUTIONS = IS_WEB ? ALL_RESOLUTIONS.filter((r) => r <= 1080) : ALL_RESOLUTIONS
import { duration, type Marker, type Project, type Source } from './model'

type Props = {
  sources: Source[]
  project: Project
  onClose: () => void
  selectedRange?: [number, number] | null // the selected clip's place on the timeline, for "Only part of it"
  at: number // the playhead, for a picture of that moment
  pictureOnly?: boolean // the Picture tab: only picture formats
}

type SaveHandle = { name: string; createWritable: () => Promise<WritableStream & { close: () => Promise<void> }> }
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>

// One-click settings for where the video is going. The frame shape is the project's own (Frame, above the preview).
const PRESETS: { id: string; label: string; settings: ExportSettings; shape?: string }[] = [
  { id: 'short', label: 'TikTok, Reels, Shorts', settings: { container: 'mp4', resolution: 1080, fps: 'original', quality: 'high' }, shape: '9:16' },
  { id: 'youtube', label: 'YouTube', settings: { container: 'mp4', resolution: 1080, fps: 'original', quality: 'best' } },
  { id: 'insta', label: 'Instagram post', settings: { container: 'mp4', resolution: 1080, fps: 30, quality: 'high' }, shape: '4:5' },
  { id: 'small', label: 'Small file to send', settings: { container: 'mp4', resolution: 720, fps: 30, quality: 'medium' } },
]

type Part = 'all' | 'clip' | 'markers'
type Job = { handle: SaveHandle; settings: ExportSettings; label: string }

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

export function ExportDialog({ sources, project, onClose, selectedRange, at, pictureOnly }: Props) {
  // A picture of the frame at the playhead instead of a video (PNG, JPG or WebP).
  const [still, setStill] = useState<StillType | null>(pictureOnly ? 'png' : null)
  const [settings, setSettings] = useState<ExportSettings>({ container: 'mp4', fps: 'original', resolution: 1080, quality: 'high', codec: 'auto' })
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [part, setPart] = useState<Part>('all')
  const [squeeze, setSqueeze] = useState(false)
  const [clear, setClear] = useState(false)
  const [targetMB, setTargetMB] = useState(16)
  const [jobs, setJobs] = useState<Job[]>([])
  const [canMake, setCanMake] = useState<Set<string> | null>(null)
  const abort = useRef<AbortController | null>(null)
  const container = CONTAINERS.find((c) => c.id === settings.container)!
  const [w, h] = outputSize(project.frame, settings.container === 'gif' ? Math.min(540, settings.resolution) : settings.resolution)
  const set = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const total = duration(project)
  const markers: Marker[] = (project.markers ?? []).slice().sort((a, b) => a.t - b.t)
  const shape = `${project.frame.w}:${project.frame.h}`
  const shapeName = ({ '1080:1920': '9:16', '1080:1080': '1:1', '1080:1350': '4:5', '1920:1080': '16:9' } as Record<string, string>)[shape] ?? shape

  // Which codecs this PC can make at this size, so the ones it cannot are greyed out rather than failing later.
  useEffect(() => {
    let gone = false
    encodableCodecs(w, h).then((s) => { if (!gone) setCanMake(s as Set<string>) }).catch(() => {})
    return () => { gone = true }
  }, [w, h])

  const range: [number, number] | null =
    part === 'clip' && selectedRange ? selectedRange : part === 'markers' && markers.length >= 2 ? [markers[0].t, markers[1].t] : null
  const length = range ? range[1] - range[0] : total

  function current(): ExportSettings {
    return { ...settings, range, targetMB: squeeze && !container.audioOnly && settings.container !== 'gif' ? targetMB : null, transparent: clear && (settings.container === 'webm' || settings.container === 'mkv') }
  }

  async function pickSave(s: ExportSettings): Promise<SaveHandle | null> {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (!picker) {
      setMessage('Saving needs Chrome or Edge.')
      return null
    }
    const c = CONTAINERS.find((x) => x.id === s.container)!
    const firstClip = project.video[0].clips[0]
    const base = (sources.find((x) => x.id === firstClip?.sourceId)?.name ?? 'video').replace(/\.[^.]+$/, '')
    try {
      return await picker({ suggestedName: `${base} edit${c.ext}`, types: [{ description: c.label, accept: { [c.mime]: [c.ext] } }] })
    } catch {
      return null // closed the save box
    }
  }

  async function runOne(handle: SaveHandle, s: ExportSettings): Promise<boolean> {
    const writable = await handle.createWritable()
    abort.current = new AbortController()
    setProgress(0)
    try {
      await exportProject(sources, project, s, writable as never, setProgress, abort.current.signal)
      await writable.close()
      countUse('export')
      return true
    } catch (err) {
      await writable.abort().catch(() => {})
      const cancelled = err instanceof DOMException && err.name === 'AbortError'
      setMessage(cancelled ? 'Export cancelled.' : `Export failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  // Browsers without the save box: the video is built in memory and handed over as a normal download.
  async function runAsDownload(s: ExportSettings) {
    const c = CONTAINERS.find((x) => x.id === s.container)!
    const firstClip = project.video[0].clips[0]
    const name = `${(sources.find((x) => x.id === firstClip?.sourceId)?.name ?? 'video').replace(/\.[^.]+$/, '')} edit${c.ext}`
    let buf = new Uint8Array(1 << 22)
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
    abort.current = new AbortController()
    setMessage(null)
    setProgress(0)
    const started = performance.now()
    try {
      await exportProject(sources, project, s, writable as never, setProgress, abort.current.signal)
      countUse('export')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf.subarray(0, size)], { type: c.mime }))
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60000)
      setMessage(`${name} is downloading (made in ${((performance.now() - started) / 1000).toFixed(1)} s).`)
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError'
      setMessage(cancelled ? 'Export cancelled.' : `Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  // Saves a picture of the frame at the playhead: the save box where there is one, otherwise a download.
  async function runStill(type: StillType) {
    const kind = STILLS.find((x) => x.id === type)!
    const firstClip = project.video[0].clips[0]
    const name = `${(sources.find((x) => x.id === firstClip?.sourceId)?.name ?? 'picture').replace(/\.[^.]+$/, '')} at ${fmt(at).replace(':', '.')}${kind.ext}`
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    let handle: SaveHandle | null = null
    if (picker) {
      try {
        handle = await picker({ suggestedName: name, types: [{ description: kind.label, accept: { [kind.mime]: [kind.ext] } }] })
      } catch {
        return // closed the save box
      }
    }
    setMessage(null)
    setProgress(0)
    try {
      const blob = await exportStill(sources, project, at, settings.resolution, type, clear)
      if (handle) {
        const wr = await handle.createWritable()
        await (wr as unknown as { write: (b: Blob) => Promise<void> }).write(blob)
        await wr.close()
        setMessage(`Saved ${handle.name}.`)
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 60000)
        setMessage(`${name} is downloading.`)
      }
    } catch (err) {
      setMessage(`Could not make the picture: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
    }
  }

  async function run() {
    if (still) {
      await runStill(still)
      return
    }
    const s = current()
    if (!(window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker) {
      await runAsDownload(s)
      return
    }
    const handle = await pickSave(s)
    if (!handle) return
    setMessage(null)
    const started = performance.now()
    if (await runOne(handle, s)) setMessage(`Saved ${handle.name} in ${((performance.now() - started) / 1000).toFixed(1)} s.`)
  }

  async function addToList() {
    const s = current()
    const handle = await pickSave(s)
    if (!handle) return
    setJobs((j) => [...j, { handle, settings: s, label: `${handle.name}, ${CONTAINERS.find((c) => c.id === s.container)!.label.split(' (')[0]}${s.container === 'gif' ? '' : `, ${s.resolution}p`}` }])
  }

  async function runAll() {
    setMessage(null)
    const started = performance.now()
    let done = 0
    for (const job of jobs) {
      setMessage(`Exporting ${done + 1} of ${jobs.length}: ${job.handle.name}`)
      if (!(await runOne(job.handle, job.settings))) return
      done++
    }
    setJobs([])
    setMessage(`Saved all ${done} in ${((performance.now() - started) / 1000).toFixed(1)} s.`)
  }

  const busy = progress !== null
  const sizeHint = squeeze ? `about ${targetMB} MB` : null

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal export-modal">
        <h2>Export</h2>
        {!pictureOnly && (
        <div className="chips presets">
          {PRESETS.map((p) => (
            <button key={p.id} disabled={busy} onClick={() => setSettings((s) => ({ ...s, ...p.settings, codec: 'auto' }))}
              className={settings.container === p.settings.container && settings.resolution === p.settings.resolution && settings.fps === p.settings.fps && settings.quality === p.settings.quality ? 'on' : ''}
              title={p.shape && p.shape !== shapeName ? `Looks best in a ${p.shape} frame. This project is ${shapeName}` : undefined}>
              {p.label}{p.shape && p.shape !== shapeName ? ' *' : ''}
            </button>
          ))}
        </div>
        )}
        <label>
          Format
          <select value={still ? `still:${still}` : settings.container} disabled={busy} onChange={(e) => {
            const v = e.target.value
            if (v.startsWith('still:')) setStill(v.slice(6) as StillType)
            else { setStill(null); set({ container: v as ExportSettings['container'], codec: 'auto' }) }
          }}>
            {!pictureOnly && (
              <optgroup label="Video">
                {CONTAINERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </optgroup>
            )}
            <optgroup label="A picture of the frame at the playhead">
              {STILLS.map((p) => <option key={p.id} value={`still:${p.id}`}>{p.label}</option>)}
            </optgroup>
          </select>
        </label>
        {still && (
          <>
            <label>
              Size
              <select value={String(settings.resolution)} disabled={busy} onChange={(e) => set({ resolution: Number(e.target.value) })}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r === 2160 ? '2160p (4K)' : r === 1440 ? '1440p (2K)' : `${r}p`}</option>)}
              </select>
            </label>
            {still !== 'jpg' && (
              <label className="check">
                <input type="checkbox" checked={clear} disabled={busy} onChange={(e) => setClear(e.target.checked)} />
                See-through background (for titles and stickers)
              </label>
            )}
            <p className="note">{pictureOnly ? `The picture, ${w} × ${h}.` : `The frame at the playhead (${fmt(at)}), ${w} × ${h}. Move the playhead to choose another moment.`}</p>
          </>
        )}
        {!still && !container.audioOnly && (
          <>
            <label>
              Size
              <select value={String(settings.resolution)} disabled={busy} onChange={(e) => set({ resolution: Number(e.target.value) })}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r === 2160 ? '2160p (4K)' : r === 1440 ? '1440p (2K)' : `${r}p`}</option>)}
              </select>
            </label>
            <label>
              Frame rate
              <select value={String(settings.fps)} disabled={busy} onChange={(e) => set({ fps: e.target.value === 'original' ? 'original' : Number(e.target.value) })}>
                <option value="original">Same as the video</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <p className="note">
              {w} × {h}, the project's frame shape ({shapeName}). Change the shape with Frame above the preview.
              {settings.container === 'gif' && ' A GIF has no sound, runs at up to 15 frames a second and 540 pixels, and gets big fast: keep it short.'}
            </p>
          </>
        )}

        {!still && <details className="more-options">
          <summary>More options</summary>
          {!container.audioOnly && settings.container !== 'gif' && (
            <>
              <label>
                Quality
                <select value={settings.quality ?? 'high'} disabled={busy || squeeze} onChange={(e) => set({ quality: e.target.value as ExportSettings['quality'] })}>
                  <option value="low">Low (smallest file)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="best">Best (biggest file)</option>
                </select>
              </label>
              {IS_WEB && <AppMore what="HEVC and AV1, GIF, see-through video, squeeze to a size, 2K and 4K, part of the edit, export several at once" />}
              {!IS_WEB && <>
              <label>
                Video codec
                <select value={settings.codec ?? 'auto'} disabled={busy} onChange={(e) => set({ codec: e.target.value as ExportSettings['codec'] })}>
                  <option value="auto">Automatic (plays everywhere)</option>
                  {CODECS_FOR[settings.container].map((c) => (
                    <option key={c} value={c} disabled={canMake ? !canMake.has(c) : false}>
                      {{ avc: 'H.264', hevc: 'HEVC (H.265), smaller files', av1: 'AV1, smallest files', vp9: 'VP9' }[c as 'avc' | 'hevc' | 'av1' | 'vp9']}
                      {canMake && !canMake.has(c) ? ' (this PC cannot make it)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check" title="Where nothing is drawn stays see-through, so titles and overlays can go over other video in another editor">
                <input type="checkbox" checked={clear} disabled={busy} onChange={(e) => { setClear(e.target.checked); if (e.target.checked && settings.container !== 'webm' && settings.container !== 'mkv') set({ container: 'webm' }) }} />
                See-through background (WebM, for titles and overlays)
              </label>
              <label className="check">
                <input type="checkbox" checked={squeeze} disabled={busy} onChange={(e) => setSqueeze(e.target.checked)} />
                Squeeze it to about
                <input type="number" className="mb" min={1} max={4000} value={targetMB} disabled={busy || !squeeze} onChange={(e) => setTargetMB(Math.max(1, Number(e.target.value) || 1))} />
                MB
              </label>
              </>}
            </>
          )}
          {!IS_WEB && <>
          <label>
            Which part
            <select value={part} disabled={busy} onChange={(e) => setPart(e.target.value as Part)}>
              <option value="all">All of it ({fmt(total)})</option>
              <option value="clip" disabled={!selectedRange}>The selected clip{selectedRange ? ` (${fmt(selectedRange[0])} to ${fmt(selectedRange[1])})` : ': select one first'}</option>
              <option value="markers" disabled={markers.length < 2}>Between the first two markers{markers.length >= 2 ? ` (${fmt(markers[0].t)} to ${fmt(markers[1].t)})` : ': add two with M'}</option>
            </select>
          </label>
          <p className="note">{fmt(length)} long{sizeHint ? `, ${sizeHint}` : ''}.</p>
          <div className="light-buttons">
            <button disabled={busy || duration(project) === 0} onClick={addToList} title="Choose where it goes now, export later with the rest">Add to the list</button>
          </div>
          {jobs.length > 0 && (
            <div className="jobs">
              {jobs.map((j, i) => (
                <div key={i} className="job">
                  <span>{j.label}</span>
                  <button disabled={busy} onClick={() => setJobs((x) => x.filter((_, k) => k !== i))} title="Take it off the list">×</button>
                </div>
              ))}
            </div>
          )}
          </>}
        </details>}

        {busy && (
          <div className="progress">
            <div className="bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)}%</span>
          </div>
        )}
        {message && <p className={message.startsWith('Saved') || message.startsWith('Exporting') ? 'ok' : 'error'}>{message}</p>}

        <div className="modal-buttons">
          {busy ? (
            <button onClick={() => abort.current?.abort()}>Cancel</button>
          ) : (
            <>
              <button onClick={onClose}>Close</button>
              {jobs.length > 0 && <button onClick={runAll}>Export all {jobs.length}</button>}
              <button className="primary" onClick={run} disabled={duration(project) === 0}>Export…</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
