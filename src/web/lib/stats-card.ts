// Canvas-drawn "writing stats" images: downloaded from Characters and used as the share preview
// for simple (non-trading-card) shares. Colors are baked into the PNG, so they are literal here.
export type Counts = { total: number; mine: number; theirs: number }

export async function statsCardBlob(character: { id: string; name: string; state: string; iconObjectKey: string | null }, counts: Counts): Promise<Blob> {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not make a stats card')
  canvas.width = 1200; canvas.height = 630
  context.fillStyle = '#182126'; context.fillRect(0, 0, 1200, 630); context.fillStyle = '#234e61'; context.fillRect(0, 0, 1200, 170)
  context.fillStyle = '#f8f3e9'; context.font = '700 34px system-ui'; context.fillText('RP THREAD BUDDY  /  WRITING STATS', 70, 93)
  context.font = '600 74px Georgia'; context.fillText(character.name.slice(0, 24), 330, 270)
  context.fillStyle = '#a9d4dc'; context.font = '700 24px system-ui'; context.fillText(character.state.toUpperCase(), 332, 320)
  ;[['TOTAL THREADS', counts.total], ['YOUR TURN', counts.mine], ['THEIR TURN', counts.theirs]].forEach(([label, value], index) => { const x = 70 + index * 365; context.fillStyle = '#2d3a40'; context.fillRect(x, 410, 325, 145); context.fillStyle = '#a9d4dc'; context.font = '700 20px system-ui'; context.fillText(String(label), x + 24, 450); context.fillStyle = '#f8f3e9'; context.font = '600 64px Georgia'; context.fillText(String(value), x + 24, 525) })
  context.save(); context.beginPath(); context.arc(195, 275, 105, 0, Math.PI * 2); context.clip()
  if (character.iconObjectKey) {
    const blob = await fetch('/api/characters/' + character.id + '/icon').then(response => response.ok ? response.blob() : null)
    if (blob) { const url = URL.createObjectURL(blob), image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load icon')); image.src = url }); context.drawImage(image, 90, 170, 210, 210); URL.revokeObjectURL(url) }
  } else { context.fillStyle = '#a9d4dc'; context.fillRect(90, 170, 210, 210); context.fillStyle = '#182126'; context.font = '600 92px Georgia'; context.fillText(character.name.slice(0, 1).toUpperCase(), 160, 310) }
  context.restore(); context.strokeStyle = '#f8f3e9'; context.lineWidth = 7; context.beginPath(); context.arc(195, 275, 105, 0, Math.PI * 2); context.stroke()
  const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!result) throw new Error('Could not export stats card')
  return result
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const fileSlug = (name: string, fallback: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
