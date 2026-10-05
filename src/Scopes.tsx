import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

// Scopes, read from the preview four times a second: a waveform (brightness across the picture),
// a histogram (how much of each level there is, per colour) and a vectorscope (which colours, how strong).
type Kind = 'wave' | 'hist' | 'vector'

export function Scopes({ source, onClose }: { source: React.RefObject<HTMLCanvasElement | null>; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('wave')
  const out = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const W = 256
    const H = 140
    const small = new OffscreenCanvas(160, 90)
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    const id = setInterval(() => {
      const src = source.current
      const c = out.current
      if (!src || !c || !src.width) return
      small.width = 160
      small.height = Math.max(1, Math.round((160 * src.height) / src.width))
      sctx.drawImage(src, 0, 0, small.width, small.height)
      const { data, width, height } = sctx.getImageData(0, 0, small.width, small.height)
      const x = c.getContext('2d')!
      c.width = W
      c.height = H
      x.fillStyle = '#0b0b0d'
      x.fillRect(0, 0, W, H)
      x.globalCompositeOperation = 'lighter'
      if (kind === 'wave') {
        x.fillStyle = 'rgba(120, 230, 140, 0.18)'
        for (let py = 0; py < height; py++)
          for (let px = 0; px < width; px++) {
            const i = (py * width + px) * 4
            const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
            x.fillRect((px / width) * W, H - 4 - (l / 255) * (H - 8), 1.6, 1.6)
          }
      } else if (kind === 'hist') {
        const bins = [new Array(128).fill(0), new Array(128).fill(0), new Array(128).fill(0)]
        for (let i = 0; i < data.length; i += 4) for (let ch = 0; ch < 3; ch++) bins[ch][data[i + ch] >> 1]++
        const peak = Math.max(1, ...bins.flat().slice(1, -1))
        ;['rgba(239,68,68,0.6)', 'rgba(34,197,94,0.6)', 'rgba(59,130,246,0.6)'].forEach((col, ch) => {
          x.fillStyle = col
          bins[ch].forEach((v, k) => {
            const hgt = Math.min(H, (v / peak) * (H - 6))
            x.fillRect((k / 128) * W, H - hgt, W / 128 + 0.5, hgt)
          })
        })
      } else {
        const cx = W / 2
        const cy = H / 2
        const r = H / 2 - 6
        x.globalCompositeOperation = 'source-over'
        x.strokeStyle = '#333'
        x.beginPath()
        x.arc(cx, cy, r, 0, Math.PI * 2)
        x.stroke()
        // The skin tone line: where faces should sit.
        x.strokeStyle = '#7a5a3a'
        x.beginPath()
        x.moveTo(cx, cy)
        x.lineTo(cx + Math.cos((-123 * Math.PI) / 180) * r, cy + Math.sin((-123 * Math.PI) / 180) * r)
        x.stroke()
        x.globalCompositeOperation = 'lighter'
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i] / 255
          const G = data[i + 1] / 255
          const B = data[i + 2] / 255
          const u = -0.169 * R - 0.331 * G + 0.5 * B
          const v = 0.5 * R - 0.419 * G - 0.081 * B
          x.fillStyle = `rgba(${data[i]},${data[i + 1]},${data[i + 2]},0.35)`
          x.fillRect(cx + u * 2 * r, cy - v * 2 * r, 1.5, 1.5)
        }
      }
      x.globalCompositeOperation = 'source-over'
    }, 250)
    return () => clearInterval(id)
  }, [kind, source])

  return (
    <div className="scopes">
      <div className="scopes-head">
        {(['wave', 'hist', 'vector'] as Kind[]).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{{ wave: 'Waveform', hist: 'Histogram', vector: 'Vectorscope' }[k]}</button>
        ))}
        <button className="scopes-x" onClick={onClose} title="Hide the scopes"><X size={13} /></button>
      </div>
      <canvas ref={out} className="scopes-canvas" />
    </div>
  )
}
