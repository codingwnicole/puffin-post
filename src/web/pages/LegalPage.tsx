import type { ReactElement } from 'react'

export const EFFECTIVE_DATE = 'November 21, 2026'
const CONTACT = 'privacy@rpthreadbuddy.app'

type Block = { h?: string; p?: string; li?: string[] }

function LegalDoc({ title, blocks }: { title: string; blocks: Block[] }): ReactElement {
  const headings = blocks.filter((b) => b.h).map((b, i) => ({ id: `sec-${i}`, text: b.h as string }))
  return (
    <main className="legal-doc">
      <p><a href="#">← Back to RP Thread Buddy</a></p>
      <h1 className="page-heading">{title}</h1>
      <p className="legal-effective">Effective date: {EFFECTIVE_DATE}</p>
      {headings.length > 1 && (
        <nav className="legal-toc" aria-label="Contents">
          <strong>Contents</strong>
          <ol>
            {headings.map((h, i) => (
              <li key={i}>
                <a href={window.location.hash || '#'} onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${i}`)?.scrollIntoView() }}>{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {blocks.map((block, i) => (
        <section key={i} id={block.h ? `sec-${i}` : undefined} className="legal-section">
          {block.h && <h2>{block.h}</h2>}
          {block.p && <p>{block.p}</p>}
          {block.li && (
            <ul>
              {block.li.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  )
}

const TERMS: Block[] = [
  { h: '1. The service', p: 'RP Thread Buddy is a free beta service for tracking reply threads and roleplay scenes, with Tumblr as the current integration. RP Thread Buddy is run by Nicole @ the RP Thread Buddy team. RP Thread Buddy is not affiliated with, sponsored by, or endorsed by Tumblr. By creating an account you agree to these Terms and confirm you are 16 or older. People under 16 must not use RP Thread Buddy.' },
  { h: '2. Your account', p: 'You are responsible for keeping your email address current and for all activity under your account. If you share a workspace, each member is responsible for their own actions.' },
  { h: '3. What you keep and what you grant us', p: 'You own the characters, threads, drafts, notes, and other writing you create in RP Thread Buddy. You grant us only the licence needed to store that content on your account, display it to you and to people you explicitly invite into a shared workspace, and keep it safe while you use the service. We do not sell your writing or publish private workspace content. If you create a public share page, its selected content is visible to anyone with its link whether or not search indexing is enabled. Search indexing is off by default; you can opt in to let search engines show the page. You may delete your content at any time, and deleting your account removes everything described in the Privacy Policy.' },
  { h: '4. Acceptable use', p: `Do not use RP Thread Buddy to harass anyone, to post or track content you do not have the right to use, or for anything illegal. Do not scrape the service or abuse Tumblr's API through it (including hammering the API, circumventing rate limits, or automating access). We may suspend or terminate accounts that abuse the service, and we will tell you why when we can.`, li: [] },
  { h: '5. Tumblr integration limits', p: 'RP Thread Buddy reads posts from the Tumblr blogs you track using your own Tumblr connection. We are not affiliated with or endorsed by Tumblr. Tumblr rate limits and outages may delay updates of your tracked threads. Tumblr applies its own terms to your Tumblr account, and disconnecting your Tumblr connection in Settings stops RP Thread Buddy from reading your blogs.' },
  { h: '6. Public share pages and copyright reports', p: 'You choose what to share. Shared content is visible to anyone with the link. By sharing, you grant RP Thread Buddy permission to display that content on the share page and in link previews. Search indexing is off by default; if you turn on “Let search engines show this page,” search engines may index and display it. Turning indexing off asks search engines to remove it from results, but updates can take time and search engines control their own results. Turning sharing off removes the page from RP Thread Buddy; previews and copies that other sites have already cached may take time to disappear. Do not share content you do not have the right to share or that breaks the law. We may remove shared pages that are reported or that break these Terms. To report a copyright concern, use the Report control on the share page or email privacy@rpthreadbuddy.app with the page link and enough information for us to review the claim.' },
  { h: '7. Beta, as-is', p: 'RP Thread Buddy is a free beta. It is provided as-is, without warranties of any kind. The service may change, and we will give notice in-app before material changes. There are no payments, no ads, and no marketing email.' },
  { h: '8. Termination', p: 'You may end your use at any time by deleting your account in Settings, which deletes your data as described in the Privacy Policy. We may end or restrict access for abuse of the service.' },
  { h: '9. Governing law', p: `These Terms are governed by the laws of the United States. For privacy, account, and legal requests, contact us at ${CONTACT}.` },
]

const PRIVACY: Block[] = [
  { h: '1. Who we are', p: `RP Thread Buddy is run by Nicole @ the RP Thread Buddy team. We use a single contact address for privacy, account, and legal requests: ${CONTACT}.` },
  { h: '2. Minimum age', p: 'RP Thread Buddy is for people 16 and older. We do not knowingly collect data from people under 16.' },
  { h: '3. What we store about you', p: 'When you create an account we store:', li: [
    'Your email address, and (if you set one) a password hash for signing in',
    'Your workspaces and who is a member or has an invite to each one',
    'Your writing: characters, RP groups, planner entries and resources, notes, and icons',
    'The Tumblr blogs you track, plus the threads and posts we import from them',
    'Your reply drafts, reminders, and the reply branches you are working on',
    'Your Tumblr OAuth connection, stored server-side and never shown to your browser',
    'Your browser push subscription, if you turn on notifications',
    'Support posts and comments you make on the Support board, and votes and feature suggestions',
    'Server logs, including client error reports you send us (see below)',
  ] },
  { h: '4. Your writing is private', p: 'Each person\'s writing space (characters, threads, drafts, notes, Tumblr connections) is private to that account and to the people they explicitly invite into a shared workspace. Public share pages are visible to anyone with the link, even when search indexing is off. New share pages are not eligible for search indexing by default; the owner can opt in using “Let search engines show this page.” Search engines decide what to include and when to update or remove results, so opting in does not guarantee inclusion and opting out may not remove an existing result immediately. Posts on the Support board are visible to every signed-in user. The Support board does not show who posted an item or anyone’s email address. When you post there or send a feature suggestion, the team also receives it by email together with your email address, so we can follow up.' },
  { h: '5. Who processes it', p: 'Cloudflare hosts the service and processes data stored in its D1 database, R2 object storage, and Worker runtime. Tumblr provides the posts read through your connected account. Resend sends sign-in links and sends support and feature suggestions to the team, including your email address. We do not sell your writing or use advertising trackers or pixels. If you add a playlist or Pinterest pins to a character, those embeds are loaded from Spotify, YouTube (privacy-enhanced mode), Apple Music, or Pinterest after you choose to load them; those services follow their own privacy policies.' },
  { h: '6. Retention', p: 'We keep your account data until you delete it or delete your account. Sessions expire after 7 days. Magic links stop working after 15 minutes. Invites stop working after 7 days. Rate-limit counters use keyed identifiers rather than raw email addresses or IP addresses and are removed by scheduled cleanup after 24 hours of inactivity. Deleted database data may remain in Cloudflare D1 recovery history for up to 30 days; actual retention depends on the production plan.' },
  { h: '7. Deletion', p: 'You can delete one tracked thread from its scene, disconnect your Tumblr connection in Settings, or delete your whole account in Settings. Account deletion removes your account, every workspace only you belong to, and everything stored in them. In a workspace you share with others, your membership ends and the workspace, including writing in it, stays with the remaining members.' },
  { h: '8. Client error reports', p: 'When the app hits a problem it can send us a short error report (message, page, browser, build). The server strips email addresses and long token-looking strings from the text before it reaches our logs, keeps only the first 300 characters of the message, and rate-limits these reports per IP. These reports cannot be turned off from the app; they are the only way the team can see that a page broke on your machine.' },
  { h: '9. Your rights', p: `You may ask us to access, export, correct, or delete your data, or to object to how we use it. People in the EU, UK, or California have additional rights under their local laws; this policy does not claim any certification. To exercise any of these, email ${CONTACT}.` },
  { h: '10. Security', p: 'Sessions are signed with a server-only secret and the database stores a hash, not the session token, so a leaked database does not give working sessions. Passwords are stored as PBKDF2 hashes, not as passwords. Tumblr OAuth tokens are stored on our server side encrypted and are never sent to your browser. We do not make broader security promises than what the code and configuration support.' },
]

const COOKIES: Block[] = [
  { h: '1. What this notice covers', p: 'This notice lists every piece of storage RP Thread Buddy uses in your browser, and every outside service the app talks to. RP Thread Buddy uses only essential storage: the things the app needs to sign you in, keep your place, and do what you asked. There are no tracking cookies, no ad pixels, and no analytics.' },
  { h: '2. The session cookie', p: 'When you sign in we set one cookie called __Host-threadums_session. It is httpOnly (your browser scripts cannot read it), it is sent only over HTTPS, it uses SameSite=Lax (browsers will not send it on cross-site requests), and it expires after 7 days, when the app simply asks you to sign in again. The __Host- prefix forces the Secure flag and path=/ automatically. It exists only so the app knows who you are. You cannot use the app while signed in without it.' },
  { h: '3. Browser storage we keep for you', p: 'The app keeps a small amount of your own preferences and unsent work in your browser:', li: [
    'puffin-post.theme (localStorage): which of the two themes you picked. Stored only on this device.',
    'puffin.characters.view (localStorage): whether the characters page opens in card or detail view. Stored only on this device.',
    'puffin-draft:* (sessionStorage): the text you have not saved yet in a long form, kept only so a failed save or reload does not lose it. Cleared when the save lands or when you sign out.',
    'puffin-scroll:* (sessionStorage): your scroll position per page, so a reload puts you back where you were. Gone when the tab closes.',
  ] },
  { h: '4. Browser notifications', p: 'If you turn on browser notifications in Settings, we ask your browser for permission and register a push subscription with the notification service your browser already provides (for example Apple Push or FCM for Chrome). We store that subscription on our server only so we can send you the reminder you asked for. You can turn notifications off at any time in Settings.' },
  { h: '5. No advertising or analytics cookies', p: 'RP Thread Buddy does not use advertising cookies, analytics cookies, or ad pixels. The browser storage above supports sign-in and features you choose to use. When you choose to load an external player, that provider may use its own cookies or browser storage under its own privacy policy.' },
  { h: '6. Services the app talks to', p: 'The app uses these outside services:', li: [
    'Cloudflare: hosting, its D1 database, R2 for the icons you upload, and Workers Logs for our own debugging',
    'Resend: sending the sign-in magic links and the support and suggestion emails',
    'Tumblr: reading the posts from the blogs you track, using the connection you set up in Settings',
    'Spotify, YouTube, Apple Music, and Pinterest: player embeds loaded only after you ask to load one',
    'Your browser\'s push notification service, if and only if you turn notifications on',
  ] },
  { h: '7. Contact', p: `Questions about this notice go to ${CONTACT}.` },
]

export function LegalPage({ doc }: { doc: 'terms' | 'privacy' | 'cookies' }): ReactElement {
  if (doc === 'privacy') return <LegalDoc title="Privacy Policy" blocks={PRIVACY} />
  if (doc === 'cookies') return <LegalDoc title="Cookie Notice" blocks={COOKIES} />
  return <LegalDoc title="Terms of Service" blocks={TERMS} />
}
