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
import { pushRoutes } from './routes/push'
import { sendDuePushes } from './routes/push'
import { titleStyleRoutes } from './routes/title-styles'
import { tumblrActivityRoutes } from './routes/tumblr-activity'
import { characterPlannerRoutes } from './routes/character-planner'
import { featureSuggestionRoutes } from './routes/feature-suggestions'
import { supportRoutes } from './routes/support'

export interface Env {
  DB: D1Database
  ICONS: R2Bucket
  APP_ORIGIN: string
  SESSION_SECRET: string
  TOKEN_ENCRYPTION_KEY: string
  TUMBLR_CONSUMER_KEY: string
  TUMBLR_CONSUMER_SECRET: string
  RESEND_API_KEY: string
  MAIL_FROM: string
  PUSH_VAPID_PRIVATE_KEY?: string
  BOOTSTRAP_OWNER_EMAIL?: string
}

export function createApp(env: Env, options: { mailSender?: MailSender } = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Build-Revision', BUILD_REVISION)
    c.header('X-Frame-Options', 'DENY')
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tumblr.com; connect-src 'self' https://*.tumblr.com; frame-ancestors 'none'")
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
      response.headers.set('X-Build-Revision', BUILD_REVISION)
      return response
    }
    if (error instanceof SyntaxError) { const response = c.json({ error: 'Invalid request body' }, 400); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (error instanceof ZodError) { const response = c.json({ error: 'Invalid request body or query' },400); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (['Starter not found','Branch not found','Draft not found','Character not found','Partner not found'].includes(error.message)) { const response = c.json({ error: error.message },404); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    if (['Draft is archived','Draft is already converted'].includes(error.message)) { const response = c.json({ error: error.message },409); response.headers.set('X-Build-Revision', BUILD_REVISION); return response }
    // Never log the raw error message: a DB/OAuth error could carry a token or email in
    // its text, and the 500 below already returns a safe client-facing message.
    console.error('Unhandled request error', { path:c.req.path, method:c.req.method, name:error instanceof Error ? error.name : 'unknown' })
    const response = c.json({ error: error instanceof Error ? error.message : 'Request failed' }, 500); response.headers.set('X-Build-Revision', BUILD_REVISION); return response
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
  return app
}

export default {
  fetch(request, env, ctx) {
    return createApp(env).fetch(request, env, ctx)
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([runRefreshBatch(env, new Date(), 20),sendDuePushes(env)]))
  },
} satisfies ExportedHandler<Env>
