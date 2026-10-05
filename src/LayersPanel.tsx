import { ChevronDown, ChevronUp, Download, Eye, EyeOff, ImagePlus, Trash2 } from 'lucide-react'
import { SHAPES } from './shape'
import type { Clip, Project } from './model'

// The Picture tab's layers, in place of the timeline: the top layer first, the background last.
export function LayersPanel({ project, selectedId, onSelect, onMove, onHide, onDelete, onExport, onUseInEdit, busy }: {
  project: Project
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (trackIndex: number, dir: 1 | -1) => void
  onHide: (trackIndex: number) => void
  onDelete: (id: string) => void
  onExport: () => void
  onUseInEdit: () => void
  busy: boolean
}) {
  const rows = project.video.flatMap((t, i) => t.clips.map((c) => ({ c, i, hidden: !!t.hidden }))).reverse()
  const name = (c: Clip) =>
    c.kind === 'text' ? `Text: ${c.text?.text.split('\n')[0] ?? ''}`
      : c.kind === 'shape' ? (c.shape?.kind === 'draw' ? 'Drawing' : SHAPES.find((s) => s.id === c.shape?.kind)?.label ?? 'Shape')
        : c.kind === 'color' ? 'Colour block'
          : c.kind === 'image' ? c.label ?? 'Picture'
            : c.kind === 'adjust' ? 'Adjustment layer' : 'Video frame'
  return (
    <div className="layers-panel">
      <div className="toolbar">
        <b className="layers-title">Layers</b>
        <span className="note">The top of the list is in front.</span>
        <div className="layers-actions">
          <button onClick={onUseInEdit} disabled={busy || !rows.length} title="Puts this picture into the video edit at the playhead"><ImagePlus size={15} /> Use in edit</button>
          <button className="primary" onClick={onExport} disabled={busy || !rows.length}><Download size={15} /> Export picture…</button>
        </div>
      </div>
      <div className="layers-list">
        {!rows.length && <p className="note">Add a photo with Media, then text, shapes or stickers on top.</p>}
        {rows.map(({ c, i, hidden }) => (
          <div key={c.id} className={`layer-row${c.id === selectedId ? ' on' : ''}${hidden ? ' hidden' : ''}`} onClick={() => onSelect(c.id)}>
            <span className="layer-name">{name(c)}{i === 0 ? ' (background)' : ''}</span>
            <button className="icon-btn" title={hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); onHide(i) }}>{hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            <button className="icon-btn" title="Bring forward" disabled={i === 0 || i === project.video.length - 1} onClick={(e) => { e.stopPropagation(); onMove(i, 1) }}><ChevronUp size={15} /></button>
            <button className="icon-btn" title="Send back" disabled={i <= 1} onClick={(e) => { e.stopPropagation(); onMove(i, -1) }}><ChevronDown size={15} /></button>
            <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
