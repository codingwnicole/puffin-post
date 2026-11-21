# RP Thread Buddy

RP Thread Buddy is a private, Tumblr-first roleplay thread tracker. It tracks independent reply branches, including multiple replies to one open starter, and keeps character icons, notes, filters, archives, exports, and private-beta access in one mobile-friendly workspace.

## Local setup

1. Install Node 22+, run `npm ci`, then run `npx playwright install chromium` once for browser checks.
2. Copy `.dev.vars.example` to `.dev.vars` and replace every placeholder with local development values. Do not commit that file.
3. Apply local D1 migrations with `npx wrangler d1 migrations apply threadums-local --local`.
4. Run `npm run dev`.

Run the checks with:

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

## Production beta

Production setup, migrations, secrets, rollback, and acceptance checks are in [the beta runbook](docs/beta-runbook.md). Do not deploy until every required secret and Cloudflare binding in that document exists. The checked-in Wrangler config deliberately contains a non-deployable local D1 ID.

Use [the Tumblr test script](docs/tumblr-test-script.md) with test blogs before inviting anyone beyond the private beta.
