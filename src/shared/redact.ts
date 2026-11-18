// Scrub anything that could be an email address or a credential-looking token out of
// free-form client text before it reaches the log. Client error reports are the only
// source of free text we log, so every log line that could contain user input goes
// through this first.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
// Long base64-ish runs (JWTs, API keys, bearer tokens) — 20+ chars with no spaces.
const TOKEN = /\b[A-Za-z0-9+/_=-]{20,}\b/g

export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKEN, '[token]')
}
