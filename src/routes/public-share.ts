import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { checkRateLimit } from '../auth/rate-limits'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { Side, type CardProfile, type CardStats, THEMES } from '../web/components/TradingCard'
import { parsePlaylist } from '../shared/embeds'

const moderatorEmail = 'tmixwix@gmail.com'

type ShareRow = { id: string; workspaceId: string; characterId: string; slug: string; style: 'card' | 'stats'; showMoodboard: number; showPlaylist: number; showStats: number; indexable: number; previewObjectKey: string | null; disabledByModerator: number }
type CharRow = { name: string; iconObjectKey: string | null; cardJson: string | null }

const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; frame-src https://open.spotify.com https://www.youtube-nocookie.com https://embed.music.apple.com https://assets.pinterest.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const EMBED_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors *; base-uri 'none'"

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

async function loadShare(db: D1Database, slug: string): Promise<{ share: ShareRow; char: CharRow } | null> {
  const share = await db.prepare('SELECT id, workspace_id AS workspaceId, character_id AS characterId, slug, style, show_moodboard AS showMoodboard, show_playlist AS showPlaylist, show_stats AS showStats, indexable, preview_object_key AS previewObjectKey, disabled_by_moderator AS disabledByModerator FROM character_shares WHERE slug=?').bind(slug).first<ShareRow>()
  if (!share || share.disabledByModerator) return null
  const char = await db.prepare('SELECT name, icon_object_key AS iconObjectKey, card_json AS cardJson FROM characters WHERE workspace_id=? AND id=?').bind(share.workspaceId, share.characterId).first<CharRow>()
  if (!char) return null
  return { share, char }
}

