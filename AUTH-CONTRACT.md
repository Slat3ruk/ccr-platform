# CCR Auth Contract

What `ccr-auth.service` actually does, for any app on a `*.crosscurrentracing.com`
subdomain that needs to verify a logged-in member server-side (e.g. the
data-platform's verify layer, retiring its `basic_auth` gate). Derived by
reading the live source at `/srv/ccr/auth-service/server.js`, not written from
spec — if this drifts from that file, the file wins.

## Cookie

- Name: `cc_session`
- Domain: `.crosscurrentracing.com` (parent-scoped — subdomains receive it
  automatically once set on the apex)
- Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `path=/`, 30-day maxAge
- Set by `GET /api/auth/discord/callback` after a successful Discord OAuth
  exchange. Cleared by `POST /api/auth/logout` or automatically on a failed
  JWT verify.

## Token format

JWT (HS256, `jsonwebtoken` defaults), signed with `SESSION_SECRET`.

Claims: `{ sub: "<discord_user_id>", name: "<discord_username>" }` — **no
role claim**. Roles are never baked into the token; they're resolved live
(see below) on every request that asks.

## Secret

`SESSION_SECRET` lives in `/srv/ccr/auth-service/.env` (mode 600, owned by
`ccrauth`). It's an HMAC secret shared only within the auth service process —
**do not copy it into another app.** Verifying the JWT locally would only
recover `discord_id`/`name`; it would NOT give you role/membership, which
requires a second Discord Bot API call the auth service already makes (see
below). Copying the secret elsewhere just duplicates trust surface for no
benefit.

## How to verify (recommended path)

Call the already-running verify endpoint, forwarding the caller's `cc_session`
cookie, server-side, per request:

```
GET http://127.0.0.1:8787/api/auth/me
Cookie: cc_session=<value forwarded from the incoming request>
```

Reachable both internally (`127.0.0.1:8787`, same box) and externally via
`https://crosscurrentracing.com/api/auth/me` (proxied by the root Caddy
block's `reverse_proxy /api/* localhost:8787`). Prefer the internal address
from another same-box service — skips TLS and the public hop.

Response shape:

```json
{
  "authenticated": true,
  "id": "<discord_user_id>",
  "name": "<server nickname, falls back to Discord username if unset>",
  "isMember": true,
  "isManager": false,
  "isAdmin": false,
  "canManageRaces": false
}
```

Signed-out / invalid-token shape:

```json
{ "authenticated": false, "name": null, "isMember": false, "isManager": false, "isAdmin": false, "canManageRaces": false }
```

`name` surfaces the Discord **guild nickname** (`member.nick`) when the user
has one set, falling back to their global Discord username otherwise — added
2026-07-12 specifically so this contract could be built without shipping a
"free-text vs. Discord identity" mismatch to the verify layer.

## Membership gating — read this before writing any verify middleware

**The OAuth callback does NOT check guild membership before issuing the
cookie.** Any Discord account that completes the OAuth flow gets a valid
`cc_session`, whether or not they're in the CCR Discord server. Membership is
only known from the live lookup above (`isMember`), which does a
`GET /guilds/{guild}/members/{user}` call with the bot token and treats a 404
(not in the guild) — or any other non-2xx, e.g. a transient Discord API
hiccup — as "not a member" (fail closed, not an error).

**Consequence: a valid, non-expired `cc_session` cookie is not sufficient to
authorize anything.** A verify layer that only checks "cookie present and
JWT valid" will let non-members through. Always gate on `isMember` (or a
stricter tier) from the live response, never on cookie presence alone.

## Role → tier mapping

Source roles: `ROLE_ADMIN_ID`, `ROLE_MANAGER_ID`, `ROLE_MEMBER_ID` (Discord
role IDs, configured in the auth service's `.env`, not this app's).

```
isAdmin   = has ROLE_ADMIN_ID
isManager = has ROLE_MANAGER_ID
isMember  = has ROLE_MEMBER_ID OR isManager OR isAdmin
```

Recommended mapping to the data-platform's driver/manager/admin tiers:

- `isAdmin` → **admin**
- `isManager` (and not admin) → **manager**
- `isMember` (and not manager/admin) → **driver**
- `authenticated: false` OR `isMember: false` → **reject** (redirect to
  `/api/auth/discord/login?returnTo=<path>` on the main site, or 401 for an
  API call) — do NOT default an unauthenticated/non-member request to
  Driver. "Default to Driver" (see the data-platform's own CLAUDE.md) means
  *members with no elevated role*, not *anyone with a cookie*.

## Identity

Use the `id` field (Discord user id, JWT's `sub`) as the value for the
data-platform's existing-but-unused `discord_id` column — this is what
finally lets driver identity be keyed to Discord instead of typed free-text
names. Use `name` (now nickname-aware, see above) to pre-fill and lock the
log form's driver field from the verified session, rather than letting it be
typed.

## Logout

`POST /api/auth/logout` (no body) clears the cookie. No app-side session
state to clear elsewhere — the cookie is the only state.
