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
  BOOTSTRAP_OWNER_EMAIL?: string
}

export function createApp(env: Env, options: { mailSender?: MailSender } = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== env.APP_ORIGIN) {
      throw new HTTPException(403, { message: 'Invalid request origin' })
    }
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const response = error.getResponse()
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      return response
    }
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid request body' }, 400)
    if (error instanceof ZodError) return c.json({ error: 'Invalid request body or query' },400)
    if (['Starter not found','Branch not found','Draft not found','Character not found','Partner not found'].includes(error.message)) return c.json({ error: error.message },404)
    if (['Draft is archived','Draft is already converted'].includes(error.message)) return c.json({ error: error.message },409)
    return c.json({ error: 'Request failed' }, 500)
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
  return app
}

export default {
  fetch(request, env, ctx) {
    return createApp(env).fetch(request, env, ctx)
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runRefreshBatch(env, new Date(), 20))
  },
} satisfies ExportedHandler<Env>
