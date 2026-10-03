import { newId } from './model'
import { checkPictureSize } from './pictureSize'

// Pictures (PNG, JPG, WebP, GIF first frame, BMP) decoded once and kept for the session.
// Clips point at them by id, like video clips point at their file. The original bytes are kept too, for saving.
export const imageStore = new Map<string, ImageBitmap>()
export const imageFiles = new Map<string, { name: string; type: string; data: Blob }>()

export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)

export async function loadImage(file: File, id = newId('img')): Promise<{ id: string; bitmap: ImageBitmap }> {
  await checkPictureSize(file)
  const bitmap = await createImageBitmap(file)
  imageStore.set(id, bitmap)
  imageFiles.set(id, { name: file.name, type: file.type, data: file })
  return { id, bitmap }
}

// Brings a saved picture back under its old id.
export async function restoreImage(id: string, name: string, type: string, data: Blob) {
  await checkPictureSize(data)
  imageStore.set(id, await createImageBitmap(data))
  imageFiles.set(id, { name, type, data })
}
