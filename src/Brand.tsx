import { useState } from 'react'
import { X } from 'lucide-react'
import { FONTS } from './text'

// The brand kit: a font, three colours and a logo, kept on this PC so every project can use them.
export type Brand = { font: string; colors: string[]; logo?: { name: string; data: string } }
const KEY = 'editor.brand'
export const DEFAULT_BRAND: Brand = { font: 'Arial', colors: ['#ffffff', '#f5e642', '#111111'] }

export function loadBrand(): Brand {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_BRAND
    const b = JSON.parse(raw)
    return { font: typeof b.font === 'string' ? b.font : 'Arial', colors: Array.isArray(b.colors) ? b.colors.slice(0, 3) : DEFAULT_BRAND.colors, logo: b.logo }
  } catch {
    return DEFAULT_BRAND
  }
}

export function BrandDialog({ onClose }: { onClose: () => void }) {
  const [brand, setBrand] = useState<Brand>(loadBrand)
  const [err, setErr] = useState<string | null>(null)
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(brand))
      onClose()
    } catch {
      setErr('It could not be kept on this PC (the logo may be too big). Try a smaller logo.')
    }
  }
  async function pickLogo(f: File | undefined) {
    if (!f) return
    if (f.size > 2_000_000) {
      setErr('Keep the logo under 2 MB.')
      return
    }
    const data = await new Promise<string>((ok) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.readAsDataURL(f)
    })
    setErr(null)
    setBrand({ ...brand, logo: { name: f.name, data } })
  }
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="info-head">
          <h2>Brand kit</h2>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <p className="note">Kept on this PC for every project. Text menu: "Text in my brand" and "Add my logo".</p>
        <label className="select-row">
          <span>Font</span>
          <select value={brand.font} onChange={(e) => setBrand({ ...brand, font: e.target.value })}>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
        </label>
        <div className="colour-line">
          <span>Colours</span>
          {brand.colors.map((c, i) => (
            <input key={i} type="color" value={c} onChange={(e) => setBrand({ ...brand, colors: brand.colors.map((x, k) => (k === i ? e.target.value : x)) })} />
          ))}
        </div>
        <div className="colour-line">
          <span>Logo</span>
          {brand.logo && <img src={brand.logo.data} alt="" className="brand-logo" />}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickLogo(e.target.files?.[0])} />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
