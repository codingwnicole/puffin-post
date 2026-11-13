const encoder = new TextEncoder()
// Cloudflare Workers caps PBKDF2 at 100,000 iterations. Keeping this at the
// platform limit avoids password setup and sign-in failing at runtime.
const iterations = 100_000

function bytes(bytes: Uint8Array) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') }
function fromHex(value: string) { return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte,16)) }

export function validPassword(value: unknown): value is string { return typeof value === 'string' && value.length >= 8 && value.length <= 200 }

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations },key,256)
  return `${iterations}.${bytes(salt)}.${bytes(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string | null) {
  const [rounds,saltHex,hashHex] = stored?.split('.') ?? []
  if (!rounds || !saltHex || !hashHex || !validPassword(password)) return false
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits'])
  const storedIterations = Number(rounds)
  if (!Number.isSafeInteger(storedIterations) || storedIterations < 1 || storedIterations > 100_000) return false
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:fromHex(saltHex), iterations:storedIterations },key,256))
  const expected=fromHex(hashHex); if(bits.length!==expected.length) return false
  let mismatch=0; for(let index=0;index<bits.length;index++) mismatch|=bits[index]^expected[index]
  return mismatch===0
}
