// The single keys the person can change (Help, Keyboard shortcuts). Ctrl combinations stay as they are.

export type KeyAction = 'play' | 'split' | 'marker' | 'back' | 'stop' | 'forward' | 'remove' | 'zoomIn' | 'zoomOut'

export const KEY_ACTIONS: { id: KeyAction; label: string; code: string }[] = [
  { id: 'play', label: 'Play or pause', code: 'Space' },
  { id: 'split', label: 'Split at the playhead', code: 'KeyS' },
  { id: 'marker', label: 'Add a marker', code: 'KeyM' },
  { id: 'back', label: 'Back (J)', code: 'KeyJ' },
  { id: 'stop', label: 'Stop (K)', code: 'KeyK' },
  { id: 'forward', label: 'Play (L)', code: 'KeyL' },
  { id: 'remove', label: 'Delete the selected clip', code: 'Delete' },
  { id: 'zoomIn', label: 'Zoom the timeline in', code: 'Equal' },
  { id: 'zoomOut', label: 'Zoom the timeline out', code: 'Minus' },
]

const STORE = 'editor.keys'

export function loadKeys(): Record<KeyAction, string> {
  const out = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.code])) as Record<KeyAction, string>
  try {
    const own = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    for (const a of KEY_ACTIONS) if (typeof own[a.id] === 'string') out[a.id] = own[a.id]
  } catch { /* defaults */ }
  return out
}

export function saveKeys(keys: Record<KeyAction, string>) {
  try { localStorage.setItem(STORE, JSON.stringify(keys)) } catch { /* private window: this session only */ }
}

// A key's name as printed on the keyboard.
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return ({ Space: 'Space', Equal: '+', Minus: '−', Delete: 'Delete', Backspace: 'Backspace', Comma: ',', Period: '.', Slash: '/' } as Record<string, string>)[code] ?? code
}
