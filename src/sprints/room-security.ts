const encoder = new TextEncoder()

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function unhex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], pair => Number.parseInt(pair, 16))
}

export function randomRoomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashRoomToken(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

export async function hashRoomPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256)
  return `${hex(salt)}.${hex(new Uint8Array(bits))}`
}

export async function verifyRoomPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, expectedHex, extra] = stored.split('.')
  if (extra !== undefined || !/^[a-f0-9]{32}$/u.test(saltHex ?? '') || !/^[a-f0-9]{64}$/u.test(expectedHex ?? '')) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex) as Uint8Array<ArrayBuffer>, iterations: 100_000 }, key, 256)
  const actual = new Uint8Array(bits), expected = unhex(expectedHex)
  let difference = actual.length ^ expected.length
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ (expected[index] ?? 0)
  return difference === 0
}
