import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import licences from './licences.json'

// The Help and About menus in the top bar, and the pages they open.

export const VERSION = '1.0.1'

type Page = 'shortcuts' | 'guide' | 'about' | 'licences' | 'privacy' | 'terms'

type Item = { text: string; page?: Page; action?: () => void }

function Menu({ label, items, onPick }: { label: string; items: Item[]; onPick: (p: Page) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className={`menu-btn${open ? ' on' : ''}`} onClick={(e) => { e.currentTarget.blur(); setOpen(!open) }}>
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu-list">
          {items.map((it) => (
            <button key={it.text} onClick={() => { setOpen(false); if (it.action) it.action(); else if (it.page) onPick(it.page) }}>{it.text}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function InfoMenus() {
  const [page, setPage] = useState<Page | null>(null)
  return (
    <>
      <Menu label="Help" onPick={setPage} items={[
        { page: 'guide', text: 'How to use it' },
        { page: 'shortcuts', text: 'Keyboard shortcuts' },
        { text: 'Report a problem on GitHub', action: reportOnGitHub },
        { text: 'Email support', action: emailSupport },
      ]} />
      <Menu label="About" onPick={setPage} items={[
        { page: 'about', text: 'About Postbarrel Vid Editor' },
        { page: 'privacy', text: 'Privacy' },
        { page: 'terms', text: 'Terms of use' },
        { page: 'licences', text: 'Licences' },
        { text: 'Get the free app', action: () => window.open(DOWNLOAD, '_blank', 'noopener') },
      ]} />
      {page && <InfoPage page={page} onClose={() => setPage(null)} />}
    </>
  )
}

// Reporting a problem: a new issue on the public GitHub page, or an email to support, with the version and the
// person's browser filled in. Both open outside the editor (their browser, their email app); the page sends nothing.
export const SUPPORT = 'support@postbarrel.com'
export const ISSUES = 'https://github.com/lagudafuadtosin/editor-web/issues/new'
export const EDITION = 'web'
export const DOWNLOAD = 'https://github.com/lagudafuadtosin/editor-web/releases/latest'

function whereFrom(): string {
  const ua = navigator.userAgent
  const browser = /Edg\/([\d.]+)/.exec(ua)?.[0].replace('/', ' ') ?? /Chrome\/([\d.]+)/.exec(ua)?.[0].replace('/', ' ') ?? ua
  const windows = /Windows NT [\d.]+/.exec(ua)?.[0] ?? navigator.platform
  return `Postbarrel Vid Editor ${EDITION} ${VERSION}, ${browser}, ${windows}`
}

function reportOnGitHub() {
  const body = [
    `**Version, browser and Windows:** ${whereFrom()}`,
    '',
    '**What happened, and what were you doing?**',
    '',
    '',
    '**What did you expect?**',
    '',
  ].join('\n')
  window.open(`${ISSUES}?labels=problem&body=${encodeURIComponent(body)}`, '_blank', 'noopener')
}

function emailSupport() {
  const body = [whereFrom(), '', 'What happened, and what were you doing?', '', ''].join('\n')
  window.location.href = `mailto:${SUPPORT}?subject=${encodeURIComponent('Vid Editor problem')}&body=${encodeURIComponent(body)}`
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['Left / Right', 'One frame back or forward'],
  ['Shift + Left / Right', 'One second back or forward'],
  ['S', 'Split the selected clip at the playhead'],
  ['Delete', 'Remove the selected clip'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Y  or  Ctrl + Shift + Z', 'Redo'],
  ['+ / −', 'Zoom the timeline in or out'],
  ['Arrows (after clicking the picture)', 'Nudge the selected picture 1 pixel (Shift: 10)'],
  ['Teleprompter: Space', 'Pause or carry on scrolling'],
  ['Teleprompter: Up / Down', 'Faster or slower'],
  ['Teleprompter: Esc', 'Stop recording'],
]

function InfoPage({ page, onClose }: { page: Page; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const title = {
    shortcuts: 'Keyboard shortcuts', guide: 'How to use it', about: 'About', licences: 'Licences', privacy: 'Privacy', terms: 'Terms of use',
  }[page]
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal info-page">
        <div className="info-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={18} /></button>
        </div>
        <div className="info-body">
          {page === 'shortcuts' && (
            <table className="keys">
              <tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><th><kbd>{k}</kbd></th><td>{v}</td></tr>)}</tbody>
            </table>
          )}

          {page === 'guide' && (
            <ol className="guide-steps">
              <li><b>Your edit saves itself</b> in this browser as you work. Next time you open the editor, press Carry on to pick up where you left off. The web version keeps one edit at a time.</li>
              <li><b>Add your files.</b> Press Media and pick MP4 or MOV videos, pictures or sound, up to 1 GB each. Videos go on the Main track one after another; sound goes on a sound track; pictures go on a layer at the playhead.</li>
              <li><b>Cut.</b> Move the playhead and press S to split. Drag a clip's edges to trim it, drag the clip to move it, Delete to remove it.</li>
              <li><b>Layers.</b> Drag a clip up onto a layer to put it over the Main track, then drag it or its corners in the picture to place and size it.</li>
              <li><b>Text.</b> Text adds words on a layer. (Captions written from your voice are in the free app.)</li>
              <li><b>Fix the picture and sound.</b> Click a clip and open the panels on the right: Fix light and colour, Speed, Sound (volume, fades, going quieter under your voice).</li>
              <li><b>Teleprompter.</b> Paste your script, press Record, read. Each take lands on the end of the Main track.</li>
              <li><b>Export.</b> Press Export, choose the format and size, and choose where to save it.</li>
              <li><b>Want more?</b> The free app for Windows adds a project list, captions from your voice, MKV, AVI and TS video, and no size limit.</li>
            </ol>
          )}

          {page === 'about' && (
            <div className="about">
              <div className="about-brand">
                <img src="/favicon.svg" alt="" />
                <div>
                  <h3>Postbarrel <b>Vid Editor</b></h3>
                  <span>Version {VERSION}</span>
                </div>
              </div>
              <p>A video editor and teleprompter that runs in your browser. Free. No account, no uploads: your videos, pictures and sound never leave your computer.</p>
              <p>This is the free web version. The free app for Windows adds a project list, captions from your voice, more video formats and no size limit. <a href={DOWNLOAD} target="_blank" rel="noreferrer">Get the free app</a>.</p>
              <p>Made by Fuad Laguda, part of <a href="https://postbarrel.com" target="_blank" rel="noreferrer">Postbarrel</a>.</p>
              <p className="note">Built on open-source software. See About › Licences.</p>
            </div>
          )}

          {page === 'privacy' && (
            <div className="prose">
              <p><b>Who is responsible.</b> Postbarrel Vid Editor is made by Fuad Laguda, trading as Postbarrel, First Floor Right, 35A Cowane Street, Stirling, Scotland, United Kingdom. Contact: support@postbarrel.com. If you are unhappy with how your data is handled, tell us first and we will acknowledge it within 30 days. You can also complain to the Information Commissioner's Office (ico.org.uk).</p>
              <p><b>Your files stay on your PC.</b> Videos, pictures, sound and teleprompter takes are opened and edited inside your browser on your computer. They are never uploaded, and nothing about them is sent to Postbarrel or anyone else. After it has loaded, the only things this page sends are the count below and, if you use the Script tab, your notes to the free script writer.</p>
              <p><b>What is kept, and where.</b> Your edit, its autosave and your teleprompter takes are kept in this browser's own storage on your PC. Your videos are not copied: the browser remembers where they are on your disk and opens them from there. A few settings (the look, the timeline height, teleprompter speed) are kept the same way.</p>
              <p><b>What we count.</b> To know whether people use the editor, this page adds one to a daily tally on editor.postbarrel.com when a file is first added to an edit or a picture, when an export finishes, when a picture is saved, when a teleprompter take is recorded and when the free writer writes a script. Visits are not counted. The tally is the date, which of those it was, and a number. Nothing else is sent or kept: no IP address, no cookie, no ID, and nothing about you or your files.</p>
              <p><b>The free script writer.</b> When you press Write my script, the notes you typed are sent to editor.postbarrel.com and on to an open AI model (Qwen) run by Nebius in the European Union, which writes the script and sends it back. Neither we nor Nebius keep your notes or the script: Nebius is told not to store them, and we never save them. To keep the writer free for everyone, each internet address gets 5 scripts a day. For that we keep a scrambled form of your IP address, which cannot be turned back into it, with a count, for that day only. It is deleted the next day. Do not put anything private about other people in your notes.</p>
              <p><b>No account, no tracking.</b> There is no sign-in, no tracking of you, no advertising and no cookies.</p>
              <p><b>Removing everything.</b> Start a new edit to clear the saved one, or clear this site's data in your browser's settings to remove all of it.</p>
            </div>
          )}

          {page === 'terms' && (
            <div className="prose">
              <p>Postbarrel Vid Editor is free to use for personal and commercial videos. What you make with it is yours.</p>
              <p>Only use footage, music, pictures and words you have the right to use.</p>
              <p>The editor is provided as it is, without warranty of any kind. Keep copies of anything important: the maker is not liable for lost work, lost files or any other loss from using it, as far as the law allows.</p>
            </div>
          )}

          {page === 'licences' && (
            <div className="prose">
              <p>Postbarrel Vid Editor is built with these open-source parts. Thank you to everyone who made them.</p>
              <p className="note">Mediabunny is used unchanged, under the Mozilla Public License 2.0. Its source code is at <a href="https://github.com/Vanilagy/mediabunny" target="_blank" rel="noreferrer">github.com/Vanilagy/mediabunny</a>.</p>
              {licences.map((l) => (
                <details key={l.name} className="licence">
                  <summary>
                    <b>{l.name}</b> {l.version && <span>{l.version}</span>} <em>{l.licence}</em>
                  </summary>
                  <p><a href={l.url} target="_blank" rel="noreferrer">{l.url}</a></p>
                  {l.text && <pre>{l.text}</pre>}
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
