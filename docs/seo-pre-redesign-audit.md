# RP Thread Buddy: pre-redesign SEO and discovery audit

**Status:** prepared on branch `seo/pre-redesign` from the current `main` checkout. Code and legal-copy edits are local and unpublished. No production, DNS, directory submissions, Search Console, or analytics changes were made.

## Summary

The public root is already branded as RP Thread Buddy, has a canonical URL on `https://rpthreadbuddy.app/`, accurate description and Open Graph tags, and a useful guest landing page with one clear H1. The app remains a React/Vite client-rendered SPA: the initial HTML contains an empty root element and JavaScript supplies the landing copy. That is workable for Google’s JavaScript rendering, but less dependable for crawlers and unfriendly to a future set of content pages unless those pages are statically rendered or pre-rendered.

The clearest technical gaps were missing real `robots.txt` and sitemap files. In the live browser, both requested URLs loaded the app shell instead of their expected file content. I added static files to `public/`, set `X-Robots-Tag: noindex, nofollow` on `/api/*`, and added a runtime `noindex` directive after a valid dashboard session is detected. The API is not disallowed in robots.txt, so crawlers can see its noindex header if they encounter a URL. The private API remains protected by its existing authentication checks; robots directives are an extra indexing signal, not an access-control mechanism.

The `.app` host is the canonical domain. Direct checks of the other hosts found that `rpthreadbuddy.com` and `puffinpost.app` land on the `.app` host with the tested path and query intact. I could not verify their redirect status codes in the browser. `www.rpthreadbuddy.com` did not resolve, and `www.puffinpost.app` returned a Cloudflare 522. Fix those host-level issues before asking Google to treat the domain move as complete. Those changes are outside the repository and were not made.

The immediate organic opportunity is to position RP Thread Buddy around roleplay organization overall, while being precise about current platform support: Tumblr is the connected integration today; Discord and other scenes can be added manually; a Discord bot/app is future work. Keep the dashboard private and hash-routed. Build new public pages as real, crawlable paths with unique metadata, using static HTML or build-time prerendering; a Next.js migration is not justified by this audit.

## Technical audit findings

| Area | Finding | Action / status |
|---|---|---|
| Public root | Live page renders the current guest landing copy and one H1. The source uses a React root populated after JavaScript loads. | No visual change. Keep this for now; give public content routes pre-rendered HTML during the redesign. |
| HTML metadata | Canonical and OG URL point to the `.app` root. OG site/title/description and Twitter card metadata exist, but the original title did not identify the product category and the description was broad. | Updated the root title and social metadata to the broader roleplay thread-tracker category. The description says Tumblr is connected and Discord scenes are manual; it does not present the future bot as live. This is local and unpublished. No OG image is configured; add one after the redesign has an approved share image. |
| Headings | Guest landing has one H1, followed by feature text and sign-in. No obvious hierarchy defect was observed. | Recheck the redesigned page and each future content page. |
| React / crawlability | Vite serves an SPA. Search engines that render JavaScript can see the landing copy, but the HTML shell itself has no descriptive body content. Social previews use static head tags, not rendered React content. | Avoid a framework migration. Pre-render only new public pages if needed. |
| Robots and sitemap | Neither file existed in `public/`; the live `/robots.txt` and `/sitemap.xml` URLs displayed the SPA shell. | Added both files. Robots allows crawling and points to the sitemap; it does not block `/api/`, so the API `noindex` header remains visible to crawlers. The sitemap includes only the canonical public homepage. |
| Private data | Dashboard data is fetched through authenticated APIs; server-side workspace checks protect tenant data. The SPA does not server-render a user’s writing into the document response. | Added API `noindex` response headers and a runtime `noindex` meta tag after a valid session is detected. Existing auth remains the privacy boundary. |
| Public character shares | Shares are server-rendered and have their own canonical/title. New shares default to non-indexable; the page includes both meta and header `noindex` unless the owner opts into indexing. | Kept the opt-in and clarified the Share panel, Terms, and Privacy Policy: a link-shared page is public even when search indexing is off, and search result updates are not immediate or guaranteed. Embeds are already `noindex`. Do not include share URLs in the sitemap without a deliberate product decision. |
| Duplicate URLs | App navigation uses URL fragments, so dashboard tabs share `/` rather than creating separate crawlable routes. Unknown path requests fall through to the SPA and use the root canonical; this is not a substitute for real content routes. | No router added. New marketing/tutorial pages need real paths and self-canonicals. |
| Mobile / Core Web Vitals | The live landing page is text-first and has no evident large media block. No authenticated analytics/Search Console Core Web Vitals dataset or reproducible lab measurement was available in this pass. | Treat CWV as unverified, not as a known failure. Run PageSpeed Insights/Lighthouse on the redesigned public page and monitor Search Console after indexing. |
| Structured data | No structured data was found for the marketing root. | Not necessary for launch. Consider `WebApplication` only once product name, category, feature claims, and public access status are stable; never add fabricated ratings or pricing. |

