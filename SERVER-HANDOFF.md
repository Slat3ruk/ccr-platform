# HISTORY — first-deploy handoff (SPENT, do not follow as instructions)

> ## ⛔ THIS FILE IS NO LONGER A TASK LIST.
>
> It briefed the one-time go-live, which **completed and was verified on
> 2026-08-01**. `data.crosscurrentracing.com` runs on PostgreSQL with real
> drivers logging. Its job list (provision, install, clone, seed) and its launch
> checklist have all been done. **Following them now would re-run first-time
> setup against a live database.**
>
> **→ Shipping a change is "Ship an update" in `DEPLOY.md`.** That is the only
> live procedure.
>
> **Still worth reading here, and only these:**
> - the **CRITICAL GUARDRAILS** — a live website shares this box, and the "never
>   overwrite the Caddyfile / validate before reload" rules still bind;
> - **"Where things stand"** — why production is not a bare server;
> - the **Cloudflare gotcha**, if certificates ever misbehave;
> - the **post-launch backlog** at the end, which is genuinely still open.
>
> Everything else is a record of how production came to exist.

**Original briefing follows.** It addressed a fresh Claude Code session running
ON the production server (Hetzner CX33, Helsinki, Ubuntu 24.04, hostname
`CrossCurrentRacing`) with no prior context.

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
- **⚠⚠ THE DATA PLATFORM IS ALREADY DEPLOYED AND RUNNING ON POSTGRESQL. THIS IS
  AN UPDATE, NOT A FIRST DEPLOY.** (Corrected 2026-07-29 — this file previously
  said the opposite, and following it would have been actively dangerous.)
  Evidence, not assumption: **8 commits in this repo are authored `Claude Code
  (deploy)` from the box itself** (2026-07-12/13), including the Discord verify
  middleware (`7952a33`), the roster log-on-behalf dropdown (`a917eb4`), the
  benchmarks Dry/Wet grouping (`8cc04ba`) and the Ohne Speed column-mapping fix
  (`279a09a`) — that last one could only have been developed against a live,
  syncing database.
  **CONSEQUENCES YOU MUST RESPECT:**
  1. **There may be REAL LOGGED DATA.** Back the database up BEFORE migrating —
     this is no longer a formality (see DEPLOY.md "Backups & ops").
  2. **Do NOT treat the production DB as blank.** The launch checklist below was
     written for a fresh install; several items (patch, webhooks, wet penalty)
     may already be configured. **Check each one before setting it** — silently
     overwriting live settings is the failure mode here.
  3. **PostgreSQL is PROVEN, not unknown.** Earlier revisions of this file
     treated the first Postgres run as the headline risk. It isn't; the app has
     been running on it for weeks. The scoring smoke test below is still worth
     doing — it now proves THIS UPDATE didn't break scoring, rather than proving
     Postgres works at all.
  4. **Steps 1-4 below (install Node/Postgres/Caddy, clone) are mostly already
     done.** Step 0's survey tells you which. For an existing install the real
     sequence is the "Deploy an update" recipe in DEPLOY.md: reconcile → pull →
     install → **migrate** → build → restart → sync.

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
   `pm2 restart`. **Then do a FULL reboot test** (`sudo reboot`; wait; SSH back
   in): confirm the app AND Postgres came back **on their own** and the logged
   session is still there — this proves `pm2 save && pm2 startup` and Postgres
   auto-start actually work (they can silently not register, and you'd only find
   out when the box reboots unattended weeks later). ⚠ Warn the user before you
   reboot — your own SSH session drops for ~30-60s.
9. **⚠ PROVE SCORING WORKS, not just persistence — the real finish line.**
   ⚠ ORDERING: this step needs the Ohne Speed sync, which is item **3a of the
   LAUNCH CHECKLIST below**, not part of this job list. So the true sequence is
   steps 0-8 here → launch-checklist items 1, 2, 3a → then come back and do this.
   Doing it before the sync still "passes" (a Dry session scores fine) while
   leaving the wet path unproven, which is exactly the gap this step exists to
   close.
   Everything above proves rows survive. None of it proves the app can *score*,
   and **this is the first time any of this code has run on PostgreSQL** — the
   whole app has only ever been exercised against the JSON dev store, and every
   store method is a separate SQL implementation. Structurally verified, never
   executed.
   After the §3a sync, log **two sessions on the same car+track — one `Dry`, one
   `Wet`** — then confirm each appears in
   `GET /api/rankings?track_id=<ID>&class=<CLASS>&condition=<Dry|Wet>` with a
   non-null `car_score`.
   That single exercise covers what is most likely to break on first contact with
   real SQL: `getOrCreateDriverByDiscordId` (identity binding, hit on every
   write), the session insert, `recomputeAll`, benchmark lookup and the tyre join.
   ⚠ **A wet session still scores when wet benchmarks are missing** — recompute
   silently falls back to the Dry benchmark. So a score here does NOT prove the
   wet path is healthy. You need BOTH this and the `"condition": "Wet"` rows from
   step 3a; a score with no Wet rows means wet running is being judged against
   dry pace.
   Delete the two test sessions afterwards (production starts clean — see item 5)
   and say so to the user, so nobody later mistakes them for real data.

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