async function getStats(db: D1Database, workspaceId: string, characterId: string): Promise<CardStats> {
  const rows = await db.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN b.status='your_turn' THEN 1 ELSE 0 END) AS mine,
    SUM(CASE WHEN b.status='their_turn' THEN 1 ELSE 0 END) AS theirs
    FROM reply_branches b JOIN starters s ON s.id=b.starter_id AND s.workspace_id=b.workspace_id
    WHERE s.workspace_id=? AND s.character_id=? AND s.archived=0`).bind(workspaceId, characterId).first<{ total: number; mine: number; theirs: number }>()
  const rps = await db.prepare('SELECT DISTINCT g.name FROM rp_group_characters rgc JOIN rp_groups g ON g.id=rgc.group_id AND g.workspace_id=rgc.workspace_id WHERE rgc.workspace_id=? AND rgc.character_id=?').bind(workspaceId, characterId).all<{ name: string }>()
  return { total: rows?.total ?? 0, mine: rows?.mine ?? 0, theirs: rows?.theirs ?? 0, rps: rps.results.map(r => r.name) }
}

function renderPage(share: ShareRow, char: CharRow, card: CardProfile, stats: CardStats, moodItems: { id: string; kind: string; pinId: string | null }[], appOrigin: string): string {
  const name = char.name
  const slug = share.slug
  const description = card.nickname || card.quote || 'A character card on Puffin Post'
  const hasPreview = !!share.previewObjectKey
  const noindex = !share.indexable

  const frontSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'front', name, profile: card, stats, portrait: `/c/${slug}/portrait`, moodboard: [], uid: 'f' })) : ''
  const backSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'back', name, profile: card, stats: share.showStats ? stats : { total: 0, mine: 0, theirs: 0, rps: [] }, portrait: null, moodboard: [], uid: 'b' })) : ''

  let moodboardHtml = ''
  if (share.showMoodboard && moodItems.length > 0) {
    const items = moodItems.map(item => {
      if (item.kind === 'pin' && item.pinId) return `<iframe src="https://assets.pinterest.com/ext/embed.html?id=${escapeHtml(item.pinId)}" style="width:236px;height:326px;border:none;border-radius:8px" loading="lazy"></iframe>`
      if (item.kind === 'image') return `<img src="/c/${escapeHtml(slug)}/m/${escapeHtml(item.id)}" alt="" style="width:100%;border-radius:8px;object-fit:cover" loading="lazy">`
      return ''
    }).filter(Boolean).join('')
    moodboardHtml = `<section style="margin-top:24px"><h2 style="font-size:18px;margin:0 0 12px">Moodboard</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">${items}</div></section>`
  }

  let playlistHtml = ''
  if (share.showPlaylist && card.playlistUrl) {
    const parsed = parsePlaylist(card.playlistUrl)
    if (parsed) {
      const label = parsed.provider === 'spotify' ? 'Spotify' : parsed.provider === 'apple' ? 'Apple Music' : 'YouTube'
      const embedHeight = parsed.provider === 'spotify' ? '352' : parsed.provider === 'apple' ? '450' : '315'
      playlistHtml = `<section style="margin-top:24px"><h2 style="font-size:18px;margin:0 0 12px">Playlist</h2><div data-playlist-container data-embed-src="${escapeHtml(parsed.embedUrl)}" data-embed-height="${embedHeight}"><button type="button" data-playlist-load style="padding:8px 20px;background:#7c5cbf;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:44px">Load the ${escapeHtml(label)} player</button><br><a href="${escapeHtml(parsed.openUrl)}" target="_blank" rel="noopener" style="color:#7c5cbf;margin-top:8px;display:inline-block">Open in ${escapeHtml(label)}</a></div></section>`
    }
  }

  let statsHtml = ''
  if (share.showStats) {
    statsHtml = `<section style="margin-top:24px"><h2 style="font-size:18px;margin:0 0 12px">Thread Stats</h2><div style="display:flex;gap:24px"><div><strong>${stats.total}</strong> threads</div><div><strong>${stats.mine}</strong> your turn</div><div><strong>${stats.theirs}</strong> their turn</div></div>${stats.rps.length ? `<p style="margin:8px 0 0;opacity:0.7">Writes in ${escapeHtml(stats.rps.join(' / '))}</p>` : ''}</section>`
  }

  const cardPreviewHtml = share.style === 'card'
    ? `<div style="flex-shrink:0"><button type="button" data-open-overlay style="background:none;border:none;padding:0;cursor:pointer" title="View card"><div id="card-preview" style="width:220px">${frontSvg}</div></button></div>`
    : `<div style="flex-shrink:0;text-align:center"><div style="width:80px;height:80px;border-radius:50%;overflow:hidden;margin:0 auto 12px"><img src="/c/${escapeHtml(slug)}/portrait" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"></div></div>`

  const overlayHtml = share.style === 'card' ? `<div id="card-overlay" hidden style="position:fixed;inset:0;z-index:900;display:grid;place-items:center;padding:1rem;background:rgba(0,0,0,.65);backdrop-filter:blur(4px)"><div style="max-width:340px;width:100%"><div id="card-flip-area" data-flipped="false"><div class="card-face-front">${frontSvg}</div><div class="card-face-back" style="display:none">${backSvg}</div></div><div style="display:flex;gap:12px;justify-content:center;margin-top:12px"><button type="button" data-card-flip="card-flip-area" aria-pressed="false" style="padding:8px 20px;background:#7c5cbf;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:44px">Flip</button><button type="button" data-close-overlay style="padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:44px">Close</button></div></div></div>` : ''

  const boardHtml = share.showMoodboard && card.boardUrl ? `<p style="margin:8px 0 0"><a href="${escapeHtml(card.boardUrl)}" target="_blank" rel="noopener" style="color:#7c5cbf">Pinterest board</a></p>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)} &middot; Puffin Post</title>
<meta property="og:title" content="${escapeHtml(name)}">
<meta property="og:description" content="${escapeHtml(description)}">
${hasPreview ? `<meta property="og:image" content="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}/card.png">` : ''}
<meta property="og:url" content="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}">
<meta name="twitter:card" content="summary_large_image">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<style>
*{box-sizing:border-box;margin:0}body{font-family:Georgia,serif;background:#1a1520;color:#f0e8f0;padding:24px 16px;min-height:100vh}
a{color:#7c5cbf}.container{max-width:720px;margin:0 auto}
.header{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.content{flex:1;min-width:200px}
h1{font-size:28px;margin:0 0 8px}
.subtitle{opacity:0.7;font-style:italic;margin-bottom:16px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid #333;font-size:13px;opacity:0.6}
#card-preview svg{width:100%;height:auto}
[data-flipped="false"] .card-face-front{display:block}[data-flipped="false"] .card-face-back{display:none}
[data-flipped="true"] .card-face-front{display:none}[data-flipped="true"] .card-face-back{display:block}
.card-face-front svg,.card-face-back svg{width:100%;height:auto}
@media(max-width:600px){.header{flex-direction:column}#card-preview{width:160px!important}}
</style>
</head>
<body>
<div class="container">
<div class="header">
${cardPreviewHtml}
<div class="content">
<h1>${escapeHtml(name)}</h1>
${card.nickname ? `<p class="subtitle">${escapeHtml(card.nickname)}</p>` : ''}
${card.quote ? `<p style="font-style:italic;margin-bottom:16px">&ldquo;${escapeHtml(card.quote)}&rdquo;</p>` : ''}
</div>
</div>
${moodboardHtml}${boardHtml}${playlistHtml}${statsHtml}
${overlayHtml}
<footer>
<p><a href="https://puffinpost.app">Made with Puffin Post</a></p>
<details style="margin-top:12px"><summary style="cursor:pointer">Report this page</summary>
<form method="POST" action="/c/${escapeHtml(slug)}/report" style="margin-top:8px">
<textarea name="reason" maxlength="1000" required placeholder="Why are you reporting this page?" style="width:100%;height:80px;background:#2a2230;color:#f0e8f0;border:1px solid #444;border-radius:4px;padding:8px;font-family:inherit"></textarea>
<button type="submit" style="margin-top:4px;padding:6px 16px;background:#7c5cbf;color:#fff;border:none;border-radius:4px;cursor:pointer">Report</button>
</form>
</details>
</footer>
</div>
<script src="/share.js" defer></script>
</body>
</html>`
}

