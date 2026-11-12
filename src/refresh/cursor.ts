export function rotateAfter<T extends { id: string }>(items: T[], after: string | null, limit: number): T[] {
  if (!items.length || limit <= 0) return []
  const start = after ? Math.max(0, items.findIndex(item => item.id > after)) : 0
  const ordered = [...items.slice(start), ...items.slice(0, start)]
  return ordered.slice(0, Math.min(limit, ordered.length))
}
