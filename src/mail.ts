import type { Env } from './worker'

export const SUPPORT_EMAIL = 'support@rpthreadbuddy.app'

// Every transactional email goes through here, so the sender (MAIL_FROM) and Reply-To stay consistent.
// Replies go to the support inbox unless a message names a better person to answer (e.g. the reporter).
export async function sendEmail(env: Env, message: { to: string[]; subject: string; text: string; html?: string; replyTo?: string }, failure: string) {
  const { replyTo = SUPPORT_EMAIL, ...content } = message
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from: env.MAIL_FROM, reply_to: [replyTo], ...content }),
  })
  if (!response.ok) throw new Error(failure)
}
