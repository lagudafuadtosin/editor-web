// Keeping your work: the autosave lives in this browser's own database on your PC (IndexedDB), never online.
// Videos and sound are not copied: we keep a "handle" (Chrome's pointer to the file on disk) and open the file
// again from there. Pictures are small, so their bytes are kept in the save.
import type { Project } from './model'
import { IS_WEB } from './edition'
import { checkLut } from './look'

// The web version keeps its own store (one edit at a time, no project list), as it always has.
const DB = IS_WEB ? 'postbarrel-vid-editor-web' : 'postbarrel-editor'
const VERSION = IS_WEB ? 1 : 3

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave')
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles')
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes')
      if (!IS_WEB && !db.objectStoreNames.contains('projects')) db.createObjectStore('projects')
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

async function all<T>(store: string): Promise<T[]> {
  const db = await open()
  const value = await new Promise<T[]>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
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

// ---- The project list (the home screen). Every project is kept in this browser's database on the PC. ----
export type ProjectRecord = {
  id: string
  name: string
  createdAt: number
  savedAt: number
  thumb?: string // a small picture of the edit for its card
  saved: Saved
  file?: ProjectHandle // a .edit file it also saves into, once Save has been used
  // Earlier versions of the edit, newest first: one kept every ten minutes of work, up to twenty. Only the edit
  // itself is kept (and which files it used), not copies of the pictures.
  versions?: { at: number; project: Project; sources: Saved['sources'] }[]
}
export const listProjects = async () => (await all<ProjectRecord>('projects')).sort((a, b) => b.savedAt - a.savedAt)
export const getProject = (id: string) => get<ProjectRecord>('projects', id)
export const putProject = (r: ProjectRecord) => put('projects', r.id, r)
export const deleteProject = (id: string) => del('projects', id)
export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// The single autosave from before the project list becomes the first project, once.
// Runs once per page, even when the start-up code runs twice.
let moving: Promise<void> | null = null
export function moveOldAutosave(): Promise<void> {
  moving ??= (async () => {
    const old = await get<Saved>('autosave', 'current')
    if (!old) return
    await putProject({ id: newProjectId(), name: old.name || 'Untitled', createdAt: old.savedAt, savedAt: old.savedAt, saved: old })
    await del('autosave', 'current')
  })()
  return moving
}

// The project file on the PC that the current edit also saves into.
export type ProjectHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>
}
export const rememberProjectFile = (h: ProjectHandle | null) => (h ? put('autosave', 'project-file', h) : del('autosave', 'project-file'))
export const projectFileHandle = () => get<ProjectHandle>('autosave', 'project-file')

// Writing to the project file needs the person's yes once per visit; asking needs a click, so call this from one.
export async function canWrite(h: ProjectHandle): Promise<boolean> {
  try {
    let state = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted'
    if (state !== 'granted' && h.requestPermission) state = await h.requestPermission({ mode: 'readwrite' })
    return state === 'granted'
  } catch {
    return false
  }
}

export async function writeProjectFile(h: ProjectHandle, s: Saved) {
  const w = await h.createWritable()
  await w.write(await toProjectFile(s))
  await w.close()
}
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

// A project file: the same as the autosave, written as text, with pictures turned into text too.
export async function toProjectFile(s: Saved): Promise<string> {
  const images = await Promise.all(
    s.images.map(async (im) => ({ id: im.id, name: im.name, type: im.type, data: await blobToDataUrl(im.data) })),
  )
  return JSON.stringify({ ...s, images, kind: 'postbarrel-editor-project' })
}

export async function fromProjectFile(text: string): Promise<Saved> {
  const raw = JSON.parse(text)
  if (raw.kind !== 'postbarrel-editor-project') throw new Error('this is not an editor project file')
  // Pictures travel inside the file as data: text. Anything else (a web address) is never fetched.
  const images = await Promise.all(
    (raw.images as { id: string; name: string; type: string; data: string }[]).map(async (im) => {
      if (typeof im.data !== 'string' || !im.data.startsWith('data:')) throw new Error('a picture in the file is not stored inside it')
      return { ...im, data: await (await fetch(im.data)).blob() }
    }),
  )
  // Colour looks are checked the same way as a .cube file; one that fails is left out, and its clips show no look.
  const project = raw.project as Project
  if (project?.luts) {
    const luts: NonNullable<Project['luts']> = {}
    for (const [id, l] of Object.entries(project.luts)) {
      try {
        luts[id] = checkLut(l)
      } catch {
        // left out
      }
    }
    project.luts = luts
  }
  return { version: 1, savedAt: raw.savedAt, name: raw.name, project, sources: raw.sources, images }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}
