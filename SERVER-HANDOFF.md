# START HERE — server deployment handoff

**You are a fresh Claude Code session running ON the production server** (Hetzner
CX33, Helsinki, Ubuntu 24.04, hostname `CrossCurrentRacing`). You have no prior
context — this file, plus `CLAUDE.md` and `DEPLOY.md`, is your briefing. Read all
three before acting.

## What this project is
The **CrossCurrent Racing data platform** — a Next.js car-to-track recommendation
engine for the sim-racing game Le Mans Ultimate. Drivers log test sessions; a
5-factor model ranks cars per track/class. It's feature-complete and tested
(111 passing tests). Full detail is in `CLAUDE.md`.

## Where things stand (2026-07-11)
- **The app is DONE and pushed** — you're getting the latest by cloning.
- **The server is fresh** — secured with SSH key auth, nothing deployed yet.
- **This is the first real production deploy.** Dev has only ever run on the JSON
  dev store; the first real PostgreSQL run has never been done. `DEPLOY.md`'s
  checklist *is* that smoke test.

## Your job (walk `DEPLOY.md` — it has every command)
1. Update the system.
2. Create the `/srv/ccr/` tree (see DEPLOY.md "Server file layout").
3. Install Node 20, PostgreSQL, Caddy.
4. Clone `https://github.com/Slat3ruk/ccr-platform.git` into
   `/srv/ccr/data-platform`.
5. Create the DB + `npm run migrate`, then `npm install && npm run build`.
6. Run under pm2, **bound to localhost:3000**.
7. Seed reference data, then verify: `GET /api/seed` must report
   `"backend": "postgres"` (not `json`), and a logged session must survive a
   `pm2 restart`. That's the finish line for this phase.

## ⛔ CRITICAL GUARDRAILS — do not cross without the user's explicit OK
- **The app has NO real authentication yet** — a client-side "view-as" role
  toggle, so *anyone who can reach the URL can become Admin and purge all data.*
  It is therefore OK to put it on its domain **only behind the temporary
  shared-password gate** (Caddy `basic_auth`, see DEPLOY.md §4). That's the
  sanctioned way to make it usable by the team tomorrow without exposing it to
  the public. **NEVER bind the subdomain publicly without that gate**, and don't
  hand out the address until the gate is live. The real fix (Discord OAuth via
  the team website + an app-side verify layer) is a later phase — see the
  ⭐ RELEASE PLAN in `CLAUDE.md`.
- **DO NOT follow third-party server-hardening guides.** The user's first server
  was bricked by one (it disabled all login methods before a key was installed).
  Do hardening yourself, from inside, **testing that SSH still works before and
  after each change** so you never lock the user out.
- **Stop and ask before anything irreversible** — data deletion, DNS, firewall
  rules that could sever your own SSH, spending decisions.
- **git is the bridge.** Anything you fix on the box, commit and push so it stays
  in sync with the user's PC. Commit style: end messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## ⚠ Cloudflare gotcha (known before you start)
`crosscurrentracing.com` is on **Cloudflare**, and `data.crosscurrentracing.com`
was resolving to Cloudflare proxy IPs (104.21.x / 172.67.x), not the origin
`204.168.129.71`. If the `data` record is **proxied (orange cloud)**, Caddy's
default automatic HTTPS (TLS-ALPN / HTTP-01 challenge) **will fail** — it'll look
like a cert bug. Two fixes: (A) simplest — the user sets the `data` record to
**"DNS only" (grey cloud)** so Caddy's auto-HTTPS just works; (B) keep the proxy
and configure Caddy's Cloudflare **DNS-01 challenge** (needs a CF API token) with
Cloudflare SSL mode "Full (strict)". Plan agreed = **Option A for launch.** If you
hit a cert failure, check the cloud colour first. (User was told to grey-cloud it
the night before — verify it actually resolves to the origin IP before debugging
Caddy: `dig +short data.crosscurrentracing.com` should show `204.168.129.71`.)

## After the smoke test passes — LAUNCH CHECKLIST
The production DB starts **blank** — several things the user configured in local
dev live in the settings store and must be redone here (walk the user through
these in the control panel, view-as Admin):
1. **Set the current patch** (e.g. `1.3.3.4` — check Steam for the latest) so new
   sessions are patch-stamped. No line needed (fresh DB, nothing to scope).
2. **Reconnect the three Discord webhooks** (race / test / board) — the user has
   the URLs in their Discord server's channel settings. Use each slot's "Test"
   button to verify (this is a sanctioned test post).
3. Wet penalty + weighting are back to defaults (8%, Balanced) — fine unless the
   user wants their tuning back.
4. **Schedule the backup cron on day one** (see Backups & ops) — real data
   deserves a daily pg_dump from the first session logged.
5. **Data policy (user decision 2026-07-11): production starts CLEAN** — no
   migration of the local dev store's sessions. If the user changes their mind,
   a small export/replay script is the path (local JSON → POST /api/sessions).
6. Known quirk to mention to the team: drivers are auto-created by typed name,
   so spelling variations split a driver on the leaderboard — type your name
   consistently until Discord auth replaces free-text names.

Then report the result to the user and stop. The next phases (team website +
Discord OAuth, the app-side auth verify layer, then public launch) are separate
jobs the user will direct — they are NOT part of this deploy.

## Post-launch backlog (once stable — NOT launch tasks)
- **Turn on the Cloudflare proxy (orange cloud) for `data`** — hides the origin
  IP + free DDoS protection (the real win; CDN caching barely helps a dynamic
  app). Requires reconfiguring Caddy to get certs via the **Cloudflare DNS-01
  challenge** (CF API token) since the proxy breaks the default challenge, and
  setting CF SSL mode to "Full (strict)". ~15 min. Do it deliberately once the
  app is proven, not at launch. NB: keep any future **telemetry-relay** subdomain
  **grey** — Cloudflare's proxy has websocket idle-timeout quirks.
- **Cloudflare Access** (free ≤50 users) is an alternative edge login gate that
  could replace the temp password gate if the website OAuth proves heavy — option
  to keep in mind, not the current plan (Discord-via-website is).
