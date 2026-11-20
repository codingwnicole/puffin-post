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
type CharRow = { name: string; iconObjectKey: string | null; portraitObjectKey: string | null; cardJson: string | null }

const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; frame-src https://open.spotify.com https://www.youtube-nocookie.com https://embed.music.apple.com https://assets.pinterest.com https://petracoding.github.io; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const EMBED_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors *; base-uri 'none'"

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

async function loadShare(db: D1Database, slug: string): Promise<{ share: ShareRow; char: CharRow } | null> {
  const share = await db.prepare('SELECT id, workspace_id AS workspaceId, character_id AS characterId, slug, style, show_moodboard AS showMoodboard, show_playlist AS showPlaylist, show_stats AS showStats, indexable, preview_object_key AS previewObjectKey, disabled_by_moderator AS disabledByModerator FROM character_shares WHERE slug=?').bind(slug).first<ShareRow>()
  if (!share || share.disabledByModerator) return null
  const char = await db.prepare('SELECT name, icon_object_key AS iconObjectKey, portrait_object_key AS portraitObjectKey, card_json AS cardJson FROM characters WHERE workspace_id=? AND id=?').bind(share.workspaceId, share.characterId).first<CharRow>()
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
  const t = THEMES[card.theme] ?? THEMES.holo

  const frontSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'front', name, profile: card, stats, portrait: `/c/${slug}/portrait`, moodboard: [], uid: 'f' })) : ''
  const backSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'back', name, profile: card, stats: share.showStats ? stats : { total: 0, mine: 0, theirs: 0, rps: [] }, portrait: null, moodboard: [], uid: 'b' })) : ''

  const songLine = (card.song || '') + (card.artist ? ' — ' + card.artist : '')
  const facts = (card.facts || []).filter(Boolean)
  const tracks = (card.tracklist || []).filter(Boolean).slice(0, 10)

  let moodboardHtml = ''
  if (share.showMoodboard && moodItems.length > 0) {
    const items = moodItems.map(item => {
      if (item.kind === 'pin' && item.pinId) return `<iframe src="https://assets.pinterest.com/ext/embed.html?id=${escapeHtml(item.pinId)}" class="mood-pin" loading="lazy"></iframe>`
      if (item.kind === 'image') return `<img src="/c/${escapeHtml(slug)}/m/${escapeHtml(item.id)}" alt="" class="mood-img" loading="lazy">`
      return ''
    }).filter(Boolean).join('')
    moodboardHtml = `<section class="section"><h2 class="section-title">Moodboard</h2><div class="mood-grid">${items}</div></section>`
  }

  let playlistHtml = ''
  if (share.showPlaylist && card.playlistUrl) {
    const parsed = parsePlaylist(card.playlistUrl)
    if (parsed) {
      const label = parsed.provider === 'spotify' ? 'Spotify' : parsed.provider === 'apple' ? 'Apple Music' : 'YouTube'
      const embedHeight = parsed.provider === 'spotify' ? '352' : parsed.provider === 'apple' ? '450' : '315'
      const previewTracks = tracks.slice(0, 5)
      const trackPreviewHtml = previewTracks.length > 0 ? `<ol class="track-preview">${previewTracks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : ''
      const embedSrc = parsed.provider === 'spotify' ? parsed.embedUrl + (parsed.embedUrl.includes('?') ? '&' : '?') + 'theme=0' : parsed.embedUrl
      playlistHtml = `<section class="section"><h2 class="section-title">Playlist</h2>${trackPreviewHtml}<div class="playlist-embed"><iframe src="${escapeHtml(embedSrc)}" width="100%" height="${embedHeight}" style="border-radius:12px" frameborder="0" allowfullscreen allow="autoplay;clipboard-write;encrypted-media;fullscreen;picture-in-picture" loading="lazy"></iframe></div><a href="${escapeHtml(parsed.openUrl)}" target="_blank" rel="noopener" class="link">Open in ${escapeHtml(label)} &rarr;</a></section>`
    }
  }

  let statsHtml = ''
  if (share.showStats) {
    statsHtml = `<section class="section"><h2 class="section-title">Thread Stats</h2><div class="stat-row"><div class="stat-card"><span class="stat-num">${stats.total}</span><span class="stat-label">threads</span></div><div class="stat-card"><span class="stat-num">${stats.mine}</span><span class="stat-label">your turn</span></div><div class="stat-card"><span class="stat-num">${stats.theirs}</span><span class="stat-label">their turn</span></div></div>${stats.rps.length ? `<p class="rp-list">Writes in ${escapeHtml(stats.rps.join(' &middot; '))}</p>` : ''}</section>`
  }

  const boardPath = card.boardUrl ? card.boardUrl.replace(/^https?:\/\/(www\.)?pinterest\.[a-z.]+\//, '').replace(/\/$/, '') : ''
  const boardLabel = boardPath ? boardPath.split('/').pop()?.replace(/-/g, ' ') || 'Pinterest board' : ''
  const boardEmbedSrc = boardPath ? `https://petracoding.github.io/pinterest/board.html?link=${encodeURIComponent(boardPath + '/')}&hideHeader=0&hideFooter=1&transparent=1` : ''
  const boardHtml = share.showMoodboard && card.boardUrl ? `<section class="section"><h2 class="section-title">Pinterest Board</h2>${boardEmbedSrc ? `<iframe src="${escapeHtml(boardEmbedSrc)}" class="board-embed" loading="lazy"></iframe>` : ''}<a href="${escapeHtml(card.boardUrl)}" target="_blank" rel="noopener" class="board-link"><span class="board-icon">&#x1F4CC;</span><span class="board-label-text"><strong>${escapeHtml(boardLabel)}</strong><small>View on Pinterest &rarr;</small></span></a></section>` : ''

  const detailsHtml = (card.likes || card.dislikes || card.notes) ? `<section class="section"><h2 class="section-title">About</h2><div class="detail-grid">${card.likes ? `<div class="detail-item"><span class="detail-label">Likes</span><span>${escapeHtml(card.likes)}</span></div>` : ''}${card.dislikes ? `<div class="detail-item"><span class="detail-label">Dislikes</span><span>${escapeHtml(card.dislikes)}</span></div>` : ''}${card.notes ? `<div class="detail-item detail-wide"><span class="detail-label">Notes</span><span>${escapeHtml(card.notes)}</span></div>` : ''}</div></section>` : ''

  const factsHtml = facts.length > 0 ? `<section class="section"><h2 class="section-title">Fun Facts</h2><ul class="fact-list">${facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></section>` : ''

  const tracklistHtml = tracks.length > 0 ? `<section class="section"><h2 class="section-title">Tracklist</h2><ol class="track-list">${tracks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol></section>` : ''

  const overlayHtml = share.style === 'card' ? `<div id="card-overlay" class="overlay"><div class="overlay-inner"><div id="card-flip-area" data-flipped="false"><div class="card-face-front">${frontSvg}</div><div class="card-face-back">${backSvg}</div></div><div class="overlay-btns"><button type="button" data-card-flip="card-flip-area" aria-pressed="false" class="btn-accent">Flip</button><button type="button" data-close-overlay class="btn-muted">Close</button></div></div></div>` : ''

  const cardPreviewHtml = share.style === 'card'
    ? `<button type="button" data-open-overlay class="card-preview-btn" title="View card"><div id="card-preview">${frontSvg}</div><span class="preview-hint">Click to view</span></button>`
    : `<div class="portrait-circle"><img src="/c/${escapeHtml(slug)}/portrait" alt="" onerror="this.style.display='none'"></div>`

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
:root{--bg0:${t.bg[0]};--bg1:${t.bg[1]};--bg2:${t.bg[2]};--ink:${t.ink};--sub:${t.sub};--accent:${t.accent};--stroke:${t.stroke};--panel0:${t.panel[0]};--panel1:${t.panel[1]};--foil0:${t.foil[0]};--foil1:${t.foil[1]};--foil2:${t.foil[2] || t.foil[0]};--corner:${t.corner}px;--font:${t.font};--sans:${t.sans}}
*{box-sizing:border-box;margin:0}
body{font-family:var(--sans);font-size:16px;line-height:1.6;color:var(--ink);min-height:100vh;background:var(--bg1);background-image:radial-gradient(circle at 20% 10%,var(--bg0) 0%,transparent 50%),radial-gradient(circle at 80% 90%,var(--bg2) 0%,transparent 50%)}
a{color:var(--accent)}
.page{max-width:860px;margin:0 auto;padding:2rem 1.25rem 3rem}

/* Hero: card + name + quote */
.hero{display:grid;grid-template-columns:240px minmax(0,1fr);gap:2.5rem;align-items:start;padding-bottom:2rem;border-bottom:1px solid var(--stroke)}
.card-preview-btn{background:none;border:none;padding:0;cursor:pointer;position:relative;display:block;width:100%}
#card-preview svg{width:100%;height:auto;filter:drop-shadow(0 8px 24px rgba(0,0,0,.35))}
.preview-hint{display:block;margin-top:.5rem;text-align:center;font:600 .8rem var(--sans);color:var(--sub);letter-spacing:.06em;text-transform:uppercase;opacity:.7}
.portrait-circle{width:120px;height:120px;border-radius:50%;overflow:hidden;border:3px solid var(--stroke);margin:0 auto}
.portrait-circle img{width:100%;height:100%;object-fit:cover}
.hero-text{display:grid;gap:.75rem;align-content:start;padding-top:.5rem}
.hero-name{font:600 clamp(2rem,5vw,3.2rem)/1.1 var(--font);letter-spacing:-.03em;color:var(--ink)}
.hero-nickname{font:italic 500 1.1rem/1.3 var(--font);color:var(--sub)}
.hero-quote{font:italic 1.05rem/1.5 var(--font);color:var(--ink);opacity:.85;padding:.75rem 1rem;border-left:3px solid var(--accent);background:linear-gradient(90deg,color-mix(in srgb,var(--panel0) 40%,transparent),transparent)}
.hero-meta{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;font-size:.9rem;color:var(--sub)}
.hero-meta strong{color:var(--ink)}
.hero-song{display:flex;align-items:center;gap:.5rem;font-size:.9rem;color:var(--sub);margin-top:.25rem}
.hero-song::before{content:'\\266B';font-size:1.1rem;color:var(--accent)}
.hero-color{display:inline-flex;align-items:center;gap:.4rem}
.hero-color-swatch{width:1rem;height:1rem;border-radius:50%;border:1px solid var(--stroke);vertical-align:middle}

/* Sections */
.section{margin-top:2rem;padding:1.5rem;border:1px solid color-mix(in srgb,var(--stroke) 50%,transparent);border-radius:calc(var(--corner) + 6px);background:linear-gradient(135deg,color-mix(in srgb,var(--panel0) 60%,transparent),color-mix(in srgb,var(--panel1) 40%,transparent))}
.section-title{font:600 .75rem/1 var(--sans);color:var(--accent);letter-spacing:.14em;text-transform:uppercase;margin-bottom:1rem}

/* Stats */
.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}
.stat-card{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:1rem;border-radius:var(--corner);background:color-mix(in srgb,var(--panel0) 80%,transparent);border:1px solid color-mix(in srgb,var(--stroke) 30%,transparent)}
.stat-num{font:700 1.8rem var(--font);color:var(--ink)}
.stat-label{font:600 .75rem var(--sans);color:var(--sub);text-transform:uppercase;letter-spacing:.08em}
.rp-list{margin-top:.75rem;font-size:.9rem;color:var(--sub)}

/* Moodboard */
.mood-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem}
.mood-img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--corner);border:1px solid color-mix(in srgb,var(--stroke) 30%,transparent)}
.mood-pin{width:100%;height:326px;border:none;border-radius:var(--corner)}

