// Where preview copies are kept: files in this browser's private storage (the origin private file system), written
// as they are made, so a long video never has to fit in memory. The store is kept under a size limit: the copies
// used least recently go first. A copy is only ever a stand-in for playing; export always reads the original.

const LIMIT = 4 * 1024 ** 3 // 4 GB of preview copies at most

type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

async function folder(): Promise<Dir> {
  const root = await navigator.storage.getDirectory()
  return (await root.getDirectoryHandle('preview-copies', { create: true })) as Dir
}

// A file name from the source's name, size and date, so the same file finds its copy again.
async function nameFor(key: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('') + '.mp4'
}

// The saved copy for this source, if there is one.
export async function findCopy(key: string): Promise<File | null> {
  try {
    const dir = await folder()
    const handle = await dir.getFileHandle(await nameFor(key))
    return await handle.getFile()
  } catch {
    return null
  }
}

// A writable file for a new copy. Call done() when the copy is complete, or drop() if making it failed.
export async function newCopy(key: string) {
  const dir = await folder()
  const name = await nameFor(key)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  return {
    writable,
    async done(): Promise<File> {
      if (!writable.locked) await writable.close()
      await trim(dir, name)
      return handle.getFile()
    },
    async drop() {
      await writable.abort().catch(() => {})
      await dir.removeEntry(name).catch(() => {})
    },
  }
}

// Removes the oldest copies until the store is under the limit (never the one just made).
async function trim(dir: Dir, keep: string) {
  const files: { name: string; size: number; at: number }[] = []
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file') continue
    const f = await (h as FileSystemFileHandle).getFile()
    files.push({ name, size: f.size, at: f.lastModified })
  }
  let total = files.reduce((n, f) => n + f.size, 0)
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= LIMIT) break
    if (f.name === keep) continue
    await dir.removeEntry(f.name).catch(() => {})
    total -= f.size
  }
}
