# DNS Checklist for RP Thread Buddy

The canonical site is `rpthreadbuddy.app`. `rpthreadbuddy.com` and the legacy
`puffinpost.app` address should both 301 to it, preserving the path and query
string. Resend now sends from `mail.rpthreadbuddy.app`.

1. **DNS records — no dangling targets.** Go to DNS → Records.
   Good: every A/AAAA/CNAME target is a service you still own (the Cloudflare
   Worker, a live R2/Workers/other domain of yours). No CNAME pointing at a
   deleted Cloudflare Pages/Workers subdomain, Heroku, Netlify, or S3 bucket —
   those are subdomain-takeover holes. Delete any record you don't recognize
   (export/CSV first if unsure).

2. **Check the Worker and redirects.** Go to Workers & Pages → your
   worker → Triggers → Custom Domains (and check Domains → Public Subdomains
   / "Domains" list). Good: `rpthreadbuddy.app` and `puffinpost.app` are
   attached to the existing `puffinpost` Worker. The Worker redirects legacy
   requests to `.app`; the `.com` redirect rule targets `.app` and preserves
   paths and query strings. Do not attach `.com` to this Worker.

3. **DNSSEC.** Go to DNS → Settings → DNSSEC, enable it. Then at your
   registrar: add the DS record(s) Cloudflare shows on that page (Key Tag,
   Algorithm, Digest). Good: DNSSEC status in the dashboard reads "Active"
   (takes up to 24 h). If the DS record is wrong, DNSSEC breaks the whole
   zone — remove it at the registrar and retry before leaving it on.

4. **Email authentication for the sending domain** (the domain used in
   `MAIL_FROM`, currently `mail.rpthreadbuddy.app`). In DNS → Records for that
   domain:
   - SPF + DKIM: open Resend → Domains → your domain and copy every record it
     lists (the DKIM TXT `resend._domainkey`, and the MX + SPF TXT on the
     `send` subdomain) exactly as shown. Good: Resend marks the domain
     "Verified".
   - DMARC: start with `v=DMARC1; p=none; rua=mailto:dmarc@<your email>` and
     watch aggregate reports; once things look clean, move to
     `v=DMARC1; p=quarantine; rua=mailto:dmarc@<your email>`.
   Good: a checker (e.g. mail-tester.com or MXToolbox) shows SPF/DKIM/DMARC
   all passing for that domain.

5. **CAA record: leave it alone.** Cloudflare's free certificates rotate
   between several issuers and Cloudflare adds the CAA entries it needs. A
   hand-made CAA that lists only one issuer can break the site's certificate,
   so don't add one unless you move to your own certificates.

6. **Re-checking later.** Repeat step 1 quarterly (new takeovers are usually
   found that way) and after any infra change. Steps 3–4 need re-checking only
   if the registrar key changes or you switch email providers. A free external
   check (MXToolbox / SSL Labs) is enough; no special tooling.