/* Facts */
.fact-list{list-style:none;padding:0;display:grid;gap:.5rem}
.fact-list li{padding:.6rem 1rem;border-radius:var(--corner);background:color-mix(in srgb,var(--panel0) 80%,transparent);border:1px solid color-mix(in srgb,var(--stroke) 20%,transparent);font-size:.95rem}
.fact-list li::before{content:'\\2726 ';color:var(--accent);margin-right:.3rem}

/* Details */
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.detail-item{display:flex;flex-direction:column;gap:.2rem;font-size:.95rem}
.detail-wide{grid-column:1/-1}
.detail-label{font:600 .7rem var(--sans);color:var(--accent);letter-spacing:.1em;text-transform:uppercase}

/* Tracklist */
.track-list{padding-left:1.5rem;display:grid;gap:.35rem}
.track-list li{font-size:.95rem;color:var(--ink)}
.track-list li::marker{color:var(--accent)}
.track-preview{list-style:none;padding:0;display:grid;gap:.35rem;margin-bottom:1rem}
.track-preview li{display:flex;align-items:center;gap:.6rem;padding:.45rem .75rem;border-radius:var(--corner);background:color-mix(in srgb,var(--panel0) 70%,transparent);font-size:.9rem;color:var(--ink)}
.track-preview li::before{counter-increment:tp;content:counter(tp);font:700 .75rem var(--sans);color:var(--accent);min-width:1.2rem;text-align:right}
.track-preview{counter-reset:tp}

