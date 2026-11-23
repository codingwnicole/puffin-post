import { BUILD_REVISION } from './build-revision'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { resendMailSender, type MailSender } from './auth/magic-links'
import { authRoutes } from './routes/auth'
import { inviteRoutes } from './routes/invites'
import { ZodError } from 'zod'
import { starterRoutes } from './routes/starters'
import { branchRoutes } from './routes/branches'
import { replyDraftRoutes } from './routes/reply-drafts'
import { tumblrRoutes } from './routes/tumblr'
import { connectionRoutes } from './routes/connections'
import { runRefreshBatch } from './refresh/runner'
import { characterRoutes } from './routes/characters'
import { partnerRoutes } from './routes/partners'
import { tagRoutes } from './routes/tags'
import { exportRoutes } from './routes/export'
import { settingsRoutes } from './routes/settings'
import { groupRoutes } from './routes/groups'
import { pushRoutes, sendDuePushes } from './routes/push'
import { titleStyleRoutes } from './routes/title-styles'
import { tumblrActivityRoutes } from './routes/tumblr-activity'
import { characterPlannerRoutes } from './routes/character-planner'
import { featureSuggestionRoutes } from './routes/feature-suggestions'
import { supportRoutes } from './routes/support'
import { clientErrorRoutes } from './routes/client-errors'
import { publicShareRoutes, shareAdminRoutes } from './routes/public-share'
import { roadmapRoutes } from './routes/roadmap'
import { sprintRoutes } from './routes/sprints'
import { sprintRoomRoutes } from './routes/sprint-rooms'
import type { SprintRoom } from './sprints/room'
export { SprintRoom } from './sprints/room'

export interface Env {
  DB: D1Database
  ICONS: R2Bucket
  ASSETS: Fetcher
  APP_ORIGIN: string
  SESSION_SECRET: string
  TOKEN_ENCRYPTION_KEY: string
  TUMBLR_CONSUMER_KEY: string
  TUMBLR_CONSUMER_SECRET: string
  RESEND_API_KEY: string
  MAIL_FROM: string
  MODERATOR_USER_ID?: string
  PUSH_VAPID_PRIVATE_KEY?: string
  BOOTSTRAP_OWNER_EMAIL?: string
  REFRESH_FETCH_BUDGET?: string
  SPRINT_ROOMS: DurableObjectNamespace<SprintRoom>
}

export function createApp(env: Env, options: { mailSender?: MailSender } = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Build-Revision', BUILD_REVISION)
    c.header('X-Frame-Options', 'DENY')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Strict-Transport-Security', 'max-age=31536000')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    const socketOrigin = new URL(env.APP_ORIGIN)
    socketOrigin.protocol = socketOrigin.protocol === 'https:' ? 'wss:' : 'ws:'
    c.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tumblr.com; connect-src 'self' https://*.tumblr.com ${socketOrigin.origin}; font-src 'self' data:; frame-src https://open.spotify.com https://www.youtube-nocookie.com https://embed.music.apple.com https://assets.pinterest.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`)
    const maxBodyBytes = 5 * 1024 * 1024
    const contentLength = Number(c.req.header('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new HTTPException(413, { message: 'Request body is too large' })
    }
    if (c.req.raw.body && !['GET', 'HEAD'].includes(c.req.method)) {
      const reader = c.req.raw.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBodyBytes) {
          await reader.cancel()
          throw new HTTPException(413, { message: 'Request body is too large' })
        }
        chunks.push(value)
      }
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      c.req.raw = new Request(c.req.raw, { body })
    }
    const isMagicLinkConfirmation = c.req.method === 'POST' && c.req.path === '/api/auth/verify'
    // Magic-link confirmation is protected by the unguessable, single-use token
    // in its form. Do not depend on Origin here: mail clients and browser privacy
    // modes legitimately send several incompatible values for a form opened from
    // an email link. Every other state-changing route remains same-origin only.
    const origin = c.req.header('origin')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isMagicLinkConfirmation && origin !== env.APP_ORIGIN) {
      throw new HTTPException(403, { message: 'Invalid request origin' })
    }
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const response = error.getResponse()
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      response.headers.set('X-Robots-Tag', 'noindex, nofollow')
      response.headers.set('X-Build-Revision', BUILD_REVISION)
      return response
    }
    if (error instanceof SyntaxError) { const response = c.json({ error: 'Invalid request body' }, 400); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (error instanceof ZodError) { const response = c.json({ error: 'Invalid request body or query' },400); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (['Starter not found','Branch not found','Draft not found','Character not found','Partner not found'].includes(error.message)) { const response = c.json({ error: error.message },404); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (['Draft is archived','Draft is already converted','Restore the archived thread before restoring this reply'].includes(error.message)) { const response = c.json({ error: error.message },409); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    // Never expose or log the raw error message: a DB/OAuth error could carry a token or email.
    console.error('Unhandled request error', { path:c.req.path, method:c.req.method, name:error instanceof Error ? error.name : 'unknown' })
    const response = c.json({ error: 'Request failed' }, 500); response.headers.set('X-Build-Revision', BUILD_REVISION); return response
  })
  const sender = options.mailSender ?? resendMailSender(env)
  app.route('/api/auth', authRoutes(env, sender))
  app.route('/api/workspaces', inviteRoutes(env, sender))
  app.route('/api/starters', starterRoutes())
  app.route('/api', branchRoutes())
  app.route('/api/reply-drafts', replyDraftRoutes())
  app.route('/api/tumblr', tumblrRoutes())
  app.route('/api/connections', connectionRoutes())
  app.route('/api/characters', characterRoutes())
  app.route('/api/partners', partnerRoutes())
  app.route('/api/tags', tagRoutes())
  app.route('/api', exportRoutes())
  app.route('/api/settings', settingsRoutes())
  app.route('/api/rp-groups', groupRoutes())
  app.route('/api/push',pushRoutes())
  app.route('/api/title-styles',titleStyleRoutes())
  app.route('/api/tumblr-activity',tumblrActivityRoutes())
  app.route('/api/character-planner',characterPlannerRoutes())
  app.route('/api/feature-suggestions',featureSuggestionRoutes())
  app.route('/api/support',supportRoutes())
  app.route('/api/roadmap',roadmapRoutes())
  app.route('/api/sprints', sprintRoutes())
  app.route('/api/sprint-rooms', sprintRoomRoutes())
  app.route('/api/client-errors',clientErrorRoutes(BUILD_REVISION))
  app.route('/api/share-admin',shareAdminRoutes())
  app.route('/c',publicShareRoutes())
  return app
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.hostname === 'puffinpost.app') {
      const canonicalOrigin = new URL(env.APP_ORIGIN)
      url.protocol = canonicalOrigin.protocol
      url.host = canonicalOrigin.host
      return Response.redirect(url.toString(), 301)
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/c' || url.pathname.startsWith('/c/')) {
      return createApp(env).fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
  scheduled(_event, env, ctx) {
    const runId = `sched-${Date.now()}-${Math.floor(Math.random()*1e6)}`
    const cleanupCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
    ctx.waitUntil(Promise.all([
      runRefreshBatch(env, new Date(), 60, { runId }),
      sendDuePushes(env),
      env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cleanupCutoff).run(),
      env.DB.prepare('DELETE FROM magic_links WHERE expires_at < ? OR consumed_at < ?').bind(cleanupCutoff, cleanupCutoff).run(),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?').bind(cleanupCutoff, cleanupCutoff).run(),
    ]))
  },
} satisfies ExportedHandler<Env>
