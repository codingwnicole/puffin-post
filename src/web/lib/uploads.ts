// Shared rules for character / planner images. The server enforces the same types and size
// (src/storage/icons.ts); these are for the file picker and the hints people see.
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
export const IMAGE_HINT = 'JPG, PNG, WebP, or GIF up to 4 MB. Square works best: 600 × 600 px or larger. GIFs stay animated; keep them around 400 × 400 so they stay small.'
export const PORTRAIT_HINT = IMAGE_HINT + ' Cards show the middle band of the image, so keep faces centered.'

/** Center-crops to a 600 px square WebP. GIFs are sent untouched so their animation survives
 * (the browser crops them on display with object-fit / preserveAspectRatio). */
export async function squareIcon(file: File) {
  if (file.type === 'image/gif') return file
  const image = await createImageBitmap(file)
  const size = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  canvas.width = 600; canvas.height = 600
  if (!context) throw new Error('Could not prepare image')
  context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 600, 600)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .9))
  if (!blob) throw new Error('Could not prepare image')
  return new File([blob], 'character-icon.webp', { type: 'image/webp' })
}

/** Fits any non-GIF image so its long edge is at most `max` px, re-encoded as WebP q.88.
 * GIFs are returned untouched so their animation survives the upload. */
export async function fitImage(file: File, max: number) {
  if (file.type === 'image/gif') return file
  const image = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  canvas.width = width; canvas.height = height
  if (!context) throw new Error('Could not prepare image')
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .88))
  if (!blob) throw new Error('Could not prepare image')
  return new File([blob], 'moodboard.webp', { type: 'image/webp' })
}
