import { hashToken, randomToken } from '../auth/sessions'

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

async function key(secret: string) {
  if (!secret || secret.length < 32) throw new Error('Token encryption key must contain at least 32 characters')
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encryptToken(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(value))
  return `${b64(iv)}.${b64(new Uint8Array(ciphertext))}`
}
export async function decryptToken(value: string, secret: string): Promise<string> {
  const [iv, ciphertext] = value.split('.')
  if (!iv || !ciphertext) throw new Error('Invalid encrypted token')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(ciphertext)))
}
export async function createOauthState() { const value = randomToken(); return { value, hash: await hashToken(value) } }

function percent(value: string) { return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) }
export async function oauthAuthorizationHeader(method: string, url: string, consumerKey: string, consumerSecret: string, token = '', tokenSecret = '', extra: Record<string,string> = {}) {
  const requestUrl = new URL(url)
  const params: Record<string,string> = { oauth_consumer_key: consumerKey, oauth_nonce: randomToken(), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now()/1000)), oauth_version:'1.0', ...extra }
  if (token) params.oauth_token = token
  // OAuth 1 signs query parameters, but the signature base URI must not include
  // the query string. The old signer did the reverse, which breaks endpoints
  // such as Tumblr's notifications feed.
  const signed = [...requestUrl.searchParams.entries(), ...Object.entries(params)]
  const normalized = signed.sort(([a,av],[b,bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([k,v]) => `${percent(k)}=${percent(v)}`).join('&')
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}`
  const base = [method.toUpperCase(), percent(baseUrl), percent(normalized)].join('&')
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(`${percent(consumerSecret)}&${percent(tokenSecret)}`), { name:'HMAC', hash:'SHA-1' }, false, ['sign'])
  params.oauth_signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(base))))
  return 'OAuth ' + Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${percent(k)}="${percent(v)}"`).join(', ')
}
