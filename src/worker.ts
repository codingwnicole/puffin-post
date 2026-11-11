import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { resendMailSender, type MailSender } from './auth/magic-links'
import { authRoutes } from './routes/auth'
import { inviteRoutes } from './routes/invites'

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
    if (error instanceof HTTPException) return error.getResponse()
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid request body' }, 400)
    return c.json({ error: 'Request failed' }, 500)
  })
  const sender = options.mailSender ?? resendMailSender(env)
  app.route('/api/auth', authRoutes(env, sender))
  app.route('/api/workspaces', inviteRoutes(env, sender))
  return app
}

export default {
  fetch(request, env, ctx) {
    return createApp(env).fetch(request, env, ctx)
  },
  scheduled() {
    // Refresh processing is added in the scheduled-refresh task.
  },
} satisfies ExportedHandler<Env>
