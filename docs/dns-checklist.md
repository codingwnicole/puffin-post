# DNS Checklist for puffinpost.app (S13)

Do these in the Cloudflare dashboard for the puffinpost.app zone. Goal: every
record points at something you still own, the Worker is the only thing serving
the site, and the domain is signed + locked down.

1. **DNS records — no dangling targets.** Go to DNS → Records.
   Good: every A/AAAA/CNAME target is a service you still own (the Cloudflare
   Worker, a live R2/Workers/other domain of yours). No CNAME pointing at a
   deleted Cloudflare Pages/Workers subdomain, Heroku, Netlify, or S3 bucket —
   those are subdomain-takeover holes. Delete any record you don't recognize
   (export/CSV first if unsure).

2. **Only the Worker serves the apex and www.** Go to Workers & Pages → your
   worker → Triggers → Custom Domains (and check Domains → Public Subdomains
   / "Domains" list). Good: the custom domain/route for `puffinpost.app`
   (apex) and `www.puffinpost.app` is the only binding that serves either
   host. No other worker, Pages project, or route claims them.

3. **DNSSEC.** Go to DNS → Settings → DNSSEC, enable it. Then at your
   registrar: add the DS record(s) Cloudflare shows on that page (Key Tag,
   Algorithm, Digest). Good: DNSSEC status in the dashboard reads "Active"
   (takes up to 24 h). If the DS record is wrong, DNSSEC breaks the whole
   zone — remove it at the registrar and retry before leaving it on.

4. **Email authentication for the sending domain** (the domain used in
   MAIL_FROM — check `worker.ts` / `.dev.vars` for the exact host, e.g.
   `mail.puffinpost.app` or the apex). In DNS → Records for that domain:
   - SPF: `v=spf1 include:resend._domainkey.resend.com -all` (TXT)
   - DKIM: copy the three (or two) TXT records from Resend's domain settings
     page and add them exactly.
   - DMARC: start with `v=DMARC1; p=none; rua=mailto:dmarc@<your email>` and
     watch aggregate reports; once things look clean, move to
     `v=DMARC1; p=quarantine; rua=mailto:dmarc@<your email>`.
   Good: a checker (e.g. mail-tester.com or MXToolbox) shows SPF/DKIM/DMARC
   all passing for that domain.

5. **CAA record (optional).** Add `0 issue "letsencrypt.org"` (plus any other
   CA you actually use) as a CAA record so only your chosen CAs can issue
   certs for the domain. Skip if you don't want to manage it.

6. **Re-checking later.** Repeat step 1 quarterly (new takeovers are usually
   found that way) and after any infra change. Steps 3–4 need re-checking only
   if the registrar key changes or you switch email providers. A free external
   check (MXToolbox / SSL Labs) is enough; no special tooling.
