import { useEffect, useState } from 'react'
import { Copy, FolderOpen, Moon, Pencil, Plus, Sun, Trash2, Film, MoreHorizontal, X } from 'lucide-react'
import type { ProjectRecord } from './persist'
import { InfoMenus } from './InfoMenus'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { BUILT_IN, deleteTemplate, loadTemplates, saveTemplate } from './templates'

// The home screen: every project on this PC, newest first, like Rush's project list.
export function Home({ projects, theme, onTheme, asksName, onAskedName, onNew, onOpen, onOpenFile, onRename, onDuplicate, onDelete, onRestoreVersion }: {
  projects: ProjectRecord[]
  theme: 'dark' | 'grey'
  onTheme: () => void
  asksName: boolean // opened from New in the editor: go straight to naming
  onAskedName: () => void
  onNew: (name: string, template: string) => void
  onOpen: (id: string) => void
  onOpenFile: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onRestoreVersion: (id: string, index: number) => void
}) {
  const [template, setTemplate] = useState('blank')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [history, setHistory] = useState<ProjectRecord | null>(null)
  const [savingAs, setSavingAs] = useState<ProjectRecord | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [, refresh] = useState(0)
  const own = loadTemplates()
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null)
  useEffect(() => {
    if (!asksName) return
    setDraft('')
    setNaming(true)
    onAskedName()
  }, [asksName, onAskedName])

  const when = (t: number) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const finishRename = (id: string) => {
    const name = renameDraft.trim()
    if (name) onRename(id, name)
    setRenaming(null)
  }

  return (
    <div className="home">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>Postbarrel <b>Vid Editor</b></span>
        </div>
        <div className="title" />
        <div className="top-actions">
          <InfoMenus />
          <button className="icon-btn" onClick={onTheme} title={theme === 'dark' ? 'Grey look' : 'Dark look'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <div className="home-body">
        <div className="home-actions">
          <button className="home-new" onClick={() => { setDraft(''); setNaming(true) }}><Plus size={18} /> New project</button>
          <button className="home-open" onClick={onOpenFile}><FolderOpen size={16} /> Open a .edit file</button>
        </div>

        <h2 className="home-title">Projects</h2>
        {projects.length === 0 ? (
          <p className="note">No projects yet. Press New project to start one.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card">
                <button className="project-thumb" onClick={() => onOpen(p.id)} title={`Open ${p.name}`}>
                  {p.thumb ? <img src={p.thumb} alt="" /> : <Film size={28} />}
                </button>
                <div className="project-info">
                  {renaming === p.id ? (
                    <input className="rename" autoFocus value={renameDraft} maxLength={120}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => finishRename(p.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') finishRename(p.id); if (e.key === 'Escape') setRenaming(null) }} />
                  ) : (
                    <b title={p.name} onDoubleClick={() => { setRenaming(p.id); setRenameDraft(p.name) }}>{p.name}</b>
                  )}
                  <span>Edited {when(p.savedAt)}</span>
                </div>
                <div className="project-tools">
                  <button className="icon-btn" title="Rename" onClick={() => { setRenaming(p.id); setRenameDraft(p.name) }}><Pencil size={16} /></button>
                  <button className="icon-btn" title="Duplicate" onClick={() => onDuplicate(p.id)}><Copy size={16} /></button>
                  <button className="icon-btn danger" title="Delete" onClick={() => setDeleting(p)}><Trash2 size={16} /></button>
                  <button className="icon-btn" title="More: version history, save as a template" onClick={(e) => {
                    const b = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: b.left, y: b.bottom + 4, items: [
                      { label: 'Version history…', hint: p.versions?.length ? `${p.versions.length} kept` : 'none yet', disabled: !p.versions?.length, onClick: () => setHistory(p) },
                      { label: 'Save as a template…', hint: 'its text, blocks and layers', onClick: () => { setTemplateName(p.name); setSavingAs(p) } },
                    ] })
                  }}><MoreHorizontal size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {naming && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setNaming(false)}>
          <form className="modal" onSubmit={(e) => { e.preventDefault(); setNaming(false); onNew(draft.trim() || 'Untitled', template) }}>
            <h2>New project</h2>
            <label>
              Name
              <input className="name-input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Untitled" maxLength={120} />
            </label>
            <p className="note">Left empty, it is called Untitled. You can rename it any time.</p>
            <label>
              Start from
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {BUILT_IN.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {own.length > 0 && <optgroup label="Your templates">{own.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
            </label>
            {own.some((t) => t.id === template) && (
              <button type="button" className="link" onClick={() => { deleteTemplate(template); setTemplate('blank'); refresh((n) => n + 1) }}>Delete this template</button>
            )}
            <div className="modal-buttons">
              <button type="button" onClick={() => setNaming(false)}>Cancel</button>
              <button type="submit" className="primary">Create</button>
            </div>
          </form>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {history && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setHistory(null)}>
          <div className="modal">
            <div className="info-head">
              <h2>Versions of {history.name}</h2>
              <button className="icon-btn" onClick={() => setHistory(null)} title="Close"><X size={18} /></button>
            </div>
            <p className="note">One is kept every ten minutes of work. Going back keeps the one you have now as a version too, so nothing is lost.</p>
            <div className="jobs">
              {(history.versions ?? []).map((v, i) => (
                <div key={v.at} className="job">
                  <span>{when(v.at)}</span>
                  <button className="link" onClick={() => { onRestoreVersion(history.id, i); setHistory(null) }}>Go back to this</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {savingAs && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setSavingAs(null)}>
          <form className="modal" onSubmit={(e) => {
            e.preventDefault()
            try { saveTemplate(templateName.trim() || savingAs.name, savingAs.saved.project) } catch { /* storage full: nothing saved */ }
            setSavingAs(null)
            refresh((n) => n + 1)
          }}>
            <h2>Save as a template</h2>
            <p className="note">New projects can start from it: its frame shape, text, blocks, adjustment layers and layers. Not its videos, pictures or sound.</p>
            <label>
              Template name
              <input autoFocus value={templateName} maxLength={60} onChange={(e) => setTemplateName(e.target.value)} />
            </label>
            <div className="modal-buttons">
              <button type="button" onClick={() => setSavingAs(null)}>Cancel</button>
              <button type="submit" className="primary">Save</button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setDeleting(null)}>
          <div className="modal">
            <h2>Delete {deleting.name}?</h2>
            <p className="note">The project goes from this list for good. Your video, picture and sound files on the PC are not touched{deleting.file ? `, and nor is ${deleting.file.name}` : ''}.</p>
            <div className="modal-buttons">
              <button onClick={() => setDeleting(null)}>Keep it</button>
              <button className="danger" onClick={() => { onDelete(deleting.id); setDeleting(null) }}>Delete project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
