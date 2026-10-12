import { useEffect, useRef, useState } from 'react'

// Web version: the free script writer. The person pastes everything they want to say, picks the
// kind of video and the length, and gets a script to read in the teleprompter. The notes go to
// editor.postbarrel.com/write, which asks an open model hosted in the EU and keeps nothing.
// Five scripts a day for each person. No research: the script is built only from their notes.
// Cloudflare's Turnstile check runs in the tab: every request carries a fresh token, which the
// server checks before anything else (worker/write.js in editor-web).

const KINDS: [string, string][] = [
  ['review', 'Review: film, series, anime, book or game'],
  ['food', 'Food review'],
  ['storytime', 'Storytime'],
  ['scary', 'True crime or scary story'],
  ['travel', 'Travel, an event or sport'],
  ['everyday', 'Outfit, get ready, fitness or pets'],
  ['explainer', 'Explainer: science, money, the planet'],
  ['business', 'Small business'],
  ['other', 'Something else'],
]

const LENGTHS: [string, string][] = [
  ['micro', 'Under 30 seconds'],
  ['short', 'About 1 minute'],
  ['medium', 'About 2 minutes'],
  ['long', '2 to 5 minutes'],
]

const MAX = 4000
const SITEKEY = '0x4AAAAAAFOUMfvDIY_tOjR4' // public site key of the "Vid Editor script writer" widget

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window { turnstile?: Turnstile }
}

// Cloudflare's script, added once, the first time the Script tab opens
let loading: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => { loading = null; reject(new Error('turnstile')) }
    document.head.appendChild(el)
  })
  return loading
}

export function ScriptWriter({ active, onUse }: { active: boolean; onUse: (script: string) => void }) {
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState('storytime')
  const [length, setLength] = useState('short')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [script, setScript] = useState('')
  const [copied, setCopied] = useState(false)
  // The one question the writer may ask when the notes are missing something, and the answer to it.
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  // The bot check: its box, its id, and the token it gives once it has passed
  const boxRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [token, setToken] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)

  useEffect(() => {
    if (!active || widgetId.current) return
    let gone = false
    loadTurnstile()
      .then(() => {
        if (gone || !boxRef.current || !window.turnstile || widgetId.current) return
        widgetId.current = window.turnstile.render(boxRef.current, {
          sitekey: SITEKEY,
          action: 'script',
          size: 'flexible',
          callback: (t: string) => { setToken(t); setCheckFailed(false) },
          'expired-callback': () => setToken(''),
          'error-callback': () => { setToken(''); setCheckFailed(true) },
        })
      })
      .catch(() => setCheckFailed(true))
    return () => { gone = true }
  }, [active])

  // A token works once, so after every request the check runs again for the next one
  function freshCheck() {
    setToken('')
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
  }

  async function write(how: 'ask' | 'answer' | 'anyway' = 'ask') {
    if (busy || notes.trim().length < 20 || !token) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const r = await fetch('/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes.slice(0, MAX),
          kind,
          length,
          turnstile: token,
          ...(how === 'answer' && question ? { question, answer } : {}),
          ...(how === 'anyway' ? { skipProbe: true } : {}),
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { script?: string; question?: string; message?: string }
      if (r.ok && j.question) {
        setQuestion(j.question)
        setAnswer('')
        return
      }
      if (!r.ok || !j.script) {
        setError(j.message ?? 'The writer is not answering just now. Try again in a minute.')
        return
      }
      setQuestion(null)
      setScript(j.script)
    } catch {
      setError('That did not reach the writer. Check your connection and try again.')
    } finally {
      setBusy(false)
      freshCheck()
    }
  }

  const short = notes.trim().length < 20

  return (
    <div className="prompter" hidden={!active}>
      <div className="prompter-side">
        <label className="prompter-label">
          Your notes
          <textarea value={notes} maxLength={MAX} onChange={(e) => setNotes(e.target.value)}
            placeholder="Dump everything you want to say: what happened, what you thought, the bits you want in. Messy is fine." />
        </label>
        <p className="note">{notes.length} / {MAX} characters</p>
        <label className="prompter-label">
          Kind of video
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="prompter-label">
          Length
          <select value={length} onChange={(e) => setLength(e.target.value)}>
            {LENGTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div ref={boxRef} className="writer-check" />
        {checkFailed && <p className="note warn-text">The check that you are a person could not load. Reload the page and try again.</p>}
        <button className="primary" disabled={busy || short || !token} onClick={() => void write()}>
          {busy ? 'Writing, about 20 seconds' : 'Write my script'}
        </button>
        <p className="note">Free: 5 scripts a day. Written only from your notes, nothing is looked up. Your notes are not kept.</p>
        <p className="note">
          Want it researched, with a fuller interview? <a href="https://postbarrel.com/?utm_source=editor-script" target="_blank" rel="noreferrer">Postbarrel</a> does that.
        </p>
      </div>
      <div className="prompter-main">
        {error && <p className="note warn-text">{error}</p>}
        {question ? (
          <div className="writer-question">
            <p className="writer-ask">{question}</p>
            <textarea value={answer} maxLength={1500} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
            <div className="writer-actions">
              <button className="primary" disabled={busy || !answer.trim() || !token} onClick={() => void write('answer')}>
                {busy ? 'Writing, about 20 seconds' : 'Write my script'}
              </button>
              <button disabled={busy || !token} onClick={() => void write('anyway')}>Write it anyway</button>
            </div>
          </div>
        ) : script ? (
          <>
            <textarea className="writer-result" value={script} onChange={(e) => setScript(e.target.value)} />
            <div className="writer-actions">
              <button className="primary" onClick={() => onUse(script)}>Read it in the teleprompter</button>
              <button onClick={() => void navigator.clipboard.writeText(script).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          </>
        ) : (
          <p className="note writer-empty">Your script shows here. Change anything you like before you read it.</p>
        )}
      </div>
    </div>
  )
}