### Crawl and indexing behavior observed

- The live canonical homepage loaded and rendered the RP Thread Buddy guest landing page.
- The rendered page had `<title>RP Thread Buddy</title>`, the description in the checked-in `index.html`, a canonical at `https://rpthreadbuddy.app/`, and one H1.
- The live `/robots.txt` and `/sitemap.xml` requests rendered the app shell, confirming they were not serving their intended file formats before these changes.
- Search results checked during this pass did not show a `site:rpthreadbuddy.app` result. That is not a definitive index-status check; Search Console URL Inspection is authoritative for the owner.
- No character, thread, note, or dashboard data was accessed. No sign-in was needed.

## Domain migration audit

| Host | Observed behavior | Follow-up |
|---|---|---|
| `rpthreadbuddy.app` | Loads the canonical product. | Keep as the only canonical host. |
| `rpthreadbuddy.com` | Browser landed on `rpthreadbuddy.app` with the tested `/terms` path and `?seo-check=1` query preserved. | Confirm 301/308 status in Cloudflare/HTTP headers and retain path/query mapping. |
| `www.rpthreadbuddy.com` | DNS name did not resolve from the live browser. | Add/repair DNS and permanent redirect only after confirming intended ownership and routing. |
| `puffinpost.app` | Browser landed on `rpthreadbuddy.app` with the tested path and query preserved. Repository Worker code also explicitly redirects this apex host. | Confirm 301 response and continue to retain the domain/redirect. |
| `www.puffinpost.app` | Returned Cloudflare 522 Host Error. | Fix the Cloudflare custom-domain/origin routing. A Worker redirect cannot help unless requests reach that Worker. |

Source inspection found no user-facing internal links to the legacy domains. Remaining `puffinpost` and `threadums` strings are implementation identifiers, historical documentation, or the intended legacy redirect. They are not grounds to rename Workers, storage keys, or service-worker assets.

**Search Console migration sequence:** verify `rpthreadbuddy.app`, `rpthreadbuddy.com`, and `puffinpost.app` as Domain properties using DNS. Verify relevant old `www` subdomains if they are restored. First make every host resolve and permanently redirect path-for-path to `.app`; then update internal links and submit the `.app` sitemap. Use Change of Address from each old domain property only if that domain had indexed content and all its URLs now redirect to the new domain. Do not submit Change of Address for a broken/unverified host or for a domain that never had search visibility. Keep redirects long-term. Google’s current site-move guide asks owners to verify old/new properties, test redirects, submit the new sitemap, and use Change of Address for domain moves.

## Private versus public indexing

The app’s account pages are hash routes on the same root URL; there are no server-rendered character, thread, notes, or planner pages. API responses are not cached and require a valid session/workspace. The new API `X-Robots-Tag` is defense in depth. The new client-side meta tag covers a signed-in browser session on the SPA document. Neither robots.txt nor `noindex` replaces auth, and `/api/` still checks authorization.

Public character share links are intentionally different: owners explicitly create the link, choose what it exposes, and can enable indexing. The default is non-indexable. Keep that opt-in. The sitemap intentionally omits user-generated share pages, even if an owner chooses to index one, so the site does not enumerate personal character pages by default.

## Keyword and search-intent research

