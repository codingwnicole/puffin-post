export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'content-type':'application/json' },
    ...(body !== undefined ? { body:JSON.stringify(body) } : {}) })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to see your writing space.')
    const error = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(error?.error ?? 'Could not save or load this item. Please try again.')
  }
  return response.json() as Promise<T>
}
export interface TrackingOptions { characters: { id:string; name:string }[]; partners: { id:string; name:string }[] }
