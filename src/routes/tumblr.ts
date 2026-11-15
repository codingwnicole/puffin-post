import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { requireWorkspace, hashToken, randomToken } from '../auth/sessions'
import { createOauthState, decryptToken, encryptToken, oauthAuthorizationHeader } from '../tumblr/oauth'
import { createTumblrClient } from '../tumblr/client'

const REQUEST_TOKEN_URL = 'https://www.tumblr.com/oauth/request_token'
const ACCESS_TOKEN_URL = 'https://www.tumblr.com/oauth/access_token'
const AUTHORIZE_URL = 'https://www.tumblr.com/oauth/authorize'
const FETCH_TIMEOUT_MS = 15_000
const parseForm = (text: string) => Object.fromEntries(new URLSearchParams(text))

export function tumblrRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/connect', async c => {
    const scope = await requireWorkspace(c)
    const state = await createOauthState()
    // OAuth 1 providers return the registered callback unchanged, so state lives in
    // the signed callback itself rather than an OAuth 2-only authorization parameter.
    const callback = `${c.env.APP_ORIGIN}/api/tumblr/callback?state=${encodeURIComponent(state.value)}`
    const response = await fetch(REQUEST_TOKEN_URL, { method:'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Authorization: await oauthAuthorizationHeader('POST', REQUEST_TOKEN_URL, c.env.TUMBLR_CONSUMER_KEY, c.env.TUMBLR_CONSUMER_SECRET, '', '', { oauth_callback: callback }) } })
    if (!response.ok) throw new HTTPException(502, { message:'Tumblr connection unavailable' })
    const token = parseForm(await response.text())
    if (!token.oauth_token || !token.oauth_token_secret) throw new HTTPException(502, { message:'Tumblr connection unavailable' })
    await c.env.DB.prepare('INSERT INTO tumblr_oauth_states (state_hash,workspace_id,request_token_encrypted,request_secret_encrypted,expires_at) VALUES (?,?,?,?,?)')
      .bind(state.hash, scope.workspaceId, await encryptToken(token.oauth_token, c.env.TOKEN_ENCRYPTION_KEY), await encryptToken(token.oauth_token_secret, c.env.TOKEN_ENCRYPTION_KEY), new Date(Date.now() + 10 * 60_000).toISOString()).run()
    return c.redirect(`${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(token.oauth_token)}`)
  })
  app.get('/callback', async c => {
    const state = c.req.query('state') ?? '', token = c.req.query('oauth_token') ?? '', verifier = c.req.query('oauth_verifier') ?? ''
    if (!/^[a-f0-9]{64}$/.test(state) || !token || !verifier) throw new HTTPException(400, { message:'Invalid Tumblr connection' })
    const hash = await hashToken(state)
    const row = await c.env.DB.prepare('SELECT * FROM tumblr_oauth_states WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?').bind(hash, new Date().toISOString()).first<{ workspace_id:string; request_token_encrypted:string; request_secret_encrypted:string }>()
    if (!row) throw new HTTPException(400, { message:'Invalid Tumblr connection' })
    // Consume before exchanging so a second callback cannot redeem the same state.
    const claimed = await c.env.DB.prepare('UPDATE tumblr_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL').bind(new Date().toISOString(), hash).run()
    if (!claimed.meta.changes) throw new HTTPException(400, { message:'Invalid Tumblr connection' })
    const requestToken = await decryptToken(row.request_token_encrypted, c.env.TOKEN_ENCRYPTION_KEY)
    if (token !== requestToken) throw new HTTPException(400, { message:'Invalid Tumblr connection' })
    const requestSecret = await decryptToken(row.request_secret_encrypted, c.env.TOKEN_ENCRYPTION_KEY)
    const response = await fetch(ACCESS_TOKEN_URL, { method:'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Authorization: await oauthAuthorizationHeader('POST', ACCESS_TOKEN_URL, c.env.TUMBLR_CONSUMER_KEY, c.env.TUMBLR_CONSUMER_SECRET, token, requestSecret, { oauth_verifier: verifier }) } })
    if (!response.ok) throw new HTTPException(502, { message:'Tumblr connection unavailable' })
    const access = parseForm(await response.text())
    if (!access.oauth_token || !access.oauth_token_secret) throw new HTTPException(502, { message:'Tumblr connection unavailable' })
    const client = createTumblrClient({ consumerKey:c.env.TUMBLR_CONSUMER_KEY, consumerSecret:c.env.TUMBLR_CONSUMER_SECRET, token:access.oauth_token, tokenSecret:access.oauth_token_secret })
    const blogs = await client.getBlogs()
    await c.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)')
      .bind(randomToken(), row.workspace_id, await encryptToken(access.oauth_token, c.env.TOKEN_ENCRYPTION_KEY), await encryptToken(access.oauth_token_secret, c.env.TOKEN_ENCRYPTION_KEY), JSON.stringify({ blogs })).run()
    return c.redirect('/#/connections?connected=1')
  })
  return app
}
