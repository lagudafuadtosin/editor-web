// Web version only: an anonymous count of how much the editor is used, so we know whether people
// edit here or only look. Each event adds one to that day's tally on editor.postbarrel.com and
// nothing else: no cookie, no id, nothing about the person or their files. The Windows app never
// sends anything. The privacy page says so (InfoMenus.tsx in editor-web).
import { IS_WEB } from './edition'

export type UsageEvent = 'visit' | 'open' | 'export' | 'take'

const once = new Set<UsageEvent>()

// visit and open are counted once per page load, export and take every time they happen.
export function countUse(event: UsageEvent) {
  if (!IS_WEB || import.meta.env.DEV) return
  if (event === 'visit' || event === 'open') {
    if (once.has(event)) return
    once.add(event)
  }
  try {
    void fetch('/count', { method: 'POST', body: event, keepalive: true }).catch(() => {})
  } catch {
    // Counting never gets in the way of editing
  }
}
