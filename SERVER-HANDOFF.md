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
- **DO NOT expose this publicly.** No DNS records, no public Caddy binding, no
  handing anyone the address. **The app has NO real authentication yet** — it uses
  a client-side "view-as" role toggle, so *anyone who can reach the URL can become
  Admin and purge all data.* Keep it localhost-only / unlisted until the auth
  **verify layer** + the team website's Discord OAuth are built (a later phase —
  see the ⭐ RELEASE PLAN in `CLAUDE.md`). Getting it *running privately* is the
  whole goal for now.
- **DO NOT follow third-party server-hardening guides.** The user's first server
  was bricked by one (it disabled all login methods before a key was installed).
  Do hardening yourself, from inside, **testing that SSH still works before and
  after each change** so you never lock the user out.
- **Stop and ask before anything irreversible** — data deletion, DNS, firewall
  rules that could sever your own SSH, spending decisions.
- **git is the bridge.** Anything you fix on the box, commit and push so it stays
  in sync with the user's PC. Commit style: end messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## After the smoke test passes
Report the result to the user and stop. The next phases (team website + Discord
OAuth, the app-side auth verify layer, then public launch) are separate jobs the
user will direct — they are NOT part of this deploy.
