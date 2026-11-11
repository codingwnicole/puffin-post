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
  return (
    <span className="initials-avatar" style={color ? { backgroundColor: color } : undefined}>
      {imageUrl && imageUrl !== failedUrl
        ? <img src={imageUrl} alt={name} onError={() => setFailedUrl(imageUrl)} />
        : <span role="img" aria-label={name || 'Unnamed character'}>{initialsFor(name)}</span>}
    </span>
  )
}

export default InitialsAvatar
