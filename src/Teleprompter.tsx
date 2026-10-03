import { useEffect, useRef, useState } from 'react'

// The teleprompter: the script scrolls at reading speed, the camera and microphone record,
// and each take goes straight onto the end of the main track. Nothing is uploaded.

type Take = { name: string; seconds: number; file: File }

const READ_LINE = 0.25 // the line being read sits a quarter of the way down

// The shape of the recording. A webcam films landscape, so other shapes are cut from the middle of its picture.
const SHAPES = [
  { id: '9:16', label: 'Portrait 9:16', aspect: 9 / 16 },
  { id: '4:5', label: 'Portrait 4:5', aspect: 4 / 5 },
  { id: '1:1', label: 'Square 1:1', aspect: 1 },
  { id: '16:9', label: 'Landscape 16:9', aspect: 16 / 9 },
]

// MP4 first (opens everywhere), WebM if this Chrome cannot record MP4.
function recorderType(): string {
  for (const t of ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}
function saveNumber(key: string, v: number) {
  try { localStorage.setItem(key, String(v)) } catch { /* private window */ }
}

export function Teleprompter({ active, frameAspect, script, onScript, onTake }: {
  active: boolean // the tab is showing: camera on
  frameAspect: number // the edit's frame, width over height: the shape a take starts in
  script: string
  onScript: (text: string) => void
  onTake: (file: File) => Promise<void>
}) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [wpm, setWpm] = useState(() => loadNumber('editor.prompterWpm', 140))
  const [size, setSize] = useState(() => loadNumber('editor.prompterSize', 44))
  const [mirror, setMirror] = useState(false)
  const [count, setCount] = useState(0) // 3, 2, 1 before recording
  const [recording, setRecording] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [takes, setTakes] = useState<Take[]>([])
  const [note, setNote] = useState<string | null>(null)

  const camRef = useRef<HTMLVideoElement>(null)
  const shotRef = useRef<HTMLCanvasElement>(null) // what is recorded: the camera cut to the chosen shape
  const [shapeId, setShapeId] = useState<string | null>(null) // null: follow the edit's frame
  const shape = SHAPES.find((s) => s.id === shapeId) ?? SHAPES.reduce((a, b) => (Math.abs(b.aspect - frameAspect) < Math.abs(a.aspect - frameAspect) ? b : a))
  const aspectRef = useRef(shape.aspect)
  aspectRef.current = shape.aspect
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const scrollY = useRef(0)
  const startedAt = useRef(0)
  const live = useRef({ wpm, scrolling, recording })
  live.current = { wpm, scrolling, recording }

  useEffect(() => saveNumber('editor.prompterWpm', wpm), [wpm])
  useEffect(() => saveNumber('editor.prompterSize', size), [size])

  // Camera and microphone: on while this tab is open, off when it closes.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let mine: MediaStream | null = null
    const fake = (window as unknown as { __fakeStream?: () => MediaStream }).__fakeStream
    const get = fake
      ? Promise.resolve(fake())
      : navigator.mediaDevices.getUserMedia({
          video: { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
    get
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        mine = s
        setStream(s)
        setCamError(null)
        // Names of cameras and microphones are only given once the person has allowed them.
        const all = await navigator.mediaDevices.enumerateDevices()
        setCameras(all.filter((d) => d.kind === 'videoinput'))
        setMics(all.filter((d) => d.kind === 'audioinput'))
      })
      .catch((err) => setCamError(err instanceof Error && err.name === 'NotAllowedError'
        ? 'The camera or microphone was not allowed. Click the camera icon in the address bar to allow them, then come back to this tab.'
        : `The camera could not start: ${err instanceof Error ? err.message : String(err)}`))
    return () => {
      cancelled = true
      // Leaving the tab mid-take ends the take, so it is still kept.
      if (recRef.current?.state === 'recording') stop()
      mine?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [cameraId, micId, active])

  useEffect(() => {
    if (camRef.current) camRef.current.srcObject = stream
  }, [stream])

  // Scrolls the script: words per minute turned into pixels per second from the script's own height.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const { wpm, scrolling, recording } = live.current
      const text = textRef.current
      if (text && scrolling) {
        const words = Math.max(1, (text.innerText.match(/\S+/g) ?? []).length)
        const pxPerSec = (text.scrollHeight / words) * (wpm / 60)
        scrollY.current = Math.min(text.scrollHeight, scrollY.current + pxPerSec * dt)
      }
      if (text) text.style.transform = `translateY(${-scrollY.current}px)`
      // Cut the camera's picture to the shape, from the middle, at the camera's own detail (no enlarging).
      const cam = camRef.current
      const shot = shotRef.current
      if (cam && shot && cam.videoWidth) {
        const W = cam.videoWidth
        const H = cam.videoHeight
        const a = aspectRef.current
        const cw = W / H > a ? Math.round((H * a) / 2) * 2 : W
        const ch = W / H > a ? H : Math.round(W / a / 2) * 2
        if (!live.current.recording && (shot.width !== cw || shot.height !== ch)) {
          shot.width = cw
          shot.height = ch
        }
        shot.getContext('2d')!.drawImage(cam, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, shot.width, shot.height)
      }
      if (recording) setElapsed(Math.floor((performance.now() - startedAt.current) / 1000))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  function toTop() {
    scrollY.current = 0
  }

  async function record() {
    if (!stream || recording || count) return
    toTop()
    for (const n of [3, 2, 1]) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 1000))
    }
    setCount(0)
    const type = recorderType()
    // Picture from the cut-to-shape canvas, sound straight from the microphone.
    const picture = shotRef.current!.captureStream(30).getVideoTracks()
    const recorded = new MediaStream([...picture, ...stream.getAudioTracks()])
    const rec = new MediaRecorder(recorded, { mimeType: type || undefined, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 })
    const parts: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    rec.onstop = async () => {
      const seconds = (performance.now() - startedAt.current) / 1000
      picture.forEach((t) => t.stop())
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm'
      const name = `Take ${takes.length + 1}.${ext}`
      const file = new File(parts, name, { type: rec.mimeType.split(';')[0], lastModified: Date.now() })
      setTakes((t) => [...t, { name, seconds, file }])
      setNote(`${name} (${fmt(seconds)}) is on the end of the main track.`)
      await onTake(file)
    }
    rec.start(1000)
    recRef.current = rec
    startedAt.current = performance.now()
    setElapsed(0)
    setRecording(true)
    setScrolling(true)
  }

  function stop() {
    recRef.current?.stop()
    recRef.current = null
    setRecording(false)
    setScrolling(false)
  }

  // Space pauses or carries on the scrolling, Up and Down change the speed, Esc stops recording.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!active) return
      if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        setScrolling((s) => !s)
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setWpm((w) => Math.min(300, w + 10))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setWpm((w) => Math.max(60, w - 10))
      } else if (e.code === 'Escape' && live.current.recording) stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function saveTake(t: Take) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(t.file)
    a.download = t.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  }

  return (
    <div className="prompter" hidden={!active}>
      <aside className="prompter-side">
        <label className="prompter-label">
          Script
          <textarea value={script} onChange={(e) => onScript(e.target.value)} disabled={recording}
            placeholder="Paste or type what you will say. It is kept with this edit." />
        </label>
        <label className="slider-row">
          <span>Speed</span>
          <input type="range" min={60} max={300} step={5} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} />
          <span className="value">{wpm} words a minute</span>
        </label>
        <label className="slider-row">
          <span>Text size</span>
          <input type="range" min={24} max={96} step={2} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          <span className="value">{size}</span>
        </label>
        <label className="slider-row">
          <span>Shape</span>
          <select value={shape.id} onChange={(e) => setShapeId(e.target.value)} disabled={recording}>
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          Mirror the text (for a teleprompter glass)
        </label>
        <label className="slider-row">
          <span>Camera</span>
          <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={recording}>
            <option value="">Default</option>
            {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>)}
          </select>
        </label>
        <label className="slider-row">
          <span>Microphone</span>
          <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={recording}>
            <option value="">Default</option>
            {mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </label>
        {takes.length > 0 && (
          <div className="takes">
            <h3>Takes</h3>
            {takes.map((t) => (
              <div key={t.name} className="take">
                <span>{t.name} · {fmt(t.seconds)}</span>
                <button onClick={() => saveTake(t)} title="Save this take as a file on your PC">Save as file</button>
              </div>
            ))}
            <p className="note">Takes are kept with the edit in this browser. Save one as a file to keep it on its own.</p>
          </div>
        )}
      </aside>

      <section className="prompter-main">
        <div className="prompter-box" ref={boxRef} style={{ fontSize: size }}
          onWheel={(e) => { scrollY.current = Math.max(0, scrollY.current + e.deltaY) }}>
          <div className="read-line" style={{ top: `${READ_LINE * 100}%` }} />
          <div className="prompter-text" style={{ paddingTop: `calc(${READ_LINE * 100}% - 0.6em)`, transformOrigin: 'center', scale: mirror ? '-1 1' : undefined }}>
            <div ref={textRef}>{script.trim() ? script : 'Your script shows here. Paste it in the box on the left.'}</div>
          </div>
          {count > 0 && <div className="countdown">{count}</div>}
          <video ref={camRef} className="cam-source" autoPlay muted playsInline />
          <canvas ref={shotRef} className={`cam${shape.aspect < 1 ? ' tall' : ''}`} style={{ transform: 'scaleX(-1)' }} title="What is being recorded (shown like a mirror)" />
          {recording && <div className="rec-dot">● REC {fmt(elapsed)}</div>}
          {!scrolling && recording && <div className="paused-note">Paused: Space carries on</div>}
        </div>
        {camError && <p className="error">{camError}</p>}
        <div className="prompter-bar">
          {!recording ? (
            <button className="record" onClick={record} disabled={!stream || count > 0}>● Record</button>
          ) : (
            <button className="record stop" onClick={stop}>■ Stop</button>
          )}
          <button onClick={(e) => { e.currentTarget.blur(); setScrolling((s) => !s) }}>{scrolling ? 'Pause scroll' : 'Scroll'}</button>
          <button onClick={(e) => { e.currentTarget.blur(); toTop() }}>Back to the top</button>
          <span className="note">Space pause or carry on · Up and Down faster or slower · Esc stop · mouse wheel moves the script</span>
        </div>
        {note && <p className="note">{note}</p>}
      </section>
    </div>
  )
}