I checked current search results and public roleplay resource listings, not paid keyword-volume tools. Search volumes, difficulty, rankings, and backlink counts are **not known** and are not estimated here. The results include Tumblr templates and trackers, Notion/Google Sheets systems, and an existing Discord Thread Tracker listed on Top.gg that tracks last replies and organizes threads. Public Tumblr RP server guides also mention thread-tracker and reminder bots. This confirms cross-platform tracking and reminders are real user workflows, while showing that Discord thread tracking already has competition. Lead with roleplay organization broadly, state Tumblr integration and manual Discord tracking accurately, and only target Discord-bot queries once that bot ships. See the [Top.gg Thread Tracker listing](https://top.gg/bot/385572136082735106) and this [Tumblr RP server guide](https://www.tumgik.com/faceinspn).

| Query cluster | Likely intent | Relevance | Competition signal (qualitative only) | Content opportunity |
|---|---|---:|---|---|
| RP thread tracker; roleplay thread tracker; roleplay tracker | Find a tool or template; mixed informational/transactional | Very high | Existing tracker products and DIY templates surfaced; no difficulty score. | Primary product page for organizing scenes, characters, drafts, and plans across writing spaces. Clearly distinguish connected integrations from manual tracking. |
| Tumblr RP tracker; Tumblr roleplay tracker; Tumblr RP thread tracker | Find a Tumblr-specific tracker | Very high | Niche tracker results surfaced, including newer browser tools; no difficulty score. | Dedicated Tumblr workflow page. State Tumblr is the current connected integration. |
| RP reply tracker; track Tumblr RP replies; see whose turn it is in a Tumblr thread | Solve the “what do I owe?” problem | Very high | Not separately measured; likely overlaps with tracker pages. | Short tutorial plus screenshots/demo after the redesign. |
| Discord roleplay thread tracker; Discord RP tracker bot | Find a bot or app to track roleplay threads/replies in Discord | High future fit | A public Thread Tracker bot already offers last-reply tracking and thread categories; a separate open-source bot also exists. No difficulty score or share data. | Do not create a Discord integration landing page yet. At launch, explain exactly what the bot tracks, permissions, privacy model, setup, and differences from current options. |
| Discord roleplay reminders; RP reply reminder bot | Find reminders for replies, tasks, or character events | Medium-high future fit | Community guides mention reminder bots alongside RP thread tracking, but general reminder bots are broad competition. No difficulty score. | Market the Discord bot only after reminder delivery is live and tested. Current browser/in-app reminders can be described separately. |
| Multi-platform roleplay tracker; roleplay organizer for Tumblr and Discord | Find one workflow across platforms | High product fit; search demand unverified | Search evidence shows roleplayers split workflows across Tumblr, Discord, templates, and bots; exact query demand is not measured. | Use this as broad brand positioning, not a claim that integrations are live. Validate language with Search Console after release. |
| Tumblr roleplay organizer; organize multiple Tumblr RP blogs | Organize multiple blogs, characters, and scenes | High | Related templates and trackers surfaced; query competition not measured. | Page about multiple blogs, character assignments, partners, and RP groups. |
| Roleplay character manager; RP character organizer | Manage characters and notes | High | Notion character dashboard/template results surfaced; no difficulty score. | Explain character cards, grouping, quicklinks, and planner features that exist today. |
| RP character planner; save RP plot ideas; RP starter organizer | Store concepts, starters, and notes | Medium-high | Template-led results exist; query competition not measured. | Guide to keeping planned starters and plotting ideas in one place. |
| Roleplay writing tools | Find generators/utilities; broad intent | Medium | Broad and mixed category; no SERP or difficulty score collected. | Focused tools page listing current utilities only; avoid “all-in-one writing platform” claims. |
| RPThreadTracker alternative; Tumblr thread tracker alternative | Compare a named tool or workaround | High but sensitive | Legacy tracker and newer products both surfaced; high proof burden, no difficulty score. | Balanced comparison of the maintained RPThreadTracker, newer tools, and manual Notion/Sheets workflows. Verify every competitor immediately before publication. |
| Tumblr RP thread tracker for multimuse; tracker for multiple RP characters | Specific multi-character workflow | High | Not separately measured; overlaps with tracker intent. | Long-tail section in the Tumblr tracker page; do not create thin near-duplicate pages. |

Current search evidence includes real Tumblr tracker discussions, templates and newer products such as YourThreads. Public snippets from the legacy RPThreadTracker update blog include maintainer updates; verify live availability and feature status before making a comparison. Do not call it discontinued or imply RP Thread Buddy replaces it without that check. Existing Notion and Google Sheets products are valid alternatives for writers who prefer manual setup, not inferior products to dismiss.

## Recommended public page architecture

Keep the current app as a private SPA. During the redesign, create only pages with distinct value and real path URLs:

1. `/` - broad roleplay thread-tracker and organization overview; make current platform support obvious.
2. `/tumblr-rp-thread-tracker/` - current connected integration, workflow, and real screenshots.
3. `/roleplay-character-organization/` - character cards, groups, profile links, and planning.
4. `/roleplay-planning-tools/` - parking lot, starters, drafts, and current writing utilities/reminders.
5. `/guides/` - a small guide index with useful tutorials such as "How to keep track of Tumblr roleplay replies," "How to organize multiple RP characters and threads," and a practical manual Discord workflow if it answers a real need.
6. `/discord-roleplay-tracker/` - **only after** the Discord bot/app is live, useful, and its permissions and data handling are clear. Do not create a pre-launch doorway page or imply Discord integration today.
7. `/compare/` or one carefully researched comparison guide - only once product features are verified; compare manual Notion/Sheets workflows and existing Tumblr/Discord trackers fairly.
8. `/terms/`, `/privacy/`, `/cookies/` - clean public document URLs if the redesign needs them to be independently discoverable. They are currently hash routes and not separate sitemap URLs.

Do not make near-identical pages for every keyword variation. Each page should answer a distinct question, show the real current product, and link to the relevant guide or signup. New public pages should have server-delivered or prerendered text, a unique title/description, self-canonical, one H1, descriptive internal links, and a real 404 for deleted paths. A static HTML page or Vite build-time prerender is enough; React can still power the signed-in app.

### Copy drafts for redesign review (not published)

**Working page title:** RP Thread Buddy | Roleplay Thread Tracker (now set in local root metadata)

**Working description:** Organize roleplay threads, characters, drafts, and plans in one workspace. Connect Tumblr for updates, add Discord scenes manually, and set reminders.

**Short directory description:** RP Thread Buddy is a roleplay organization workspace for threads, characters, drafts, and plans. Tumblr is the current connected integration; Discord and other scenes can be tracked manually.

The metadata wording is in the local branch and unpublished. The directory description remains a draft. It does not claim an automated Discord integration. When the bot launches, update copy to describe verified commands and permissions rather than simply replacing "manual" with "automatic."

### Draft directory and community copy (not submitted)

- **ROLEPLAYER.INFO:** title "RP Thread Buddy - Roleplay Thread Tracker." Description: use the short directory description above.
- **Tumblr resource post:** title “A calmer way to keep up with Tumblr RP threads.” Description: “I built RP Thread Buddy to help me keep threads, characters, and plotting notes together. Here’s how the current Tumblr workflow works, what it tracks, and what it doesn’t.” Include a short real demo and disclose that it is your project.
- **Product Hunt:** title "RP Thread Buddy." Tagline: "Keep roleplay threads, characters, and plans organized." Description: use the short directory description, then expand only with features available on launch day.
- **AlternativeTo:** listing name "RP Thread Buddy." Description: "A web-based roleplay tracker for organizing threads, characters, drafts, and plans. Tumblr is connected today; other scenes can be tracked manually." Put the canonical URL only in the official website field; their FAQ says not to put links in the description and advises against UTM parameters.
- **SaaSHub:** title "RP Thread Buddy - Roleplay Thread Tracker." Description: use the short directory description. Use accurate competitor/category fields and do not select AI categories.
- **Roleplay Index (if the owner confirms fit):** title "RP Thread Buddy - Roleplay Organization Tool." Description: use the short directory description; explain Tumblr and manual Discord support precisely.
- **Creator/editorial pitch:** “Would you be interested in trying a Tumblr RP thread tracker and giving an honest take on the workflow? I can share what it does and where it differs from a spreadsheet or Notion setup. No positive review or link placement is expected.”
- **G2/Capterra and AI directories:** no listing copy drafted because the current beta is a poor fit or ineligible; do not create an inaccurate profile just to obtain a link.

## Discovery and backlink opportunities

No directory submissions, posts, reviews, or outreach were made. A listing is only an earned link after the live page exists.

| Opportunity | Audience and fit | Eligibility / cost / link | Suggested listing and timing |
|---|---|---|---|
| [ROLEPLAYER.INFO Resources](https://roleplayer.info/resources) | High niche fit: the page is specifically a roleplay resource list and says it welcomes self-promotion/resource suggestions. | No formal submission form or fee found. The owner asks people to share resources; request permission via the contact routes described at [their contact page](https://roleplayer.info/contact). Public listing/link is possible if accepted, not guaranteed. | **After redesign/domain repairs.** Title: "RP Thread Buddy - Roleplay Thread Tracker." Use the short directory description above. |
| Tumblr RP/resource community post | Very high audience fit and direct referral potential; the user already creates RP resources on Tumblr. | Free to post on the user’s own blog. Community blogs may have submission rules; review them first. A public post can link to the product, but no search-follow attribute or SEO value is guaranteed. | **After redesign**, publish one useful demo/tutorial with a clear disclosure that it is your project. Share where self-promotion is allowed; do not mass-DM or tag-spam. |
| [Product Hunt](https://www.producthunt.com/) | Low-to-medium audience match; broad software discovery rather than roleplay-specific. | Free submission. Product Hunt currently requires a personal account with posting access; required launch assets include product URL, name, tagline, description, logo, gallery image, tags, and role. Public launch page is created; no guarantee of featuring or backlink attributes. No paid votes. | **After redesign and an openly usable beta.** Tell the product story around roleplay organization, and describe only the integrations available on launch day. Ask for product feedback, never votes. |
| [Discord App Directory](https://discord.com/application-directory/) | Very high future fit for roleplayers already using Discord; also an in-product install/discovery channel. | Discord's current docs require app verification, a community-designated support server, an application description, an install URL, at least one app tag, accurate Terms and Privacy links, and opting in to Discovery. The reviewed eligibility docs do not state a submission fee; confirm in Developer Portal. A public app profile/link is possible after approval, not guaranteed. | **After the Discord bot/app is working and reviewed.** Draft title: "RP Thread Buddy - Roleplay Thread Tracker." Only describe commands and reminders that are live. Keep permissions minimal and make data handling clear. |
| [Top.gg Discord bots](https://top.gg/bot/new) | High future fit for users searching specifically for a roleplay or reply-tracking bot. A roleplay-oriented Thread Tracker is already listed, so this is a real competitive surface. | Submission is reviewed; bot must be online for review, with accurate categories, invite permissions, and support URL. The public submission guide reviewed did not state a listing fee; paid promotion status is not verified. A public listing/link is possible after approval. | **After the bot is online and usable.** Draft title: "RP Thread Buddy - Roleplay Thread Tracker." Description should explain its exact tracking/reminder behavior and permissions; do not solicit fake ratings or use paid votes. |
| [AlternativeTo](https://alternativeto.net/faq/) | Medium software-discovery fit; comparison intent could suit tracker users. | Account and verified email required; submissions are reviewed. The ordinary queue is free; optional priority review costs extra and does not guarantee approval. Public product page has official website/creator URL fields; its FAQ discourages UTM tracking links. It rejects closed/private beta and invite-only products, while saying public/open beta may be accepted. | **After public-beta status is explicit** and a real comparison target is confirmed. Do not stuff links into the description or submit under an inaccurate category. |
| [SaaSHub](https://www.saashub.com/services/submit) | Medium-low audience fit: generic software discovery, less concentrated on roleplay writers. | Accepts SaaS and most apps, but requires released products and review approval; asks for relevant categories and competitors. Product verification uses an email on the domain for priority. A public product page includes the website URL. Homepage placement is a paid feature; basic submission appears free. | **After the redesign and clear public access.** Do not pay for featuring. Use accurate competitors/categories; if it asks for "competitors," list manual Notion/Sheets and real tracker tools fairly. |
| [G2](https://documentation.g2.com/help/docs/finding-or-listing-a-product-on-g2) / [Capterra](https://www.capterra.com/vendors/) / Software Advice / GetApp | Low fit: these are mainly B2B software buyer/review marketplaces. | G2 profile claiming is free, with paid profile features, but G2 explicitly rejects B2C and beta products. Capterra offers a free provider profile and paid sponsorship/lead-generation options; its buyer audience is still a poor fit. | **Skip for now.** Do not recruit reviews or present a consumer RP utility as business software. Revisit only if the product audience/model changes. |
| AI-tool directories | Low / no fit. | No qualifying AI functionality is part of the current product. | **Skip.** A directory tag is not a reason to reclassify the product as AI software. |
| [Roleplay Index](https://roleplayindex.com/) and broader RP directories | Potentially relevant audience: it has a “Roleplay Resources” category, but the site mainly indexes communities and resources. | No clear current software-submission procedure or cost was verified. Public listing/backlink availability is unknown. | **Watchlist only.** Ask whether a roleplay-management app fits the resource category before submitting. |
| Niche creator/editorial coverage | High fit when a creator genuinely reviews or demonstrates tools. | No guaranteed listing or link; pitch an honest hands-on demo or useful tutorial, with any relationship disclosed. No paid link placement. | **After redesign**, target creators/blogs publishing roleplay workflow tools and writing organization, including Tumblr and Discord communities. Offer a working beta account only if they request it; never ask for a positive review. |

## Search Console, Bing, and measurement checklist

### Google Search Console

1. Add a **Domain property** for `rpthreadbuddy.app` and verify the TXT record shown by Search Console in the domain’s DNS. Add Domain properties for `rpthreadbuddy.com` and `puffinpost.app` too, so old-domain data and migration requests can be managed.
2. After the new files are deployed, submit `https://rpthreadbuddy.app/sitemap.xml` once in Sitemaps.
3. Inspect the canonical homepage with URL Inspection. Check the rendered result, selected canonical, crawl allowed/indexing status, and last crawl date.
4. Monitor Page indexing for duplicate/canonical, soft-404, redirect, and crawl errors. Review Search Console Performance by query, page, country, device, impressions, clicks, and CTR.
5. Monitor Core Web Vitals after field data accumulates. Run PageSpeed Insights/Lighthouse on the redesigned homepage as a launch check; do not infer CWV status from bundle size alone.
6. After fixing all redirect hosts, verify old/new properties and use Change of Address for the old domain properties that actually had indexed pages. Submit the new sitemap; keep old redirects live.

### Bing Webmaster Tools

1. Add `https://rpthreadbuddy.app/` and verify by DNS or a supported verification method. Importing from Search Console is also an option.
2. Submit the same canonical sitemap and check URL inspection, sitemap status, Search Performance, backlinks, and Site Scan.
3. Recheck redirects and domain health in Bing. IndexNow is optional; a small static site can begin with the sitemap and manual URL submission.

### Privacy-conscious measurement

Start with Search Console and Bing Webmaster Tools; neither requires adding a site-wide advertising tracker. Do not add Google Analytics or other tracking scripts during the redesign without reviewing the privacy/cookie disclosures and deciding whether the extra data is worth it. For referral links, use clean canonical URLs first; if a privacy-conscious analytics method is later selected, attribute campaigns there. Avoid adding tracking parameters to AlternativeTo links, whose FAQ specifically recommends a clean URL and HTTP referrer instead.

## Discord bot/app readiness (future work)

- Keep the web product positioned around roleplay organization overall. Current copy says Tumblr is connected and Discord scenes can be tracked manually; it does not claim a Discord integration.
- Before marketing a Discord bot, ship and test its thread-status and reminder behavior, document required permissions, and explain exactly what happens in a server.
- Apply data minimization: store only IDs and settings needed for tracking/reminders where possible; avoid storing message bodies unless a live feature truly needs them. Make opt-in, retention, deletion, and disconnect behavior clear.
- Update the Privacy Policy and Terms before the bot collects or processes Discord data. The current policy should not describe future collection as if it happens now.
- For Discord App Directory discovery, current docs require verification, a community-designated support server, an app description, install URL, at least one tag, accurate Terms/Privacy links, and opting into Discovery. Eligibility does not guarantee inclusion. See [Discord's App Directory profile requirements](https://support-dev.discord.com/hc/en-us/articles/6378525413143-App-Directory-App-profile-pages) and [inclusion guidelines](https://support-dev.discord.com/hc/en-us/articles/8852009977879-App-Directory-Inclusion-Guidelines).
- For Top.gg, wait until the bot is online and reviewer-ready. Use accurate categories, minimal permissions, and a support link. Its current submission guide says the bot must be online for review: [Top.gg submission steps](https://support.top.gg/hc/en-us/articles/23135162935708-How-to-Add-Your-Bot).

## Wait for redesign / domain cleanup

- No large content rollout before the redesign. Keep the current look intact and use the proposed page map as content direction.
- Add an approved OG image and social preview image; do not invent or publish a placeholder brand visual.
- Publish the proposed page copy only after product claims, beta access status, and screenshots are reviewed.
- Do not add a separate page for every keyword; publish guides only when they answer a real user question.
- Fix and header-check `www.rpthreadbuddy.com` and `www.puffinpost.app`; confirm all redirects are permanent and path/query-preserving.
- Do not change production DNS, Cloudflare settings, or redirect rules from this branch.

## Verification and limitations

- Changes are isolated in branch `seo/pre-redesign` and worktree `.worktrees/rptb-seo-pre-redesign`.
- Existing functionality, API contracts, database schema, and production infrastructure were not changed.
- Updated the effective date on Terms, Privacy Policy, and Cookie Notice to November 21, 2026. Terms and Privacy now explain the public-share indexing opt-in and the limits of search-result updates. No Cookie Notice storage or tracking disclosure changed because the SEO work adds no cookies, analytics, or tracking.
- Added one integration test for `X-Robots-Tag` on a private API response.
- `git diff --check`, a Node TypeScript syntax check for `src/worker.ts`, and static assertions for the root title/description/canonical, robots file, one-URL canonical sitemap, legal copy, and noindex directives passed. The sitemap XML also parsed successfully.
- `npm.cmd run build`, `npm.cmd test`, and `npm.cmd run test:e2e` could not run because the worktree has no installed dependencies (`tsc`, `vitest`, and `playwright` missing). `npm.cmd ci --offline` stopped because the npm cache does not contain `zod@4.6.7` (`ENOTCACHED`); a normal `npm.cmd ci` then failed because this environment could not resolve `registry.npmjs.org` (`ENOTFOUND`). The build, integration suite, and E2E suite therefore remain unverified; no deployment was attempted.
- The web fetch service could not retrieve the product domains directly. Live behavior was checked in a browser; redirect status codes could not be read, and the domain failures above need a DNS/Cloudflare console check.
- Core Web Vitals field data was not available. Do not treat performance as passed until the redesigned page is measured.

## Research sources

- Google Search Central, [Site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- Google Search Central, [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [robots meta and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), and [robots.txt introduction](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- Google Search Console Help, [Verify your site ownership](https://support.google.com/webmasters/answer/9008080)
- Google Search Central, [How to use Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start/)
- Bing Webmaster Tools, [Add and verify a site](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b) and [Sitemaps](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed)
- Product Hunt Help, [How to post a product](https://help.producthunt.com/en/articles/479557-how-to-post-a-product), [Build your product page](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page), and [promotion rules](https://help.producthunt.com/en/articles/17734384-5-how-to-promote-your-launch-and-what-to-avoid)
- AlternativeTo, [FAQ and application submission rules](https://alternativeto.net/faq/)
- SaaSHub, [Submit a product](https://www.saashub.com/services/submit) and [FAQ](https://www.saashub.com/faq)
- G2, [Product listing eligibility](https://documentation.g2.com/help/docs/finding-or-listing-a-product-on-g2) and [profile plans](https://sell.g2.com/plans)
- Capterra, [Vendor listing overview](https://www.capterra.com/vendors/) and [free/paid profile details](https://www.capterra.com/resources/how-we-ensure-transparency/)
- Discord developer docs, [App Directory profile requirements](https://support-dev.discord.com/hc/en-us/articles/6378525413143-App-Directory-App-profile-pages) and [inclusion guidelines](https://support-dev.discord.com/hc/en-us/articles/8852009977879-App-Directory-Inclusion-Guidelines); Top.gg, [bot submission](https://support.top.gg/hc/en-us/articles/23135162935708-How-to-Add-Your-Bot) and [existing Thread Tracker listing](https://top.gg/bot/385572136082735106)
- Niche discovery evidence: [ROLEPLAYER.INFO Resources](https://roleplayer.info/resources), [YourThreads Tumblr tracker post](https://www.tumgik.com/yourthreads), [RPThreadTracker updates blog](https://www.tumgik.com/tblrthreadtracker), [Tumblr RP Discord server guide mentioning thread/reminder bots](https://www.tumgik.com/faceinspn), [open-source Discord Thread Tracker](https://github.com/vexx32/thread-tracker), [Notion RP Character Dashboard](https://www.notion.com/templates/rp-character-dashboard), and [Google Sheets thread tracker](https://ko-fi.com/s/376d012d26). These sources confirm existing workflows and tools; they do not prove search volume, adoption, or product performance.
