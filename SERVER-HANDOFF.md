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

## Where things stand (updated 2026-07-12)
- **The app is DONE and pushed** — you're getting the latest by cloning.
- **⚠ THE BOX IS NOT EMPTY.** The team **website is already deployed and live on
  this same VPS** (`crosscurrentracing.com`) with a working Discord auth system,
  built in an earlier server session. That almost certainly means **Caddy is
  already installed and serving the website over HTTPS**, a Caddyfile already
  exists with a working website block, and Node and parts of the `/srv/ccr/`
  tree may already be present. **DO NOT treat this as a bare server and DO NOT
  follow DEPLOY.md's install steps blind** — inspect first (see step 0 below),
  then add only what's missing. Clobbering the existing Caddyfile or restarting
  Caddy with a broken config would take the LIVE website down.
- **This is the first real production deploy *of the data platform*.** Dev has
  only ever run on the JSON dev store; the first real PostgreSQL run has never
  been done. `DEPLOY.md`'s checklist *is* that smoke test.

## Your job (walk `DEPLOY.md`, but ADAPT it to the box's real state)
0. **Survey the box before changing anything.** Run and read the output of:
   `caddy version` + `cat /etc/caddy/Caddyfile` (the live website config — you
   will ADD to this, never replace it); `node --version`; `psql --version` and
   `systemctl status postgresql`; `pm2 list`; `ls -la /srv/ccr/`. Report what's
   already there to the user before installing anything.
1. Update the system (`apt update`; hold off on blanket upgrades if the website
   is serving — a kernel/service upgrade mid-session is a needless risk).
2. Create only the **missing** parts of the `/srv/ccr/` tree (see DEPLOY.md
   "Server file layout"). `website/` likely already exists — leave it alone.
3. Install **only what step 0 showed is missing** (PostgreSQL is the likely
   gap; Node and Caddy are probably already there from the website).
4. Clone `https://github.com/Slat3ruk/ccr-platform.git` into
   `/srv/ccr/data-platform`.
5. Create the DB + `npm run migrate`, then `npm install && npm run build`.
6. Run under pm2, **bound to localhost:3000**.
7. **Caddy: ADD a `data.crosscurrentracing.com` block to the EXISTING Caddyfile**
   (with the `basic_auth` gate — see DEPLOY.md §4). Never overwrite the file.
   `caddy validate --config /etc/caddy/Caddyfile` BEFORE reloading, and confirm
   the website still loads AFTER reloading.
8. Seed reference data, then verify: `GET /api/seed` must report
   `"backend": "postgres"` (not `json`), and a logged session must survive a
   `pm2 restart`. That's the finish line for this phase.

## ⛔ CRITICAL GUARDRAILS — do not cross without the user's explicit OK
- **⚠ A LIVE WEBSITE SHARES THIS BOX.** `crosscurrentracing.com` is already
  serving from this server. Do not restart, reconfigure, or upgrade any **shared**
  service (Caddy, Postgres if the website uses it, the network/firewall) without
  first confirming it won't drop the website. For Caddy specifically: only ever
  **append** a subdomain block, always `caddy validate` before reload, and load
  `crosscurrentracing.com` in a check right after. If a change to a shared
  service looks unavoidable, stop and ask the user first.
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
4. **Schedule the backup cron on day one AND run the restore round-trip test**
   (see DEPLOY.md "Backups & ops" — backup script, cron line, restore command,
   and the required scratch-DB restore test). Real data deserves a daily
   pg_dump from the first session logged, and the first restore must never be
   during an emergency.
5. **Data policy (user decision 2026-07-11): production starts CLEAN** — no
   migration of the local dev store's sessions. If the user changes their mind,
   a small export/replay script is the path (local JSON → POST /api/sessions).
6. Known quirk to mention to the team: drivers are auto-created by typed name,
   so spelling variations split a driver on the leaderboard — type your name
   consistently until Discord auth replaces free-text names.
7. **Wire the website → app link.** The user wants the app reachable from the
   live website's **Apps page → "Telemetry Logging" card → "Launch app" button**.
   The website source is on this box (`/srv/ccr/website/`) — find that button and
   point it at `https://data.crosscurrentracing.com` (open in a new tab is fine).
   Then reload/redeploy the website however it's served (if it's static under
   Caddy, just saving the file is enough; if it has a build step, run it) and
   **confirm both the website still loads AND the button opens the app.** NB the
   app is behind the shared-password gate for now, so clicking Launch will show a
   password prompt even for logged-in website users — that is EXPECTED until the
   verify layer lands, not a bug. ⚠ The user is **redesigning the website**; if a
   fresh design gets re-imported later it must keep this link — flag that to them
   and note it so the redesign carries it forward.

Then report the result to the user and stop. The next phases (team website +
Discord OAuth, the app-side auth verify layer, then public launch) are separate
jobs the user will direct — they are NOT part of this deploy.

## ⭐ NEXT PHASE PREP — write the auth contract (do this when the user asks, NOT during the deploy)
The **team website is already live on this same VPS with a WORKING Discord auth
system** (built in a separate server session). The data platform's next job is a
small **verify layer** that reads the website's shared cookie and enforces roles
server-side — but to build it correctly, the app side needs to know the exact
shape of what the website sets. **You are uniquely placed to document this: the
website's source is on this box** (under `/srv/ccr/website/`).

When the user is ready to tie the apps together, **produce `AUTH-CONTRACT.md` and
push it to the website repo** (and copy the same file into the data-platform repo
so both sessions see it). It must state, read from the live website's actual code
(don't guess):
- **Cookie**: exact name, domain/scope (must be `.crosscurrentracing.com` — the
  parent domain — or subdomains can't read it; flag it if it's host-only), Secure/
  HttpOnly/SameSite attributes, and lifetime.
- **Token format**: JWT? signed session id? opaque + a lookup endpoint? If a JWT,
  the signing algorithm and the claim names carrying the **Discord user id** and
  the **role** (driver/manager/admin), plus how Discord roles map to those three.
- **Secret**: where the signing secret / verification key lives on the box so the
  data platform's middleware can validate the token locally (shared secret via a
  file/env, or a public key, or a `/verify` HTTP endpoint on the website).
- **Membership gating**: does the website reject non-CCR-Discord members before
  ever issuing the cookie? (Determines whether the app must re-check membership.)

Once that file exists, the app-side verify middleware can be built against it (see
the ⭐ RELEASE PLAN in the data-platform `CLAUDE.md`), which retires BOTH the
client-side view-as toggle AND the temporary Caddy `basic_auth` gate.

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
