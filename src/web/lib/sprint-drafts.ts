import type { LocalSprint } from '../../shared/writing-sprints'

const DATABASE = 'rpthreadbuddy-writing-sprints'
const STORE = 'sessions'
const FALLBACK_PREFIX = 'rpthreadbuddy-writing-sprint:'

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Browser draft storage is unavailable.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Browser draft storage could not be opened.'))
    request.onblocked = () => reject(new Error('Close another RP Thread Buddy tab to update sprint storage.'))
  })
}

function fallbackWrite(session: LocalSprint): void {
  localStorage.setItem(FALLBACK_PREFIX + session.id, JSON.stringify(session))
}

function fallbackRead(id: string): LocalSprint | null {
  const value = localStorage.getItem(FALLBACK_PREFIX + id)
  return value ? JSON.parse(value) as LocalSprint : null
}

function fallbackList(): LocalSprint[] {
  const sessions: LocalSprint[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(FALLBACK_PREFIX)) {
      try { const value = localStorage.getItem(key); if (value) sessions.push(JSON.parse(value) as LocalSprint) } catch { /* Ignore one damaged local record. */ }
    }
  }
  return sessions
}

export async function saveLocalSprint(session: LocalSprint): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(session)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Sprint draft could not be saved.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Sprint draft could not be saved.'))
    })
  } catch (error) {
    try { fallbackWrite(session) } catch { throw error }
  }
}

export async function getLocalSprint(id: string): Promise<LocalSprint | null> {
  try {
    const db = await openDatabase()
    const saved = await new Promise<LocalSprint | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      request.onsuccess = () => resolve((request.result as LocalSprint | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Sprint draft could not be read.'))
    })
    return saved ?? fallbackRead(id)
  } catch {
    try { return fallbackRead(id) } catch { return null }
  }
}

export async function listLocalSprints(): Promise<LocalSprint[]> {
  try {
    const db = await openDatabase()
    const saved = await new Promise<LocalSprint[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as LocalSprint[])
      request.onerror = () => reject(request.error ?? new Error('Sprint drafts could not be read.'))
    })
    const byId = new Map(saved.map(session => [session.id, session]))
    for (const session of fallbackList()) byId.set(session.id, byId.get(session.id) ?? session)
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    try { return fallbackList().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) } catch { return [] }
  }
}

export async function deleteLocalSprint(id: string): Promise<void> {
  const fallbackKey = FALLBACK_PREFIX + id
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Sprint draft could not be deleted.'))
    })
  } catch (error) {
    try {
      if (localStorage.getItem(fallbackKey) === null) throw error
      localStorage.removeItem(fallbackKey)
      return
    } catch { throw error }
  }
  try { localStorage.removeItem(fallbackKey) } catch { /* IndexedDB copy was deleted successfully. */ }
}

export async function acquireSprintLock(id: string): Promise<{ supported: boolean; acquired: boolean; release: () => void }> {
  if (!('locks' in navigator)) return { supported: false, acquired: true, release: () => undefined }
  let releaseLock: () => void = () => {}
  const acquired = await new Promise<boolean>(resolve => {
    void navigator.locks.request(`rpthreadbuddy-sprint:${id}`, { ifAvailable: true }, async lock => {
      resolve(Boolean(lock))
      if (lock) await new Promise<void>(release => { releaseLock = () => release() })
    }).catch(() => resolve(false))
  })
  return { supported: true, acquired, release: releaseLock }
}