> ⚠⚠ **THIS LIST WAS WRITTEN FOR A BLANK DATABASE AND THE DATABASE IS NO LONGER
> BLANK.** (Corrected 2026-07-29 — the data platform has been live on Postgres
> since ~2026-07-12; see "Where things stand".) Items 1-3 SET configuration.
> On a live install, **read the current value first and only change it if it is
> actually wrong or missing.** Blindly re-running them overwrites live settings
> — e.g. re-setting the patch with the draw-a-line box ticked would draw a
> spurious comparability line and rescore real sessions.
> Treat every item below as **check, then act** rather than **do**.
> ⚠ Item 5's "production starts CLEAN" is likewise obsolete: there may be real
> logged sessions now. **Back up before migrating.**

Walk these with the user in the control panel:
1. **Set the current patch** (e.g. `1.3.3.4` — check Steam for the latest) so new
   sessions are patch-stamped. No line needed (fresh DB, nothing to scope).
2. **Reconnect the three Discord webhooks** (race / test / board) — the user has
   the URLs in their Discord server's channel settings. Use each slot's "Test"
   button to verify (this is a sanctioned test post).
3. Wet penalty + weighting are back to defaults (8%, Balanced) — fine unless the
   user wants their tuning back.
3a. **⚠ RUN "SYNC FROM OHNE SPEED" (control panel → Benchmarks). NOT OPTIONAL —
   the user asked for this explicitly.** Seeding alone leaves the DB with **no
   Wet benchmarks at all**: the seed file is Dry-only and Wet is *derived*, but
   that derivation runs only inside the sync (or a wet-penalty save), never
   inside seeding. Until it runs, wet sessions silently fall back to the **Dry**
   benchmark and every wet driver is scored against dry pace — no error, just
   wrong numbers. The sync also pulls whatever the sheet has gained since the
   seed snapshot (2026-07-29) and auto-creates those circuits.
   **Verify:** the response reports `upserted` (≈155+) plus any `created_tracks`,
   and `GET /api/benchmarks` then contains rows with `"condition": "Wet"`. No Wet
   rows = the sync didn't complete and wet scoring is still wrong.
   ⚠ This posts "new tracks from a sync" to the #testdrivers webhook — expected
   and harmless, but do it AFTER step 2 so the user isn't surprised by it.
4. **Schedule the backup cron on day one AND run the restore round-trip test**
   (see DEPLOY.md "Backups & ops" — backup script, cron line, restore command,
   and the required scratch-DB restore test). Real data deserves a daily
   pg_dump from the first session logged, and the first restore must never be
   during an emergency.
5. ~~**Data policy: production starts CLEAN**~~ — **SPENT. That decision applied
   to the original deploy, which has already happened.** Production may now hold
   real logged sessions, so the operative rules are the opposite ones:
   **never seed or purge on the assumption it is empty, and back up before
   migrating.** The local dev store is still NOT migrated up; it is test data.
   If the user ever wants a fresh start, that is the Danger Zone purge — a
   deliberate, admin-only act, never a deploy step.
6. ~~Known quirk: drivers are auto-created by typed name, so spelling variations
   split a driver on the leaderboard.~~ **MOSTLY OBSOLETE — the Discord verify
   layer landed.** A driver logging their own session is now keyed to their
   `discord_id` (`getOrCreateDriverByDiscordId`), so their own spelling cannot
   split them, and a driver attempting to log under anyone else's name gets a
   403. The name-based path survives ONLY for manager/admin **log-on-behalf**,
   which takes names from the roster dropdown rather than free text. Nothing to
   warn the team about; noted so the old advice isn't repeated.
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

### Ops hygiene (minor, deferred by the user 2026-07-12 — none are launch-blockers)
- **pm2 log rotation** — `pm2 install pm2-logrotate`. Without it pm2's logs grow
  unbounded and can slowly fill the disk over months. One command, do it early in
  the post-launch tidy. (The website's pm2, if any, wants this too.)
- **Firewall (ufw)** — the website already serves, so 22/80/443 are effectively
  open; there's no formal ufw policy yet. When hardening, allow 22 (SSH), 80 +
  443 (Caddy/ACME) and default-deny the rest — **but do it from inside, testing
  SSH still works before AND after each change** (the user's first server was
  bricked by a hardening step that cut all login paths). Confirm the LIVE website
  still loads after enabling.
- **Uptime monitoring** — a free external pinger (UptimeRobot / Better Uptime) on
  `data.crosscurrentracing.com` (and the website) so a drop is noticed before a
  driver reports it. ~5 min, no server install.
- **Drop the unused `NEXT_PUBLIC_API_URL`** from `.env.example` — the app uses
  relative `/api/...` fetches and never reads that var (verified 2026-07-12), so
  it's dead config that could mislead a future deployer. Cosmetic cleanup.