/* Board link */
.board-link{display:flex;align-items:center;gap:.5rem;padding:.75rem 1rem;border-radius:var(--corner);background:color-mix(in srgb,var(--panel0) 60%,transparent);border:1px solid color-mix(in srgb,var(--stroke) 30%,transparent);color:var(--ink);text-decoration:none;font-size:.9rem;word-break:break-all}
.board-embed{width:100%;height:420px;border:none;border-radius:var(--corner);margin-bottom:.75rem;background:transparent}
.board-link:hover{border-color:var(--accent)}
.board-icon{font-size:1.4rem}
.board-label-text{display:flex;flex-direction:column;gap:.15rem}
.board-label-text strong{font:600 1rem var(--font);color:var(--ink);text-transform:capitalize}
.board-label-text small{font-size:.78rem;color:var(--sub);word-break:break-all}

/* Buttons */
.btn-accent{padding:.6rem 1.4rem;background:var(--accent);color:var(--panel1);border:none;border-radius:calc(var(--corner) + 2px);cursor:pointer;font:700 .9rem var(--sans);min-height:44px}
.btn-accent:hover{filter:brightness(1.1)}
.btn-muted{padding:.6rem 1.4rem;background:var(--panel0);color:var(--ink);border:1px solid var(--stroke);border-radius:calc(var(--corner) + 2px);cursor:pointer;font:700 .9rem var(--sans);min-height:44px}
.link{color:var(--accent);display:inline-block;font-size:.9rem;margin-top:.5rem}
.playlist-embed{border-radius:12px;overflow:hidden}

