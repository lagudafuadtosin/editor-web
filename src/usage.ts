// Web version only: an anonymous count of how much the editor is used. Use only, never visits.
// Each event adds one to that day's tally on editor.postbarrel.com and nothing else: no cookie,
// no id, nothing about the person or their files. The Windows app never sends anything.
// The privacy page says so (InfoMenus.tsx in editor-web).
import { IS_WEB } from './edition'

// edit: a file added to a video edit. picture: a photo added in the Picture tab. export: a video export
// finished. take: a teleprompter take recorded. still: a picture saved. script: a script written.
export type UsageEvent = 'edit' | 'picture' | 'export' | 'take' | 'still' | 'script'

const once = new Set<UsageEvent>()

// edit and picture are counted once per page load, the others every time they happen.
export function countUse(event: UsageEvent) {
  if (!IS_WEB || import.meta.env.DEV) return
  if (event === 'edit' || event === 'picture') {
    if (once.has(event)) return
    once.add(event)
  }
  try {
    void fetch('/count', { method: 'POST', body: event, keepalive: true }).catch(() => {})
  } catch {
    // Counting never gets in the way of editing
  }
}
