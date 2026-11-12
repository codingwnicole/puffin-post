import { useState } from 'react'

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1
    ? Array.from(words[0]).slice(0, 2).join('')
    : Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toLocaleUpperCase()
}

export function InitialsAvatar({ name, imageUrl, color }: { name: string; imageUrl?: string | null; color?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  let style
  // Only opaque hex colors have a stable contrast independent of the surrounding theme.
  if (color && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
    const hex = color.length === 4 ? color.slice(1).split('').map(channel => channel + channel).join('') : color.slice(1)
    const channels = [0, 2, 4].map(offset => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    })
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    const blackContrast = (luminance + .05) / .05
    const whiteContrast = 1.05 / (luminance + .05)
    style = { backgroundColor: color, color: blackContrast >= whiteContrast ? '#000000' : '#ffffff' }
  }
  return (
    <span className="initials-avatar" style={style}>
      {imageUrl && imageUrl !== failedUrl
        ? <img src={imageUrl} alt={name} onError={() => setFailedUrl(imageUrl)} />
        : <span role="img" aria-label={name || 'Unnamed character'}>{initialsFor(name)}</span>}
    </span>
  )
}

export default InitialsAvatar