/* Overlay */
.overlay{display:none;position:fixed;inset:0;z-index:900;place-items:center;padding:1rem;background:rgba(0,0,0,.7);backdrop-filter:blur(6px)}
.overlay-inner{max-width:360px;width:100%}
.overlay-btns{display:flex;gap:.75rem;justify-content:center;margin-top:.75rem}
[data-flipped="false"] .card-face-front{display:block}[data-flipped="false"] .card-face-back{display:none}
[data-flipped="true"] .card-face-front{display:none}[data-flipped="true"] .card-face-back{display:block}
.card-face-front svg,.card-face-back svg{width:100%;height:auto}

/* Footer */
.footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid color-mix(in srgb,var(--stroke) 40%,transparent);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
.footer-brand{display:flex;align-items:center;gap:.5rem;font:600 .95rem Georgia,serif;color:var(--sub);text-decoration:none}
.footer-brand:hover{color:var(--ink)}
.footer-mark{display:grid;place-items:center;width:1.6rem;height:1.6rem;border-radius:50%;background:var(--accent);color:var(--panel1);font:italic 700 1rem Georgia,serif}
.footer-right{font-size:.82rem;color:var(--sub)}
.footer-right a{color:var(--accent);font-weight:600}
.report-toggle{background:none;border:none;color:var(--sub);font-size:.78rem;cursor:pointer;padding:.2rem}
.report-toggle:hover{color:var(--ink)}
.report-form{margin-top:.5rem}
.report-form textarea{width:100%;height:70px;background:color-mix(in srgb,var(--panel0) 80%,transparent);color:var(--ink);border:1px solid var(--stroke);border-radius:var(--corner);padding:.5rem;font:inherit;resize:vertical}

