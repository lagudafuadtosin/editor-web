import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { Player } from './player'
import type { Project, Source } from './model'

// The source viewer: one file on its own, to watch and pick the part you want (I for in, O for out),
// then put that part on the timeline: at the end, inserted or written over at the playhead, or on a layer.
export type Place = 'end' | 'insert' | 'overwrite' | 'layer'

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`
}

// at: open at this moment (found by search), with a few seconds around it picked.
export function Viewer({ source, onPlace, onClose, at }: { source: Source; onPlace: (from: number, to: number, how: Place) => void; onClose: () => void; at?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const dur = source.media.info.duration
  const [inP, setIn] = useState(0)
  const [outP, setOut] = useState(dur)

  useEffect(() => {
    const v = source.media.info.video
    const frame = v ? { w: v.width, h: v.height } : { w: 1280, h: 720 }
    const p = new Player(canvas.current!, (t, pl) => { setTime(t); setPlaying(pl) })
    const proj: Project = {
      frame,
      video: [{ id: 'vv', kind: 'video', clips: v ? [{ id: 'vc', kind: 'media', sourceId: source.id, start: 0, in: 0, out: dur }] : [] }],
      audio: [{ id: 'va', kind: 'audio', clips: v ? [] : [{ id: 'vc', kind: 'media', sourceId: source.id, start: 0, in: 0, out: dur }] }],
    }
    p.setProject([source], proj, true)
    player.current = p
    if (at !== undefined) {
      p.seek(at)
      setIn(Math.max(0, at - 1))
      setOut(Math.min(dur, at + 5))
    }
    return () => p.dispose()
  }, [source, dur, at])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const p = player.current
      if (!p) return
      if (e.code === 'Escape') onClose()
      else if (e.code === 'KeyI') setIn(Math.min(p.now(), outP - 0.1))
      else if (e.code === 'KeyO') setOut(Math.max(p.now(), inP + 0.1))
      else if (e.code === 'Space') { e.preventDefault(); if (p.playing) p.pause(); else p.play() }
      else return
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [inP, outP, onClose])

  const pct = (t: number) => `${(t / Math.max(0.01, dur)) * 100}%`
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal viewer">
        <div className="info-head">
          <h2>{source.name}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={18} /></button>
        </div>
        <div className="viewer-stage"><canvas ref={canvas} /></div>
        <div className="viewer-bar"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const seek = (x: number) => player.current?.seek(Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur)))
            seek(e.clientX)
            e.currentTarget.setPointerCapture(e.pointerId)
            e.currentTarget.onpointermove = (ev) => { if (ev.buttons) seek(ev.clientX) }
          }}>
          <div className="viewer-range" style={{ left: pct(inP), width: pct(outP - inP) }} />
          <div className="viewer-head" style={{ left: pct(time) }} />
        </div>
        <div className="viewer-controls">
          <button className="icon-btn" onClick={() => (playing ? player.current?.pause() : player.current?.play())} title="Play or pause (Space)">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="note">{fmt(time)}</span>
          <button onClick={() => setIn(Math.min(time, outP - 0.1))} title="Start of the part you want (I)">Mark in (I)</button>
          <button onClick={() => setOut(Math.max(time, inP + 0.1))} title="End of the part you want (O)">Mark out (O)</button>
          <span className="note">{fmt(inP)} to {fmt(outP)} ({fmt(outP - inP)})</span>
        </div>
        <div className="modal-buttons">
          <button onClick={() => onPlace(inP, outP, 'layer')} title="On a layer above, starting at the playhead">On a layer</button>
          <button onClick={() => onPlace(inP, outP, 'overwrite')} title="Writes over what is on the main track from the playhead">Overwrite at playhead</button>
          <button onClick={() => onPlace(inP, outP, 'insert')} title="Pushes the main track along to make room at the playhead">Insert at playhead</button>
          <button className="primary" onClick={() => onPlace(inP, outP, 'end')}>Add to the end</button>
        </div>
      </div>
    </div>
  )
}
