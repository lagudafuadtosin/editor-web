// Every file is checked before the editor opens it. Its first bytes say what it really is; the name is ignored,
// so a renamed file cannot get through. The web version takes MP4 or MOV video, sound files and pictures,
// up to 1 GB each. Anything else is refused before any of it is read further.

export const MAX_BYTES = 1_000_000_000
export const MAX_PICTURE_BYTES = 50_000_000
export { DOWNLOAD_URL } from './edition'

export type Verdict = { ok: true; kind: 'video' | 'sound' | 'picture' } | { ok: false; reason: string }

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
const NOT_SUPPORTED = 'not supported. The web version opens MP4 or MOV video, sound files (MP3, WAV, M4A, AAC, FLAC, OGG) and pictures (PNG, JPG, WebP, GIF, BMP).'
const IN_THE_APP = (what: string) => `${what} opens in the free app, not in the web version.`

export async function checkFile(file: File): Promise<Verdict> {
  if (file.size === 0) return { ok: false, reason: 'the file is empty.' }
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  if (b.length < 12) return { ok: false, reason: NOT_SUPPORTED }

  // Pictures
  const picture =
    (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') ||
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' ||
    (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') ||
    ascii(b, 0, 2) === 'BM'
  if (picture) {
    if (file.size > MAX_PICTURE_BYTES) return { ok: false, reason: 'pictures can be up to 50 MB in the web version.' }
    return { ok: true, kind: 'picture' }
  }

  if (file.size > MAX_BYTES) return { ok: false, reason: IN_THE_APP('A file over 1 GB') }

  // MP4, MOV and M4A share one layout: boxes, each with its size and a four-letter type.
  const box = ascii(b, 4, 4)
  if (box === 'ftyp' || ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return { ok: true, kind: 'video' } // sound-only M4A is sorted out once opened

  // Sound
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { ok: true, kind: 'sound' }
  if (ascii(b, 0, 3) === 'ID3') return { ok: true, kind: 'sound' } // MP3 with tags
  if (ascii(b, 0, 4) === 'fLaC') return { ok: true, kind: 'sound' }
  if (ascii(b, 0, 4) === 'OggS') return { ok: true, kind: 'sound' } // Ogg video is turned away once opened
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { ok: true, kind: 'sound' } // MP3 or AAC frames

  // Video the free app opens
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ok: false, reason: IN_THE_APP('MKV and WebM video') }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ') return { ok: false, reason: IN_THE_APP('AVI video') }
  if (b[0] === 0x47 && file.size > 188) {
    const next = new Uint8Array(await file.slice(188, 189).arrayBuffer())
    if (next[0] === 0x47) return { ok: false, reason: IN_THE_APP('TS video') }
  }

  return { ok: false, reason: NOT_SUPPORTED }
}