@media(max-width:600px){
  .hero{grid-template-columns:1fr;gap:1.25rem;text-align:center}
  #card-preview{max-width:220px;margin:0 auto}
  .hero-quote{text-align:left}
  .hero-meta{justify-content:center}
  .detail-grid{grid-template-columns:1fr}
  .stat-row{grid-template-columns:repeat(3,1fr);gap:.5rem}
  .stat-num{font-size:1.4rem}
  .mood-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
  .footer{flex-direction:column;text-align:center}
}
</style>
</head>
<body>
<div class="page">
<div class="hero">
${cardPreviewHtml}
<div class="hero-text">
<h1 class="hero-name">${escapeHtml(name)}</h1>
${card.nickname && card.nickname !== name ? `<p class="hero-nickname">${escapeHtml(card.nickname)}</p>` : ''}
${card.quote ? `<blockquote class="hero-quote">&ldquo;${escapeHtml(card.quote)}&rdquo;</blockquote>` : ''}
<div class="hero-meta">
${card.age ? `<span><strong>${escapeHtml(card.age)}</strong> years old</span>` : ''}
${card.birthdate ? `<span>Born <strong>${escapeHtml(card.birthdate)}</strong></span>` : ''}
${card.favoriteColor && card.favoriteColor !== '#b07a9e' ? `<span class="hero-color"><span class="hero-color-swatch" style="background:${escapeHtml(card.favoriteColor)}"></span>${escapeHtml(card.favoriteColor)}</span>` : ''}
</div>
${songLine ? `<p class="hero-song">${escapeHtml(songLine)}</p>` : ''}
</div>
</div>
${factsHtml}${detailsHtml}${moodboardHtml}${boardHtml}${playlistHtml}${tracklistHtml}${statsHtml}
${overlayHtml}
<footer class="footer">
<a href="https://puffinpost.app" class="footer-brand"><span class="footer-mark">P</span>Puffin Post</a>
<div class="footer-right"><a href="https://puffinpost.app">Make your own</a><span> &middot; </span><details style="display:inline"><summary class="report-toggle">Report</summary><form method="POST" action="/c/${escapeHtml(slug)}/report" class="report-form"><textarea name="reason" maxlength="1000" required placeholder="Why are you reporting this page?"></textarea><button type="submit" class="btn-accent" style="margin-top:.35rem;padding:.4rem 1rem;font-size:.82rem">Send report</button></form></details></div>
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
    const portraitKey = data?.char.portraitObjectKey ?? data?.char.iconObjectKey
    if (!data || !portraitKey) throw new HTTPException(404, { message: 'Not found' })
    const object = await c.env.ICONS.get(portraitKey)
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
