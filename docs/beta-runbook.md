# RP Thread Buddy private-beta runbook

This runbook gets a private Worker beta online without putting credentials, Tumblr tokens, or personal test URLs in Git. Companion documents: `recovery.md` (database and deploy recovery) and `repair-plan-2026-11-16.md` (the Tumblr import bug fixes).

## Recovery

For database backups, restores, deletion re-application, partial imports, interrupted deploys, and checking the live revision: read `recovery.md` first. D1 Time Travel restores the target database in place; it cannot be used to test a production restore on a scratch database. Use synthetic data in a separate non-production database to test export/import procedures. Create and securely retain a dated export before schema migrations.

## Before touching production

- [ ] Run `npm.cmd test`, `npm.cmd run test:e2e`, and `npm.cmd run build` locally.
- [ ] Verify `git status --short` contains no `.dev.vars`, `.env`, token exports, or generated database files. `debug.log` is a local diagnostic file; do not commit it.
- [ ] Use `https://rpthreadbuddy.app` as `APP_ORIGIN`; keep `puffinpost.app` attached to the same Worker for its 301 forwarding response. Keep `rpthreadbuddy.com`'s existing 301 redirect to `.app` and preserve paths and query strings.
- [ ] Create a separate Cloudflare D1 database for production and a private R2 bucket for icons. Do not reuse local resources.
- [ ] Register the Tumblr OAuth 1.0a callback URL `https://rpthreadbuddy.app/api/tumblr/callback` in the Tumblr app settings.
- [ ] Verify Resend has a sending domain and exact `MAIL_FROM` address for magic links. The address must be verified before deployment; `noreply@example.com` and any local example are not valid production senders.

## Provision Cloudflare resources

Run these commands after authenticating your own Wrangler session. They create state, so do them intentionally and record resource IDs in a password manager or private deployment notes, never this repository.

```powershell
npx wrangler d1 create threadums-production
npx wrangler r2 bucket create threadums-icons-production
```

Copy `wrangler.jsonc` to a private deployment-only configuration (or replace the checked-in local placeholder only in an uncommitted working copy) and set:

- the production D1 `database_id` and `database_name`;
- the production R2 `bucket_name`;
- `APP_ORIGIN` to `https://rpthreadbuddy.app`;
- `MAIL_FROM` to the Resend-verified sender `RP Thread Buddy <noreply@mail.rpthreadbuddy.app>`;
- the Worker/custom-domain name chosen for the beta.

`MAIL_FROM` is an ordinary non-secret Worker variable. In the private production configuration, it belongs beside `APP_ORIGIN`, never in a secret command:

```jsonc
"vars": {
  "APP_ORIGIN": "https://rpthreadbuddy.app",
  "MAIL_FROM": "RP Thread Buddy <noreply@mail.rpthreadbuddy.app>",
  "MODERATOR_USER_ID": "<existing-user-id>"
}
```

Set `MODERATOR_USER_ID` to the existing operator account's user ID. Moderator actions fail closed when it is unset; do not grant this role by email address. To look up the ID, use a read-only query in the production D1 database before deployment:

```powershell
npx wrangler d1 execute threadums-production --remote --command "SELECT id FROM users WHERE email = '<operator-email>'"
```

Keep `remote: false` and the all-zero database ID in the committed config. This makes an accidental `wrangler deploy` from a fresh checkout fail instead of silently targeting a real database.

Apply every migration once, in order:

```powershell
npx wrangler d1 migrations apply threadums-production --remote --config .\wrangler.production.jsonc
```

The scheduled refresh trigger is already configured for every 30 minutes. Confirm it appears in the Worker trigger list after deployment; do not add a second cron trigger by hand.

## Set secrets

Set secrets interactively—never with shell history containing their values and never in `wrangler.jsonc` or `.dev.vars.example`.

```powershell
npx wrangler secret put SESSION_SECRET --config .\wrangler.production.jsonc
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config .\wrangler.production.jsonc
npx wrangler secret put TUMBLR_CONSUMER_KEY --config .\wrangler.production.jsonc
npx wrangler secret put TUMBLR_CONSUMER_SECRET --config .\wrangler.production.jsonc
npx wrangler secret put RESEND_API_KEY --config .\wrangler.production.jsonc
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --config .\wrangler.production.jsonc
```

`SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` must be cryptographically random and retained safely. Rotating the latter makes previously stored Tumblr credentials unreadable unless a key-version migration is planned first.

Public magic-link sign-up is open during this beta. Anyone who can receive the email link can create a private workspace; invitations add shared-workspace memberships. `BOOTSTRAP_OWNER_EMAIL` is only the fallback recipient for support reports, not an account allowlist.

Deploy only after all bindings and secrets are present:

```powershell
npx wrangler deploy --config .\wrangler.production.jsonc
```

## Private beta onboarding

1. Use the first owner magic link to create the initial private workspace.
2. In Settings, issue one invite at a time and send it directly to the intended beta person. Revoke an invite if it is copied, sent to the wrong person, or unused after the test period.
3. Each beta participant connects only their own Tumblr test account, then selects one returned blog for each character.
4. Use the [Tumblr test script](tumblr-test-script.md). Log product defects without including magic links, cookies, post text, Tumblr OAuth tokens, or Discord links containing private identifiers.

## Beta acceptance checklist

- [ ] Invite acceptance works once and only for its intended beta user.
- [ ] Request a magic link from the production beta origin, receive it from the verified `MAIL_FROM` sender, and complete sign-in successfully.
- [ ] Tumblr connect and reconnect both work; returned blogs can be attached to characters.
- [ ] One starter supports three independent reply branches.
- [ ] A new partner reblog/reply changes only its matching branch.
- [ ] Manual status override remains in place after refresh.
- [ ] Character icon upload/fallback initials work and a different workspace cannot load the icon.
- [ ] At 390px wide, navigation and combined filters remain usable.
- [ ] Light, dark, and each preset palette remain legible.
- [ ] A deliberately failed refresh preserves old data and displays its branch-specific warning.
- [ ] Archive/restore affects only one reply branch.
- [ ] CSV download opens with literal cell values; entries beginning with formula characters do not execute.

## Backup, monitoring, and rollback

- Export a D1 backup before schema changes and keep a dated encrypted copy outside the repository.
- Keep the previous Worker deployment available. If a release is bad, use the Cloudflare dashboard or `wrangler rollback` to return to the preceding deployment; do not roll back D1 migrations blindly.
- If a deployment causes data corruption risk, first disable the cron trigger, then roll back Worker code, then investigate from a backup copy.
- Watch Worker error rate, D1 errors, and scheduled-event failures during the beta. A transient Tumblr error should be visible on the branch without deleting its last known state.
- If Tumblr credentials are exposed, rotate the consumer secret, revoke affected connections, and tell affected beta users to reconnect. Do not attempt to edit encrypted token blobs manually.
