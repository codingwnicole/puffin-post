import type { Env } from '../worker'
import { sendEmail } from '../mail'
import { findInvite, normalizeEmail } from './invites'
import { hashToken, randomToken } from './sessions'

export interface MailSender {
  send(message: { to: string; url: string; html: string }): Promise<void>
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function magicLinkEmail(url: string) {
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#142027;color:#f8f3e9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#142027;"><tr><td style="padding:40px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;margin:0 auto;">
      <tr><td style="padding:0 12px 18px;color:#f8f3e9;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:bold;">
        <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;margin-right:9px;border-radius:50%;background:#dce8e9;color:#263d45;font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:13px;letter-spacing:-1px;">RP</span>RP Thread Buddy
      </td></tr>
      <tr><td style="padding:38px 34px 34px;border:1px solid #4c6670;border-radius:16px;background:#213138;">
        <p style="margin:0 0 12px;color:#a9d4dc;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Your writing space</p>
        <h1 style="margin:0;color:#f8f3e9;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.1;font-weight:normal;">Your sign-in link is ready.</h1>
        <p style="margin:20px 0 26px;color:#d9e1dd;font-size:16px;line-height:1.6;">Open RP Thread Buddy and pick your story back up right where you left it.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:9px;background:#a9d4dc;">
          <a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border-radius:9px;color:#17242a;font-size:16px;font-weight:bold;line-height:1;text-decoration:none;">Open RP Thread Buddy</a>
        </td></tr></table>
        <p style="margin:27px 0 0;padding-top:20px;border-top:1px solid #4c6670;color:#b9c8c7;font-size:13px;line-height:1.55;">This private link expires in 15 minutes and works once. If you did not request it, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="padding:18px 12px 0;color:#9badad;font-size:12px;line-height:1.5;">Button giving you trouble? Copy this link into your browser:<br><a href="${safeUrl}" style="color:#a9d4dc;word-break:break-all;">${safeUrl}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

export function resendMailSender(env: Env): MailSender {
  return { async send({ to, url }) {
    await sendEmail(env, { to: [to], subject: 'Your RP Thread Buddy sign-in link',
      text: `Sign in to RP Thread Buddy: ${url}\n\nThis link expires in 15 minutes and can be used once.`, html: magicLinkEmail(url) }, 'Unable to send sign-in email')
  } }
}

export interface MagicLinkIdentity {
  email: string
  intent: 'sign_in' | 'accept_invite'
  workspaceId: string
  inviteId: string | null
}

export function createMagicLinks(env: Env, sender: MailSender = resendMailSender(env)) {
  async function insertMagicLink(email: string, intent: MagicLinkIdentity['intent'], invite: { inviteToken: string; workspaceId: string } | undefined, limitActive: boolean): Promise<string | null> {
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
    const tokenHash = await hashToken(token), expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
    const inserted = limitActive
      ? await env.DB.prepare(`INSERT INTO magic_links (token_hash, email, intent, workspace_id, invite_id, expires_at)
          SELECT ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM magic_links WHERE email=? COLLATE NOCASE AND consumed_at IS NULL AND expires_at>?) < 3
          RETURNING token_hash`)
        .bind(tokenHash, email, intent, workspaceId, inviteId, expiresAt, email, new Date().toISOString()).first()
      : await env.DB.prepare('INSERT INTO magic_links (token_hash, email, intent, workspace_id, invite_id, expires_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING token_hash')
        .bind(tokenHash, email, intent, workspaceId, inviteId, expiresAt).first()
    return inserted ? token : null
  }

  async function issueMagicLink(email: string, intent: MagicLinkIdentity['intent'] = 'sign_in', invite?: { inviteToken: string; workspaceId: string }): Promise<string> {
    const token = await insertMagicLink(email, intent, invite, false)
    if (!token) throw new Error('invalid magic link')
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

  async function sendMagicLink(email: string, intent: MagicLinkIdentity['intent'], invite?: { inviteToken: string; workspaceId: string }): Promise<boolean> {
    const token = await insertMagicLink(email, intent, invite, true)
    if (!token) return false
    const url = new URL('/api/auth/verify', env.APP_ORIGIN)
    url.searchParams.set('token', token)
    try { await sender.send({ to: normalizeEmail(email), url: url.toString(), html: magicLinkEmail(url.toString()) }); return true } catch (error) {
      await env.DB.prepare('DELETE FROM magic_links WHERE token_hash = ?').bind(await hashToken(token)).run()
      throw error
    }
  }

  return { issueMagicLink, consumeMagicLink, inspectMagicLink, sendMagicLink }
}
