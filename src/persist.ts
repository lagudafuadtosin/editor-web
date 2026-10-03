// Keeping your work: the autosave lives in this browser's own database on your PC (IndexedDB), never online.
// Videos and sound are not copied: we keep a "handle" (Chrome's pointer to the file on disk) and open the file
// again from there. Pictures are small, so their bytes are kept in the save.
import type { Project } from './model'

const DB = 'postbarrel-vid-editor-web'
const VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave')
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles')
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    // Another tab still has the old version open: say so rather than wait for ever.
    req.onblocked = () => reject(new Error('the editor is open in another tab; close it and reload'))
  })
}

async function put(store: string, key: string, value: unknown) {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open()
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
}

async function del(store: string, key: string) {
  const db = await open()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

// How a video or sound file is recognised again: its name, size and last change.
export type FileKey = { name: string; size: number; lastModified: number }
export const keyOf = (f: FileKey) => `${f.name}|${f.size}|${f.lastModified}`

// One saved edit. sources are the files the clips point at; images carry their own bytes.
export type Saved = {
  version: 1
  savedAt: number
  name?: string // the project's name, 'Untitled' when none was given
  project: Project
  sources: ({ id: string } & FileKey)[]
  images: { id: string; name: string; type: string; data: Blob }[]
}

export type Handle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>
}

export const saveAutosave = (s: Saved) => put('autosave', 'current', s)

export const loadAutosave = () => get<Saved>('autosave', 'current')
export const clearAutosave = () => del('autosave', 'current')

// Every file ever added is remembered by its key, so a reopened edit (or project file) can find it again.
export const rememberHandle = (key: string, h: Handle) => put('handles', key, h)
export const handleFor = (key: string) => get<Handle>('handles', key)

// Teleprompter takes have no file on the PC until saved as one, so their bytes are kept here.
export const saveTake = (key: string, data: Blob) => put('takes', key, data)
export const takeFor = (key: string) => get<Blob>('takes', key)

// Opens a remembered file. Chrome asks the person once ("Let the editor open these files?"), which needs a click,
// so this is called from a button.
export async function fileFromHandle(h: Handle): Promise<File | null> {
  try {
    let state = h.queryPermission ? await h.queryPermission({ mode: 'read' }) : 'granted'
    if (state !== 'granted' && h.requestPermission) state = await h.requestPermission({ mode: 'read' })
    return state === 'granted' ? await h.getFile() : null
  } catch {
    return null
  }
}
