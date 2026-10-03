// Reads a picture's width and height from its header, before anything is decoded, so a small file that claims
// an enormous picture (a "decompression bomb") is refused instead of filling the memory.

export const MAX_PICTURE_SIDE = 8192

export async function pictureSize(file: Blob): Promise<{ w: number; h: number } | null> {
  const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
  if (b.length < 30) return null
  // PNG: the IHDR chunk comes first.
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { w: dv.getUint32(16), h: dv.getUint32(20) }
  // GIF: the screen size.
  if (ascii(0, 3) === 'GIF') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
  // BMP: the info header.
  if (ascii(0, 2) === 'BM') return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) }
  // WebP: lossy, lossless or extended.
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4)
    if (kind === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L') {
      const v = dv.getUint32(21, true)
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X') return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 }
    return null
  }
  // JPEG: walk the markers to the frame header.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return null
      const m = b[p + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(p + 7), h: dv.getUint16(p + 5) }
      p += 2 + dv.getUint16(p + 2)
    }
    return null
  }
  return null
}

// Throws a plain message if the picture is too big (or its size cannot be read).
export async function checkPictureSize(file: Blob) {
  const size = await pictureSize(file)
  if (!size) throw new Error('this picture could not be read')
  if (size.w > MAX_PICTURE_SIDE || size.h > MAX_PICTURE_SIDE) {
    throw new Error(`the picture is ${size.w} × ${size.h}, and pictures can be up to ${MAX_PICTURE_SIDE} pixels a side`)
  }
}
