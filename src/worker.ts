import { Hono } from 'hono'

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

export function createApp(_env: Env): Hono<{ Bindings: Env }> {
  return new Hono<{ Bindings: Env }>()
}

export default {
  fetch(request, env, ctx) {
    return createApp(env).fetch(request, env, ctx)
  },
  scheduled() {
    // Refresh processing is added in the scheduled-refresh task.
  },
} satisfies ExportedHandler<Env>
