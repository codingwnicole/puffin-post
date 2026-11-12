import type { Env } from '../worker'
import { findInvite, normalizeEmail } from './invites'
import { hashToken, randomToken } from './sessions'

export interface MailSender {
  send(message: { to: string; url: string }): Promise<void>
}

export function resendMailSender(env: Env): MailSender {
  return { async send({ to, url }) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: 'Your Puffin Post sign-in link',
        text: `Sign in to Puffin Post: ${url}\n\nThis link expires in 15 minutes and can be used once.` }),
    })
    if (!response.ok) throw new Error('Unable to send sign-in email')
  } }
}

export interface MagicLinkIdentity {
  email: string
  intent: 'sign_in' | 'accept_invite'
  workspaceId: string
  inviteId: string | null
}

export function createMagicLinks(env: Env, sender: MailSender = resendMailSender(env)) {
  async function issueMagicLink(email: string, intent: MagicLinkIdentity['intent'] = 'sign_in', invite?: { inviteToken: string; workspaceId: string }): Promise<string> {
    email = normalizeEmail(email)
    let workspaceId: string
    let inviteId: string | null = null
    if (intent === 'accept_invite') {
      if (!invite) throw new Error('invalid invite')
      const invitation = await findInvite(env.DB, invite.inviteToken, email, invite.workspaceId)
      workspaceId = invitation.workspaceId
      inviteId = invitation.id
    } else if (intent === 'sign_in') {
      const member = await env.DB.prepare(`SELECT m.workspace_id AS workspaceId FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.email = ? ORDER BY m.created_at, m.workspace_id LIMIT 1`).bind(email).first<{ workspaceId: string }>()
      if (!member) throw new Error('invalid magic link')
      workspaceId = member.workspaceId
    } else { throw new Error('invalid magic link') }
    const token = randomToken()
    await env.DB.prepare('INSERT INTO magic_links (token_hash, email, intent, workspace_id, invite_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hashToken(token), email, intent, workspaceId, inviteId, new Date(Date.now() + 15 * 60_000).toISOString()).run()
    return token
  }

  async function consumeMagicLink(token: string): Promise<MagicLinkIdentity> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid magic link')
    const now = new Date().toISOString()
    const identity = await env.DB.prepare(`UPDATE magic_links SET consumed_at = ?
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
      RETURNING email, intent, workspace_id AS workspaceId, invite_id AS inviteId`)
      .bind(now, await hashToken(token), now).first<MagicLinkIdentity>()
    if (!identity) throw new Error('invalid magic link')
    return identity
  }

  async function inspectMagicLink(token: string): Promise<MagicLinkIdentity> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid magic link')
    const identity = await env.DB.prepare(`SELECT email, intent, workspace_id AS workspaceId, invite_id AS inviteId
      FROM magic_links WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
      .bind(await hashToken(token), new Date().toISOString()).first<MagicLinkIdentity>()
    if (!identity) throw new Error('invalid magic link')
    return identity
  }

  async function sendMagicLink(email: string, intent: MagicLinkIdentity['intent'], invite?: { inviteToken: string; workspaceId: string }): Promise<void> {
    const token = await issueMagicLink(email, intent, invite)
    const url = new URL('/api/auth/verify', env.APP_ORIGIN)
    url.searchParams.set('token', token)
    try { await sender.send({ to: normalizeEmail(email), url: url.toString() }) } catch (error) {
      await env.DB.prepare('DELETE FROM magic_links WHERE token_hash = ?').bind(await hashToken(token)).run()
      throw error
    }
  }

  return { issueMagicLink, consumeMagicLink, inspectMagicLink, sendMagicLink }
}