function renderEmbed(share: ShareRow, char: CharRow, card: CardProfile, stats: CardStats, appOrigin: string): string {
  const name = char.name
  const slug = share.slug
  if (share.style === 'card') {
    const frontSvg = renderToString(createElement(Side, { side: 'front', name, profile: card, stats, portrait: `/c/${slug}/portrait`, moodboard: [], uid: 'ef' }))
    const backSvg = renderToString(createElement(Side, { side: 'back', name, profile: card, stats: share.showStats ? stats : { total: 0, mine: 0, theirs: 0, rps: [] }, portrait: null, moodboard: [], uid: 'eb' }))
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}svg{width:340px;max-height:480px}a{font-size:12px;color:#7c5cbf;margin-top:4px;font-family:sans-serif}[data-flipped="false"] .card-face-front{display:block}[data-flipped="false"] .card-face-back{display:none}[data-flipped="true"] .card-face-front{display:none}[data-flipped="true"] .card-face-back{display:block}button.flip-btn{padding:6px 16px;background:#7c5cbf;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;margin-top:4px;min-height:44px}</style></head><body><div id="embed-card" data-flipped="false"><div class="card-face-front">${frontSvg}</div><div class="card-face-back">${backSvg}</div></div><button type="button" class="flip-btn" data-card-flip="embed-card" aria-pressed="false">Flip</button><a href="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}" target="_blank" rel="noopener">Open on Puffin Post</a><script src="/share.js" defer></script></body></html>`
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1520;color:#f0e8f0;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:16px}img{width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:8px}.stats{display:flex;gap:16px;margin-top:12px;font-size:14px}a{font-size:12px;color:#7c5cbf;margin-top:8px}</style></head><body><img src="/c/${escapeHtml(slug)}/portrait" alt="" onerror="this.style.display='none'"><strong>${escapeHtml(name)}</strong>${share.showStats ? `<div class="stats"><span>${stats.total} threads</span><span>${stats.mine} yours</span><span>${stats.theirs} theirs</span></div>` : ''}<a href="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}" target="_blank" rel="noopener">Open on Puffin Post</a></body></html>`
}

function notFoundPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found &middot; Puffin Post</title><style>body{font-family:Georgia,serif;background:#1a1520;color:#f0e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}div{text-align:center}a{color:#7c5cbf}</style></head><body><div><h1>Page not found</h1><p style="margin-top:12px">This share link may have been removed or rotated.</p><p style="margin-top:8px"><a href="https://puffinpost.app">Puffin Post</a></p></div></body></html>`
}

function thankYouPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report Received &middot; Puffin Post</title><style>body{font-family:Georgia,serif;background:#1a1520;color:#f0e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}div{text-align:center}a{color:#7c5cbf}</style></head><body><div><h1>Thank you</h1><p style="margin-top:12px">Your report has been received. We&#x27;ll review it shortly.</p><p style="margin-top:8px"><a href="https://puffinpost.app">Puffin Post</a></p></div></body></html>`
}

export function publicShareRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/:slug', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data) return c.html(notFoundPage(), 404, { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'public, max-age=60' })
    const { share, char } = data
    const card: CardProfile = char.cardJson ? JSON.parse(char.cardJson) : { theme: 'holo', nickname: '', age: '', birthdate: '', quote: '', song: '', artist: '', favoriteColor: '#b07a9e', facts: [], likes: '', dislikes: '', notes: '', playlistUrl: '', boardUrl: '', tracklist: [], symbol: 'none' }
    const stats = share.showStats ? await getStats(c.env.DB, share.workspaceId, share.characterId) : { total: 0, mine: 0, theirs: 0, rps: [] }
    const moodItems = share.showMoodboard ? (await c.env.DB.prepare('SELECT id,kind,pin_id AS pinId FROM character_moodboard_items WHERE workspace_id=? AND character_id=? ORDER BY position').bind(share.workspaceId, share.characterId).all<{ id: string; kind: string; pinId: string | null }>()).results : []
    const headers: Record<string, string> = { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'public, max-age=60' }
    if (!share.indexable) headers['X-Robots-Tag'] = 'noindex, nofollow'
    return c.html(renderPage(share, char, card, stats, moodItems, c.env.APP_ORIGIN), 200, headers)
  })

  app.get('/:slug/embed', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data) return c.html(notFoundPage(), 404)
    const { share, char } = data
    const card: CardProfile = char.cardJson ? JSON.parse(char.cardJson) : { theme: 'holo', nickname: '', age: '', birthdate: '', quote: '', song: '', artist: '', favoriteColor: '#b07a9e', facts: [], likes: '', dislikes: '', notes: '', playlistUrl: '', boardUrl: '', tracklist: [], symbol: 'none' }
    const stats = share.showStats ? await getStats(c.env.DB, share.workspaceId, share.characterId) : { total: 0, mine: 0, theirs: 0, rps: [] }
    return c.html(renderEmbed(share, char, card, stats, c.env.APP_ORIGIN), 200, { 'Content-Security-Policy': EMBED_CSP, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'public, max-age=60' })
  })

  app.get('/:slug/card.png', async c => {
    const share = await c.env.DB.prepare('SELECT preview_object_key AS previewObjectKey, disabled_by_moderator AS disabled FROM character_shares WHERE slug=?').bind(c.req.param('slug')).first<{ previewObjectKey: string | null; disabled: number }>()
    if (!share || share.disabled || !share.previewObjectKey) throw new HTTPException(404, { message: 'Not found' })
    const object = await c.env.ICONS.get(share.previewObjectKey)
    if (!object) throw new HTTPException(404, { message: 'Not found' })
    return new Response(object.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } })
  })

  app.get('/:slug/portrait', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data || !data.char.iconObjectKey) throw new HTTPException(404, { message: 'Not found' })
    const object = await c.env.ICONS.get(data.char.iconObjectKey)
    if (!object) throw new HTTPException(404, { message: 'Not found' })
    return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } })
  })

  app.get('/:slug/m/:itemId', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data || !data.share.showMoodboard) throw new HTTPException(404, { message: 'Not found' })
    const item = await c.env.DB.prepare('SELECT object_key AS objectKey, content_type AS contentType, kind FROM character_moodboard_items WHERE workspace_id=? AND character_id=? AND id=?').bind(data.share.workspaceId, data.share.characterId, c.req.param('itemId')).first<{ objectKey: string | null; contentType: string | null; kind: string }>()
    if (!item || item.kind !== 'image' || !item.objectKey) throw new HTTPException(404, { message: 'Not found' })
    const object = await c.env.ICONS.get(item.objectKey)
    if (!object) throw new HTTPException(404, { message: 'Not found' })
    return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? item.contentType ?? 'application/octet-stream', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } })
  })

  app.post('/:slug/report', async c => {
    const slug = c.req.param('slug')
    const share = await c.env.DB.prepare('SELECT id FROM character_shares WHERE slug=?').bind(slug).first()
    if (!share) return c.html(notFoundPage(), 404)
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
    const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    const rateOk = await checkRateLimit(c.env.DB, `share_report:${ipHash}`, 5, 3600_000)
    if (!rateOk.allowed) return c.html('<p>Too many reports. Please wait before trying again.</p>', 429)
    const contentType = c.req.header('content-type') ?? ''
    let reason = ''
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody()
      reason = String(form.reason ?? '').slice(0, 1000)
    } else {
      try { const json = await c.req.json<{ reason?: string }>(); reason = String(json.reason ?? '').slice(0, 1000) } catch { /* empty */ }
    }
    await c.env.DB.prepare('INSERT INTO share_reports (id,slug,reason,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), slug, reason, new Date().toISOString()).run()
    const modEmail = c.env.BOOTSTRAP_OWNER_EMAIL ?? moderatorEmail
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: c.env.MAIL_FROM, to: [modEmail], subject: `Puffin Post share report: ${slug}`, text: `Reason: ${reason}\n\nLink: ${c.env.APP_ORIGIN}/c/${slug}` }),
    }).catch(() => undefined)
    return c.html(thankYouPage())
  })

  return app
}

export function shareAdminRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.post('/:slug/disable', async c => {
    const scope = await requireWorkspace(c)
    if (scope.email.toLowerCase() !== moderatorEmail) throw new HTTPException(403, { message: 'Moderator access required' })
    const result = await c.env.DB.prepare('UPDATE character_shares SET disabled_by_moderator=1,updated_at=? WHERE slug=?').bind(new Date().toISOString(), c.req.param('slug')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Share not found' })
    return c.json({ ok: true })
  })

  app.post('/:slug/enable', async c => {
    const scope = await requireWorkspace(c)
    if (scope.email.toLowerCase() !== moderatorEmail) throw new HTTPException(403, { message: 'Moderator access required' })
    const result = await c.env.DB.prepare('UPDATE character_shares SET disabled_by_moderator=0,updated_at=? WHERE slug=?').bind(new Date().toISOString(), c.req.param('slug')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Share not found' })
    return c.json({ ok: true })
  })

  return app
}
