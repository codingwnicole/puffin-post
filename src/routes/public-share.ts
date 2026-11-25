import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { sendEmail } from '../mail'
import { BRIDGE_TOKENS, bridgePage } from '../shared/bridge-page'
import { requireWorkspace } from '../auth/sessions'
import { isModerator } from '../auth/moderator'
import { checkRateLimit, opaqueRateLimitKey } from '../auth/rate-limits'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { Side, emptyCard, normalizeCard, type CardProfile, type CardStats, THEMES } from '../web/components/TradingCard'
import { parsePlaylist } from '../shared/embeds'
import { emptyCharacterProfile, parsePublicCharacterProfile, type CharacterProfile, type ProfileSection } from '../shared/character-profile'

type ShareRow = { id: string; workspaceId: string; characterId: string; slug: string; style: 'card' | 'stats'; showMoodboard: number; showPlaylist: number; showStats: number; indexable: number; previewObjectKey: string | null; disabledByModerator: number; publicProfileJson: string; publicProfilePublishedAt: string | null }
type CharRow = { name: string; iconObjectKey: string | null; portraitObjectKey: string | null; cardJson: string | null }

const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://open.spotify.com https://www.youtube-nocookie.com https://embed.music.apple.com https://assets.pinterest.com https://petracoding.github.io; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const EMBED_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors *; base-uri 'none'"

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function savedCard(cardJson: string | null): CardProfile {
  try { return normalizeCard(cardJson ? JSON.parse(cardJson) as Partial<CardProfile> : null) } catch { return emptyCard() }
}

