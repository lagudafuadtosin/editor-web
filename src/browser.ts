// Chrome and Edge on a computer have everything the editor uses (saving straight to a folder, remembering files
// on the disk, the browser's own video encoding). Elsewhere it still opens, with a one-time note.
export function browserOk(): boolean {
  const w = window as unknown as Record<string, unknown>
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  return !phone && 'showOpenFilePicker' in w && 'showSaveFilePicker' in w && 'VideoEncoder' in w && 'AudioEncoder' in w && 'VideoDecoder' in w
}

const KEY = 'editor.browserNoteClosed'
export function browserNoteSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function closeBrowserNote() {
  try { localStorage.setItem(KEY, '1') } catch { /* private window: it shows again next time */ }
}
