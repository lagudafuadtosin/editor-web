import { useRef, useState } from 'react'
import { CONTAINERS, exportProject, outputSize, RESOLUTIONS, type ExportSettings } from './export'
import { duration, type Project, type Source } from './model'

type Props = { sources: Source[]; project: Project; onClose: () => void }

type SaveHandle = { name: string; createWritable: () => Promise<WritableStream & { close: () => Promise<void> }> }
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>

export function ExportDialog({ sources, project, onClose }: Props) {
  const [settings, setSettings] = useState<ExportSettings>({ container: 'mp4', fps: 'original', resolution: 1080 })
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const container = CONTAINERS.find((c) => c.id === settings.container)!
  const [w, h] = outputSize(project.frame, settings.resolution)
  const set = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }))

  async function run() {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (!picker) {
      setMessage('Saving needs Chrome or Edge.')
      return
    }
    const firstClip = project.video[0].clips[0]
    const base = (sources.find((s) => s.id === firstClip?.sourceId)?.name ?? 'video').replace(/\.[^.]+$/, '')
    let handle: SaveHandle
    try {
      handle = await picker({
        suggestedName: `${base} edit${container.ext}`,
        types: [{ description: container.label, accept: { [container.mime]: [container.ext] } }],
      })
    } catch {
      return // closed the save box
    }
    const writable = await handle.createWritable()
    abort.current = new AbortController()
    setMessage(null)
    setProgress(0)
    const started = performance.now()
    try {
      await exportProject(sources, project, settings, writable as never, setProgress, abort.current.signal)
      await writable.close()
      setMessage(`Saved ${handle.name} in ${((performance.now() - started) / 1000).toFixed(1)} s.`)
    } catch (err) {
      await writable.abort().catch(() => {})
      const cancelled = err instanceof DOMException && err.name === 'AbortError'
      setMessage(cancelled ? 'Export cancelled.' : `Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  const busy = progress !== null

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <h2>Export</h2>
        <label>
          Format
          <select value={settings.container} disabled={busy} onChange={(e) => set({ container: e.target.value as ExportSettings['container'] })}>
            {CONTAINERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {!container.audioOnly && (
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
            <p className="note">{w} × {h}, the project's frame shape. Change the shape with Frame above the preview.</p>
          </>
        )}

        {busy && (
          <div className="progress">
            <div className="bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)}%</span>
          </div>
        )}
        {message && <p className={message.startsWith('Saved') ? 'ok' : 'error'}>{message}</p>}

        <div className="modal-buttons">
          {busy ? (
            <button onClick={() => abort.current?.abort()}>Cancel</button>
          ) : (
            <>
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={run} disabled={duration(project) === 0}>Export…</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
