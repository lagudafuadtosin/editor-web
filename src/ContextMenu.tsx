import { useEffect, useRef } from 'react'

// A right-click menu. Nothing of it is on screen until it is asked for, and any press elsewhere,
// Escape, or choosing an item closes it.

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; checked?: boolean; hint?: string; danger?: boolean; app?: boolean }
  | 'line'

// The web version's one line per menu for everything that is in the free app: it opens the download page.
export const moreInApp = (what: string, onClick: () => void): MenuItem => ({ label: `More in the free app: ${what}`, onClick, app: true })

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function down(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Kept inside the window: opened near the right or bottom edge it flips back.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 4) el.style.left = `${Math.max(4, x - r.width)}px`
    if (r.bottom > window.innerHeight - 4) el.style.top = `${Math.max(4, y - r.height)}px`
  }, [x, y])

  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === 'line' ? (
          <div key={i} className="ctx-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            className={it.danger ? 'danger' : it.app ? 'app-more' : undefined}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            <span className="ctx-check">{it.checked ? '✓' : ''}</span>
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
            {it.app && <span className="app-tag">Free app</span>}
          </button>
        ),
      )}
    </div>
  )
}