async function loadShare(db: D1Database, slug: string): Promise<{ share: ShareRow; char: CharRow } | null> {
  const share = await db.prepare('SELECT id, workspace_id AS workspaceId, character_id AS characterId, slug, style, show_moodboard AS showMoodboard, show_playlist AS showPlaylist, show_stats AS showStats, indexable, preview_object_key AS previewObjectKey, disabled_by_moderator AS disabledByModerator, public_profile_json AS publicProfileJson, public_profile_published_at AS publicProfilePublishedAt FROM character_shares WHERE slug=?').bind(slug).first<ShareRow>()
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

export interface PublicProfileExtras {
  profile?: CharacterProfile
  quizzes?: Array<{ quizTitle: string | null; resultTitle: string; resultText: string; completedAt: string; sourceUrl: string | null }>
  quicklinks?: Array<{ label: string; url: string }>
}

export function renderPage(share: ShareRow, char: CharRow, card: CardProfile, stats: CardStats, moodItems: { id: string; kind: string; pinId: string | null }[], appOrigin: string, extras: PublicProfileExtras = {}): string {
  const name = card.nickname.trim() || char.name
  const slug = share.slug
  const description = card.nickname || card.quote || 'A character card on RP Thread Buddy'
  const hasPreview = !!share.previewObjectKey
  const noindex = !share.indexable
  const t = THEMES[card.theme] ?? THEMES.holo

  const frontSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'front', name, profile: card, stats, portrait: char.portraitObjectKey || char.iconObjectKey ? `/c/${slug}/portrait` : null, moodboard: [], uid: 'f' })) : ''
  const backSvg = share.style === 'card' ? renderToString(createElement(Side, { side: 'back', name, profile: card, stats: share.showStats ? stats : { total: 0, mine: 0, theirs: 0, rps: [] }, portrait: null, moodboard: [], uid: 'b' })) : ''

  const songTitle = card.song || card.artist || ''
  const songArtist = card.song && card.artist ? card.artist : ''
  const facts = (card.facts || []).filter(Boolean)
  const tracks = (card.tracklist || []).filter(Boolean).slice(0, 10)

  let moodboardHtml = ''
  if (share.showMoodboard && moodItems.length > 0) {
    const items = moodItems.map(item => {
      if (item.kind === 'pin' && item.pinId) return `<iframe src="https://assets.pinterest.com/ext/embed.html?id=${escapeHtml(item.pinId)}" class="mood-pin" title="Pinterest moodboard pin" loading="lazy"></iframe>`
      if (item.kind === 'image') return `<img src="/c/${escapeHtml(slug)}/m/${escapeHtml(item.id)}" alt="" class="mood-img" loading="lazy">`
      return ''
    }).filter(Boolean).join('')
    moodboardHtml = `<section class="section moodboard-section"><h2 class="section-title">Moodboard</h2><div class="mood-grid">${items}</div></section>`
  }

  let playlistHtml = ''
  let hasPlaylistEmbed = false
  if (share.showPlaylist && card.playlistUrl) {
    const parsed = parsePlaylist(card.playlistUrl)
    if (parsed) {
      hasPlaylistEmbed = true
      const label = parsed.provider === 'spotify' ? 'Spotify' : parsed.provider === 'apple' ? 'Apple Music' : 'YouTube'
      const embedHeight = parsed.provider === 'spotify' ? '580' : parsed.provider === 'apple' ? '450' : '315'
      const previewTracks = tracks.slice(0, 5)
      const trackPreviewHtml = previewTracks.length > 0 ? `<ol class="track-preview">${previewTracks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : ''
      const embedSrc = parsed.provider === 'spotify' ? parsed.embedUrl + (parsed.embedUrl.includes('?') ? '&' : '?') + 'theme=0' : parsed.embedUrl
      playlistHtml = `<section id="playlist" class="section playlist-section"><h2 class="section-title">Playlist</h2>${parsed.provider === 'spotify' ? `<div class="playlist-embed"><iframe src="${escapeHtml(embedSrc)}" title="Spotify playlist" height="${embedHeight}" allow="encrypted-media; fullscreen; picture-in-picture" loading="eager"></iframe></div>` : `${trackPreviewHtml}<div class="playlist-embed" data-playlist-container data-embed-src="${escapeHtml(embedSrc)}" data-embed-height="${embedHeight}"><button type="button" class="btn-accent" data-playlist-load>Load the ${label} player</button><p>Loads ${label}'s player, which follows ${label}'s privacy policy.</p></div>`}</section>`
    }
  }

  let statsHtml = ''
  if (share.showStats) {
    statsHtml = `<section class="section stats-section"><h2 class="section-title">Thread Stats</h2><div class="stat-row"><div class="stat-card"><span class="stat-num">${stats.total}</span><span class="stat-label">threads</span></div><div class="stat-card"><span class="stat-num">${stats.mine}</span><span class="stat-label">my turn</span></div><div class="stat-card"><span class="stat-num">${stats.theirs}</span><span class="stat-label">their turn</span></div></div>${stats.rps.length ? `<div class="rp-list"><span class="rp-divider" aria-hidden="true">✦</span><div class="rp-byline-worlds">${stats.rps.map(rp => `<span>${escapeHtml(rp)}</span>`).join('')}</div></div>` : ''}</section>`
  }

  const boardPath = card.boardUrl ? card.boardUrl.replace(/^https?:\/\/(www\.)?pinterest\.[a-z.]+\//, '').replace(/\/$/, '') : ''
  const boardEmbedSrc = boardPath ? `https://petracoding.github.io/pinterest/board.html?link=${encodeURIComponent(boardPath + '/')}&hideHeader=0&hideFooter=1&transparent=1` : ''
  const boardHtml = share.showMoodboard && card.boardUrl && boardEmbedSrc ? `<section class="section moodboard-section"><h2 class="section-title">Moodboard</h2><iframe src="${escapeHtml(boardEmbedSrc)}" class="board-embed" title="Pinterest moodboard" loading="lazy"></iframe></section>` : ''

  const detailsHtml = (card.likes || card.dislikes || card.notes) ? `<section class="section about-section"><h2 class="section-title">About</h2><div class="detail-grid">${card.likes ? `<div class="detail-item"><span class="detail-label">Likes</span><span>${escapeHtml(card.likes)}</span></div>` : ''}${card.dislikes ? `<div class="detail-item"><span class="detail-label">Dislikes</span><span>${escapeHtml(card.dislikes)}</span></div>` : ''}${card.notes ? `<div class="detail-item detail-wide"><span class="detail-label">Notes</span><span>${escapeHtml(card.notes)}</span></div>` : ''}</div></section>` : ''

  const factsHtml = facts.length > 0 ? `<section class="section facts-section"><h2 class="section-title">Fun Facts</h2><ul class="fact-list">${facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></section>` : ''

  const tracklistHtml = tracks.length > 0 ? `<section class="section tracklist-section"><h2 class="section-title">Tracklist</h2><ol class="track-list">${tracks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol></section>` : ''

  const profile = extras.profile ?? emptyCharacterProfile()
  const textSection = (enabled: boolean, title: string, value: string) => enabled && value.trim() ? `<section class="section profile-module"><h2 class="section-title">${title}</h2><p class="profile-prose">${escapeHtml(value).replace(/\n/gu, '<br>')}</p></section>` : ''
  const listSection = (title: string, values: string[]) => values.length ? `<section class="section profile-module"><h2 class="section-title">${title}</h2><ul class="profile-list">${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>` : ''
  const basics = profile.basics.enabled ? [
    ['Pronouns', profile.basics.pronouns], ['Age', profile.basics.age], ['Birthday', profile.basics.birthday],
    ['Occupation', profile.basics.occupation], ['Location', profile.basics.location],
  ].filter((pair): pair is [string, string] => Boolean(pair[1].trim())) : []
  const basicsHtml = basics.length ? `<section class="section profile-module"><h2 class="section-title">Character details</h2><div class="detail-grid">${basics.map(([label, value]) => `<div class="detail-item"><span class="detail-label">${label}</span><span>${escapeHtml(value)}</span></div>`).join('')}</div></section>` : ''
  const personalityHtml = profile.personality.enabled
    ? textSection(true, 'Personality', profile.personality.summary) + listSection('Traits', profile.personality.traits)
    : ''
  const quotes = profile.quotes.enabled ? profile.quotes.entries.filter(Boolean) : []
  const quotesHtml = quotes.length ? `<section class="section profile-module"><h2 class="section-title">Character quotes</h2>${quotes.map(quote => `<blockquote class="profile-quote">&ldquo;${escapeHtml(quote)}&rdquo;</blockquote>`).join('')}</section>` : ''
  const social = profile.social
  const socialColor = /^#[0-9a-f]{6}$/iu.test(social.accentColor) ? social.accentColor : t.accent
  const socialAvatar = char.portraitObjectKey || char.iconObjectKey ? `<img src="/c/${escapeHtml(slug)}/portrait" alt="" style="float:right;width:56px;height:56px;margin:0 0 10px 12px;border-radius:50%;object-fit:cover;border:1px solid var(--line)">` : ''
  const socialHtml = social.enabled && (social.displayName || social.username || social.bio || social.posts.length)
    ? `<section class="section profile-module fictional-profile" style="--profile-accent:${socialColor}">${socialAvatar}<p class="eyebrow">Fictional ${social.format === 'photo-journal' ? 'photo journal' : social.format === 'media-shelf' ? 'media shelf' : 'short-post profile'}</p><h2>${escapeHtml(social.displayName || name)}</h2>${social.username ? `<p class="profile-handle">@${escapeHtml(social.username)}</p>` : ''}${social.bio ? `<p class="profile-prose">${escapeHtml(social.bio)}</p>` : ''}${social.followers !== null || social.following !== null ? `<p class="profile-counts">${social.followers === null ? '' : `${social.followers.toLocaleString()} followers`}${social.followers !== null && social.following !== null ? ' · ' : ''}${social.following === null ? '' : `${social.following.toLocaleString()} following`}</p>` : ''}${social.posts.length ? `<ul class="profile-feed">${social.posts.map(post => `<li>${escapeHtml(post)}</li>`).join('')}</ul>` : ''}<p class="field-help">A fictional character profile. It is not connected to a real social account.</p></section>`
    : ''
  const quizHtml = profile.quizzes.enabled && extras.quizzes?.length
    ? `<section class="section profile-module"><h2 class="section-title">Quizzes &amp; results</h2><div class="profile-quiz-list">${extras.quizzes.map(result => `<article><h3>${escapeHtml(result.resultTitle)}</h3>${result.quizTitle ? `<p class="detail-label">${escapeHtml(result.quizTitle)}</p>` : ''}${result.resultText ? `<p class="profile-prose">${escapeHtml(result.resultText).replace(/\n/gu, '<br>')}</p>` : ''}<time datetime="${escapeHtml(result.completedAt)}">${escapeHtml(new Date(result.completedAt).toLocaleDateString('en', { dateStyle: 'medium', timeZone: 'UTC' }))}</time>${result.sourceUrl ? `<p><a href="${escapeHtml(result.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open quiz source</a></p>` : ''}</article>`).join('')}</div></section>`
    : ''
  const safeLinks = profile.quicklinks.enabled ? (extras.quicklinks ?? []).filter(link => { try { const url = new URL(link.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false } }) : []
  const quicklinksHtml = safeLinks.length ? `<section class="section profile-module"><h2 class="section-title">Quick links</h2><ul class="profile-list">${safeLinks.map(link => `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a></li>`).join('')}</ul></section>` : ''
  const profileSections: Record<ProfileSection, string> = {
    introduction: textSection(profile.introduction.enabled, 'Introduction', profile.introduction.text),
    biography: textSection(profile.biography.enabled, 'Biography', profile.biography.text), basics: basicsHtml, personality: personalityHtml,
    relationships: profile.relationships.enabled ? listSection('Relationships', profile.relationships.entries) : '',
    quotes: quotesHtml, songs: profile.songs.enabled ? listSection('Theme songs', profile.songs.entries) : '',
    trivia: profile.trivia.enabled ? listSection('Trivia &amp; headcanons', profile.trivia.entries) : '',
    social: socialHtml, quizzes: quizHtml, quicklinks: quicklinksHtml,
  }
  const profileHtml = profile.sectionOrder.map(section => profileSections[section]).filter(Boolean).join('')

  const safeFavorite = /^#[0-9a-f]{6}$/i.test(card.favoriteColor) ? card.favoriteColor : t.accent
  const initials = name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
  const portraitHtml = char.portraitObjectKey || char.iconObjectKey
    ? `<img class="hero-portrait" src="/c/${escapeHtml(slug)}/portrait" alt="">`
    : `<div class="hero-initials" aria-hidden="true">${escapeHtml(initials)}</div>`
  const cardPng = `/c/${escapeHtml(slug)}/card.png`
  const publicCardHtml = share.style === 'card' ? `<div class="public-card" id="public-card" data-flipped="false"><div class="public-card-inner"><a class="public-card-face public-card-front" href="${cardPng}" data-png-preview target="_blank" rel="noopener" aria-label="Open ${escapeHtml(name)}'s card PNG">${frontSvg}</a><a class="public-card-face public-card-back" href="${cardPng}" data-png-preview target="_blank" rel="noopener" aria-label="Open ${escapeHtml(name)}'s card PNG">${backSvg}</a></div></div><p data-png-status role="status" hidden></p><div class="card-controls"><button type="button" class="btn-muted" data-card-flip="public-card" aria-pressed="false">Flip card</button><a href="${cardPng}" data-png-preview target="_blank" rel="noopener">Open PNG preview</a></div>` : ''
  const heroMediaHtml = share.style === 'card'
    ? `<div class="hero-media"><span class="favorite-halo" aria-hidden="true"></span><div class="hero-card" data-card-tilt>${publicCardHtml}</div></div>`
    : `<div class="hero-media hero-media-stats">${portraitHtml}</div>`
  const heroSongHtml = songTitle ? `<div class="hero-song-card">
  <span class="hero-song-symbol" aria-hidden="true">♫</span>
  <div class="hero-song-copy"><span class="hero-song-label">Theme song</span><strong class="hero-song-title">${escapeHtml(songTitle)}</strong>${songArtist ? `<span class="hero-song-artist">${escapeHtml(songArtist)}</span>` : ''}</div>
  <span class="hero-song-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
  ${hasPlaylistEmbed ? '<a class="hero-song-link" href="#playlist">Jump to playlist <span aria-hidden="true">↓</span></a>' : ''}
</div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="canonical" href="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}">
<title>${escapeHtml(name)} &middot; RP Thread Buddy</title>
<meta property="og:site_name" content="RP Thread Buddy">
<meta property="og:title" content="${escapeHtml(name)}">
<meta property="og:description" content="${escapeHtml(description)}">
${hasPreview ? `<meta property="og:image" content="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}/card.png">` : ''}
<meta property="og:url" content="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}">
<meta name="twitter:card" content="summary_large_image">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<style>
:root{color-scheme:only light;--paper:${t.bg[1]};--sheet:${t.panel[0]};--sheet-2:${t.panel[1]};--ink:${t.ink};--ink-2:${t.sub};--subtle:${t.sub};--line:${t.stroke};--accent:${t.accent};--favorite:${safeFavorite};--e1:0 1px 2px rgb(45 41 37/.06),0 3px 10px rgb(45 41 37/.05);--e2:0 2px 4px rgb(45 41 37/.05),0 12px 26px -10px rgb(45 41 37/.24);--e3:0 4px 8px rgb(45 41 37/.06),0 30px 60px -22px rgb(45 41 37/.38);--font:${t.font};--sans:${t.sans};--corner:${t.corner}px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--sans);font-size:16px;line-height:1.6;color:var(--ink);min-height:100vh;background:radial-gradient(900px 520px at 8% -8%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 65%) no-repeat,var(--paper)}a{color:var(--accent)}button{font:inherit}.page{width:min(1180px,100%);margin:0 auto;padding:28px clamp(16px,4vw,44px) 40px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.hero{display:grid;grid-template-columns:minmax(250px,340px) minmax(0,1fr);gap:clamp(28px,5vw,68px);align-items:center;padding:14px 0 34px;border-bottom:1px solid var(--line);overflow:visible}.hero-media{min-width:0;position:relative;display:grid;place-items:center;isolation:isolate}.favorite-halo{position:absolute;z-index:-1;width:100%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--favorite) 25%,transparent),transparent 68%);filter:blur(10px)}.hero-card{width:min(330px,100%);display:grid;justify-items:center;perspective:1400px;transform:rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));filter:drop-shadow(var(--shadow-x,0px) var(--shadow-y,22px) var(--shadow-blur,28px) rgb(29 26 22/.28));transition:transform 220ms ease,filter 220ms ease;touch-action:pan-y}.public-card{width:100%;aspect-ratio:640/860;position:relative;perspective:1400px}.public-card-inner{position:absolute;inset:0;transform-style:preserve-3d;transition:transform 600ms cubic-bezier(.22,.68,.18,1)}.public-card[data-flipped="true"] .public-card-inner{transform:rotateY(180deg)}.public-card-face{position:absolute;inset:0;display:block;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:4.5%/3.2%;overflow:hidden;text-decoration:none}.public-card-back{transform:rotateY(180deg)}.public-card-face svg{display:block;width:100%;height:100%}.public-card-face::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.16;background:radial-gradient(circle at var(--mx,50%) var(--my,30%),rgb(255 255 255/.52),transparent 48%),linear-gradient(115deg,transparent 25%,color-mix(in srgb,var(--favorite) 35%,transparent) 48%,transparent 70%);mix-blend-mode:soft-light}.card-controls{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px}.card-controls a{padding:8px 10px;font-size:13px}.hero-media-stats{align-self:start}.hero-portrait,.hero-initials{width:min(240px,75vw);aspect-ratio:1;border-radius:22px;object-fit:cover;border:1px solid var(--line);box-shadow:var(--e2)}.hero-initials{display:grid;place-items:center;background:var(--sheet-2);color:var(--accent);font:400 64px/1 var(--font)}
.hero-text{display:grid;gap:12px;align-content:center;min-width:0;animation:rise 500ms ease both}.hero-kicker{font:650 11px/1.3 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--subtle)}.hero-name{font:400 clamp(34px,5vw,58px)/1.05 var(--font);letter-spacing:-.025em;color:var(--ink);overflow-wrap:anywhere}.hero-nickname{font:italic 19px/1.35 var(--font);color:var(--ink-2)}.hero-quote{font:italic 400 clamp(18px,2.2vw,24px)/1.5 var(--font);color:var(--ink);padding:12px 16px;border-left:3px solid var(--favorite);background:linear-gradient(90deg,color-mix(in srgb,var(--sheet-2) 80%,transparent),transparent);max-width:60ch}.hero-meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--ink-2);font-size:14px}.hero-meta strong{color:var(--ink)}.hero-song{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--ink-2)}.hero-song::before{content:"♫";font-size:18px;color:var(--favorite)}.hero-color{display:inline-flex;align-items:center;gap:7px}.hero-color-swatch{width:16px;height:16px;border-radius:50%;border:1px solid var(--line);vertical-align:middle}
.content-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px;margin-top:24px}.section{grid-column:span 6;min-width:0;margin:0;padding:clamp(16px,2vw,24px);border:1px solid var(--line);border-radius:18px;background:var(--sheet);box-shadow:var(--e1);animation:rise 420ms ease both}.section-title{font:600 11px/1.3 var(--sans);color:var(--subtle);letter-spacing:.1em;text-transform:uppercase;margin:0 0 16px}.stats-section{grid-column:span 12}.moodboard-section{grid-column:span 7}.playlist-section{grid-column:span 5}.board-section{grid-column:span 5}.facts-section,.about-section{grid-column:span 6}.tracklist-section{grid-column:span 5}.stat-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stat-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 8px;border-radius:12px;background:var(--sheet-2);border:1px solid var(--line)}.stat-num{font:400 30px/1.1 var(--font);color:var(--ink);font-variant-numeric:tabular-nums}.stat-label{font:650 10px/1.3 var(--sans);color:var(--subtle);text-transform:uppercase;letter-spacing:.08em}.rp-list{margin-top:20px;text-align:center}.rp-divider{display:flex;align-items:center;justify-content:center;gap:12px;color:var(--accent);font-size:11px}.rp-divider::before,.rp-divider::after{content:"";width:72px;height:1px;background:var(--accent);opacity:.55}.rp-byline-worlds{display:flex;justify-content:center;flex-wrap:wrap;gap:8px 20px;margin-top:8px;color:var(--accent);font:italic 22px/1.4 var(--font)}.rp-byline-worlds span+span::before{content:"✦";font-size:10px;font-style:normal;margin-right:20px;vertical-align:middle}
.mood-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}.mood-img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid var(--line)}.mood-pin{width:100%;height:320px;border:0;border-radius:12px}.fact-list{list-style:none;padding:0;display:grid;gap:8px}.fact-list li{padding:10px 12px;border-radius:10px;background:var(--sheet-2);border:1px solid var(--line);font-size:14px}.fact-list li::before{content:"✦ ";color:var(--favorite);margin-right:5px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.detail-item{display:flex;flex-direction:column;gap:4px;font-size:14px}.detail-wide{grid-column:1/-1}.detail-label{font:650 10px/1.3 var(--sans);color:var(--subtle);letter-spacing:.09em;text-transform:uppercase}.track-list{padding-left:24px;display:grid;gap:6px}.track-list li{font-size:14px;color:var(--ink)}.track-list li::marker{color:var(--accent)}.track-preview{list-style:none;padding:0;display:grid;gap:6px;margin:0 0 14px;counter-reset:tp}.track-preview li{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:9px;background:var(--sheet-2);font-size:13px}.track-preview li::before{counter-increment:tp;content:counter(tp);font:650 11px var(--sans);color:var(--subtle);min-width:18px;text-align:right}.moodboard-section:has(.board-embed){display:flex;flex-direction:column}.board-embed{display:block;flex:1;width:100%;min-height:580px;height:100%;border:0;border-radius:12px;background:var(--sheet-2)}
.btn-accent,.btn-muted{display:inline-flex;justify-content:center;align-items:center;min-height:44px;padding:9px 16px;border-radius:10px;cursor:pointer;font:650 14px/1.2 var(--sans);text-decoration:none}.btn-accent{background:var(--accent);color:var(--paper);border:1px solid transparent}.btn-accent:hover{filter:brightness(1.08)}.btn-muted{background:var(--sheet);color:var(--ink);border:1px solid var(--line)}.playlist-embed{display:grid;justify-items:start;gap:10px;min-height:120px;padding:14px;border:1px dashed var(--line);border-radius:12px;background:var(--sheet-2)}.playlist-embed p{margin:0;color:var(--ink-2);font-size:13px}.playlist-embed iframe{width:100%;display:block}.footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}.footer-brand{display:flex;align-items:center;gap:8px;font:600 14px var(--font);color:var(--ink-2);text-decoration:none}.footer-brand:hover{color:var(--ink)}.footer-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--accent);color:var(--paper);font:700 10px var(--sans)}.footer-right{font-size:13px;color:var(--ink-2)}.footer-right a{color:var(--accent);font-weight:600}.report-toggle{background:none;border:0;color:var(--ink-2);font-size:13px;cursor:pointer;padding:6px}.report-form{display:grid;gap:8px;margin-top:8px;min-width:min(320px,85vw)}.report-form[hidden]{display:none}.report-form textarea{width:100%;min-height:88px;background:var(--sheet);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;resize:vertical}
@media(prefers-color-scheme:dark){:root{--e1:0 1px 2px rgb(0 0 0/.3),0 3px 10px rgb(0 0 0/.25);--e2:0 2px 4px rgb(0 0 0/.3),0 12px 26px -10px rgb(0 0 0/.6);--e3:0 4px 8px rgb(0 0 0/.35),0 30px 60px -22px rgb(0 0 0/.75)}}@keyframes rise{from{opacity:0;filter:blur(4px);transform:translateY(8px)}}
@media(max-width:820px){.page{padding-top:18px}.hero{grid-template-columns:1fr;gap:22px;text-align:center}.hero-media{order:0}.hero-text{order:1;justify-items:center}.hero-meta{justify-content:center}.hero-quote{text-align:left}.hero-card{width:min(280px,72vw)}.content-grid{gap:12px}.section,.stats-section,.moodboard-section,.playlist-section,.board-section,.facts-section,.about-section,.tracklist-section{grid-column:span 12}.mood-grid{grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}}
@media(max-width:420px){.stat-row{gap:5px}.stat-card{padding:10px 4px}.stat-num{font-size:25px}.stat-label{font-size:9px}.detail-grid{grid-template-columns:1fr}.detail-wide{grid-column:auto}.footer{flex-direction:column;text-align:center}}
@media(hover:hover) and (pointer:fine){.hero-card:hover{filter:drop-shadow(var(--shadow-x,0px) var(--shadow-y,22px) var(--shadow-blur,28px) rgb(29 26 22/.34))}.card-controls a:hover{text-decoration:underline}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.hero-card,.public-card-inner,.hero-text,.section{transition:none;animation:none;filter:none}.hero-card{transform:none}}
.hero-text{align-self:stretch;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:12px}
.hero-song-card{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:8px 12px;width:min(100%,640px);margin-top:auto;padding:14px 16px;border:1px solid color-mix(in srgb,var(--favorite) 30%,var(--line));border-radius:16px;background:linear-gradient(115deg,color-mix(in srgb,var(--favorite) 12%,var(--sheet)),var(--sheet));box-shadow:var(--e1);text-align:left}
.hero-song-symbol{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:color-mix(in srgb,var(--favorite) 17%,var(--sheet-2));color:var(--favorite);font-size:19px}
.hero-song-copy{display:grid;gap:2px;min-width:0}
.hero-song-label{font:650 10px/1.3 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--subtle)}
.hero-song-title{color:var(--ink);font-weight:700;line-height:1.25;overflow-wrap:anywhere}
.hero-song-artist{color:var(--ink-2);font-size:13px;line-height:1.35;overflow-wrap:anywhere}
.hero-song-wave{grid-column:3;grid-row:1;display:flex;align-items:center;gap:3px;height:32px;padding:0 4px}
.hero-song-wave i{display:block;width:3px;height:8px;border-radius:99px;background:var(--favorite);opacity:.72}
.hero-song-wave i:nth-child(2),.hero-song-wave i:nth-child(8){height:14px}.hero-song-wave i:nth-child(3),.hero-song-wave i:nth-child(7){height:21px}.hero-song-wave i:nth-child(4),.hero-song-wave i:nth-child(6){height:11px}.hero-song-wave i:nth-child(5){height:26px}
.hero-song-link{grid-column:2/4;justify-self:start;display:inline-flex;align-items:center;gap:6px;min-height:36px;color:var(--accent);font-size:13px;font-weight:650;text-decoration:none}.hero-song-link:hover{text-decoration:underline}
@media(max-width:820px){.hero-text{align-self:auto;align-items:center}.hero-song-card{grid-template-columns:36px minmax(0,1fr);width:min(100%,620px);margin-top:8px}.hero-song-wave{grid-column:2;grid-row:1}.hero-song-link{grid-column:2;min-height:44px}}
.profile-module{grid-column:span 6}.profile-prose{overflow-wrap:anywhere}.profile-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.profile-list li,.profile-feed li{padding:10px 12px;border-radius:10px;background:var(--sheet-2);border:1px solid var(--line);overflow-wrap:anywhere}.profile-quote{margin:0 0 10px;padding:12px 14px;border-left:3px solid var(--favorite);background:var(--sheet-2);font:italic 18px/1.5 var(--font)}.fictional-profile{border-top:3px solid var(--profile-accent)}.fictional-profile h2{font:500 24px/1.2 var(--font);margin:0}.profile-handle,.profile-counts{color:var(--ink-2);font-size:13px;margin:2px 0}.profile-feed{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px}.profile-quiz-list{display:grid;gap:12px}.profile-quiz-list article{padding:12px;border-radius:12px;background:var(--sheet-2);border:1px solid var(--line)}.profile-quiz-list h3{margin:0;font:600 18px/1.3 var(--font)}.profile-quiz-list time{color:var(--subtle);font-size:12px}
</style>
</head>
<body>
<main class="page">
<header class="hero">
${heroMediaHtml}
<div class="hero-text">
<h1 class="hero-name"><em>${escapeHtml(name)}</em></h1>

${card.quote ? (() => { const ql = card.quote.length; const qs = ql < 30 ? '1.6rem' : ql < 50 ? '1.35rem' : ql < 80 ? '1.15rem' : '1rem'; return `<blockquote class="hero-quote" style="font-size:${qs}">&ldquo;${escapeHtml(card.quote)}&rdquo;</blockquote>` })() : ''}
<div class="hero-meta">
${card.age ? `<span><strong>${escapeHtml(card.age)}</strong> years old</span>` : ''}
${card.birthdate ? `<span>Born <strong>${escapeHtml(card.birthdate)}</strong></span>` : ''}
${card.favoriteColor && card.favoriteColor !== '#b07a9e' ? `<span class="hero-color"><span class="hero-color-swatch" style="background:${safeFavorite}"></span>${escapeHtml(safeFavorite)}</span>` : ''}
</div>
${heroSongHtml}
</div>
</header>
<div class="content-grid">${factsHtml}${detailsHtml}${moodboardHtml}${boardHtml}${playlistHtml}${tracklistHtml}${statsHtml}${profileHtml}</div>
<footer class="footer">
<a href="${escapeHtml(appOrigin)}" class="footer-brand"><span class="footer-mark">RP</span>RP Thread Buddy</a>
<div class="footer-right"><a href="${escapeHtml(appOrigin)}">Make your own</a><span> &middot; </span><details style="display:inline"><summary class="report-toggle">Report</summary><form method="POST" action="/c/${escapeHtml(slug)}/report" class="report-form"><textarea name="reason" maxlength="1000" required placeholder="Why are you reporting this page?"></textarea><button type="submit" class="btn-accent" style="margin-top:.35rem;padding:.4rem 1rem;font-size:.82rem">Send report</button></form></details></div>
</footer>
</main>
<script src="/share.js" defer></script>
</body>
</html>`
}

function renderEmbed(share: ShareRow, char: CharRow, card: CardProfile, stats: CardStats, appOrigin: string): string {
  const name = char.name
  const slug = share.slug
  if (share.style === 'card') {
    const frontSvg = renderToString(createElement(Side, { side: 'front', name, profile: card, stats, portrait: char.portraitObjectKey || char.iconObjectKey ? `/c/${slug}/portrait` : null, moodboard: [], uid: 'ef' }))
    const backSvg = renderToString(createElement(Side, { side: 'back', name, profile: card, stats: share.showStats ? stats : { total: 0, mine: 0, theirs: 0, rps: [] }, portrait: null, moodboard: [], uid: 'eb' }))
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>${BRIDGE_TOKENS}*{margin:0;padding:0}body{background:transparent;color:var(--ink);font:14px/1.5 var(--ui);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:100vh}svg{width:340px;max-height:480px}a{font-size:13px;font-weight:600;color:var(--accent)}[data-flipped="false"] .card-face-front{display:block}[data-flipped="false"] .card-face-back{display:none}[data-flipped="true"] .card-face-front{display:none}[data-flipped="true"] .card-face-back{display:block}.button{min-height:44px;padding:8px 18px;font-size:14px}</style></head><body><div id="embed-card" data-flipped="false"><div class="card-face-front">${frontSvg}</div><div class="card-face-back">${backSvg}</div></div><button type="button" class="button" data-card-flip="embed-card" aria-pressed="false">Flip</button><a href="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}" target="_blank" rel="noopener">Open on RP Thread Buddy</a><script src="/share.js" defer></script></body></html>`
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>${BRIDGE_TOKENS}*{margin:0;padding:0}body{background:var(--paper);color:var(--ink);font:14px/1.5 var(--ui);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:16px;text-align:center}img{width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:8px;box-shadow:var(--e1)}strong{font:400 22px/1.2 var(--display)}.stats{display:flex;gap:8px;margin-top:12px}.stats span{padding:6px 10px;border-radius:10px;background:var(--sheet);box-shadow:var(--e1);color:var(--ink-2);font-variant-numeric:tabular-nums}a{font-size:13px;font-weight:600;color:var(--accent);margin-top:12px}</style></head><body><img src="/c/${escapeHtml(slug)}/portrait" alt="" onerror="this.style.display='none'"><strong>${escapeHtml(name)}</strong>${share.showStats ? `<div class="stats"><span>${stats.total} threads</span><span>${stats.mine} my turn</span><span>${stats.theirs} their turn</span></div>` : ''}<a href="${escapeHtml(appOrigin)}/c/${escapeHtml(slug)}" target="_blank" rel="noopener">Open on RP Thread Buddy</a></body></html>`
}

function notFoundPage(appOrigin: string): string {
  return bridgePage('Not found', `<h1>Page not found</h1><p>This share link may have been removed or rotated.</p><a class="button" href="${escapeHtml(appOrigin)}">Go to RP Thread Buddy</a>`)
}

function thankYouPage(appOrigin: string): string {
  return bridgePage('Report received', `<h1>Thank you</h1><p>Your report has been received. We&#x27;ll review it shortly.</p><a class="button" href="${escapeHtml(appOrigin)}">Go to RP Thread Buddy</a>`)
}

export function publicShareRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/:slug', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data) return c.html(notFoundPage(c.env.APP_ORIGIN), 404, { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'public, max-age=60' })
    const { share, char } = data
    const card = savedCard(char.cardJson)
    const stats = await getStats(c.env.DB, share.workspaceId, share.characterId)
    const moodItems = share.showMoodboard ? (await c.env.DB.prepare('SELECT id,kind,pin_id AS pinId FROM character_moodboard_items WHERE workspace_id=? AND character_id=? ORDER BY position').bind(share.workspaceId, share.characterId).all<{ id: string; kind: string; pinId: string | null }>()).results : []
    // Only the explicit publish snapshot is public. The private character draft
    // is never selected on this unauthenticated route.
    const profile = share.publicProfilePublishedAt ? parsePublicCharacterProfile(share.publicProfileJson) : emptyCharacterProfile()
    const [quizzes, quicklinks] = await Promise.all([
      share.publicProfilePublishedAt && profile.quizzes.enabled
        ? c.env.DB.prepare(`SELECT r.result_title AS resultTitle,r.result_text AS resultText,r.completed_at AS completedAt,q.title AS quizTitle,q.source_url AS sourceUrl
          FROM character_quiz_results r LEFT JOIN character_quiz_sources q ON q.workspace_id=r.workspace_id AND q.id=r.quiz_source_id
          WHERE r.workspace_id=? AND r.character_id=? AND r.visibility='public' ORDER BY r.completed_at DESC LIMIT 40`)
          .bind(share.workspaceId, share.characterId).all<{ quizTitle: string | null; resultTitle: string; resultText: string; completedAt: string; sourceUrl: string | null }>()
        : Promise.resolve({ results: [] as Array<{ quizTitle: string | null; resultTitle: string; resultText: string; completedAt: string; sourceUrl: string | null }> }),
      share.publicProfilePublishedAt && profile.quicklinks.enabled
        ? c.env.DB.prepare('SELECT label,url FROM character_quicklinks WHERE workspace_id=? AND character_id=? ORDER BY created_at LIMIT 30')
          .bind(share.workspaceId, share.characterId).all<{ label: string; url: string }>()
        : Promise.resolve({ results: [] as Array<{ label: string; url: string }> }),
    ])
    const headers: Record<string, string> = { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'public, max-age=60' }
    if (!share.indexable) headers['X-Robots-Tag'] = 'noindex, nofollow'
    return c.html(renderPage(share, char, card, stats, moodItems, c.env.APP_ORIGIN, { profile, quizzes: quizzes.results, quicklinks: quicklinks.results }), 200, headers)
  })

  app.get('/:slug/embed', async c => {
    const data = await loadShare(c.env.DB, c.req.param('slug'))
    if (!data) return c.html(notFoundPage(c.env.APP_ORIGIN), 404)
    const { share, char } = data
    const card = savedCard(char.cardJson)
    const stats = await getStats(c.env.DB, share.workspaceId, share.characterId)
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
    if (!share) return c.html(notFoundPage(c.env.APP_ORIGIN), 404)
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
    const ipKey = await opaqueRateLimitKey(c.env.SESSION_SECRET, `share_report:${ip}`)
    const rateOk = await checkRateLimit(c.env.DB, ipKey, 5, 3600_000)
    if (!rateOk.allowed) return c.html(bridgePage('Too many reports', '<h1>Too many reports</h1><p>Please wait before trying again.</p>'), 429)
    const contentType = c.req.header('content-type') ?? ''
    let reason = ''
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody()
      reason = String(form.reason ?? '').slice(0, 1000)
    } else {
      try { const json = await c.req.json<{ reason?: string }>(); reason = String(json.reason ?? '').slice(0, 1000) } catch { /* empty */ }
    }
    await c.env.DB.prepare('INSERT INTO share_reports (id,slug,reason,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), slug, reason, new Date().toISOString()).run()
    if (c.env.BOOTSTRAP_OWNER_EMAIL) {
      try {
        await sendEmail(c.env, { to: [c.env.BOOTSTRAP_OWNER_EMAIL], subject: `RP Thread Buddy share report: ${slug}`, text: `Reason: ${reason}\n\nLink: ${c.env.APP_ORIGIN}/c/${slug}` }, 'Email provider rejected the report')
      } catch {
        console.error('Share report saved but moderator notification failed')
      }
    }
    return c.html(thankYouPage(c.env.APP_ORIGIN))
  })

  return app
}

export function shareAdminRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.post('/:slug/disable', async c => {
    const scope = await requireWorkspace(c)
    if (!isModerator(scope.userId, c.env.MODERATOR_USER_ID)) throw new HTTPException(403, { message: 'Moderator access required' })
    const result = await c.env.DB.prepare('UPDATE character_shares SET disabled_by_moderator=1,updated_at=? WHERE slug=?').bind(new Date().toISOString(), c.req.param('slug')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Share not found' })
    return c.json({ ok: true })
  })

  app.post('/:slug/enable', async c => {
    const scope = await requireWorkspace(c)
    if (!isModerator(scope.userId, c.env.MODERATOR_USER_ID)) throw new HTTPException(403, { message: 'Moderator access required' })
    const result = await c.env.DB.prepare('UPDATE character_shares SET disabled_by_moderator=0,updated_at=? WHERE slug=?').bind(new Date().toISOString(), c.req.param('slug')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Share not found' })
    return c.json({ ok: true })
  })

  return app
}
