# Update log — data platform

Running record of what has shipped to `data.crosscurrentracing.com` since it went
live (2026-08-01), and what is waiting to. **The deploy is done — everything here
is an update.** Procedure: "Ship an update" in `DEPLOY.md`.

Newest first. An entry moves from PENDING to SHIPPED once it is confirmed on the
box, not when it is pushed.

**To see what is actually outstanding at any moment** — this is the source of
truth, not the list below, which a human has to remember to update:
```bash
git fetch origin
git log --oneline <last-shipped-sha>..origin/master          # what is waiting
git diff --name-only <last-shipped-sha>..origin/master -- db/ # empty = no migration
```

Each entry states three things, because they are what the person shipping needs:
**what changed**, **whether it needs anything beyond the standard recipe**, and
**how to tell it worked**.

> ### ✍️ Writing a verify step — the rule
> **State an observable outcome with exact inputs and expected values, never
> "check the fix works".** Whoever ships this cannot tell whether a fix *works* —
> they weren't there when it was written and don't know what correct looks like.
> They can tell whether a lap time survived a reload, or whether a field reads
> `1:40.360`.
> Where possible give the **pre-fix value too**, so a stale build is
> distinguishable from a working one: seeing the old number is positive evidence
> the update never reached the box, which "it looks fine" can never provide.
> (Rule contributed by the website session, 2026-08-01.)

---

## PENDING — not yet on the box

**Last confirmed on production: `0c44996`** (the 2026-08-01 go-live).

### `5a8a093` — Driver identity: follow Discord renames, stop log-on-behalf duplicating people
**Code change, no schema change.** Fixes the "same person appears twice on the
leaderboard" problem at its actual source.

- **Names now follow the Discord server nickname.** Previously the stored name
  was frozen at first login, so the board drifted out of step with the server.
  Identity was already `discord_id`, so a rename never split anyone on the
  self-logging path — but the name never caught up either.
- **Log-on-behalf no longer creates duplicates.** The roster dropdown offers
  *current* Discord names while the API resolved the driver by **name** — so a
  teammate whose stored name had drifted got a brand-new row. Both `POST` and
  `PUT /api/sessions` now resolve by `discord_id` when the client can supply
  one, falling back to a name lookup only for a genuinely unknown name.
- ⚠ **This also fixes the workaround that was making it worse.** There is no
  rename feature in this app (`/api/drivers` is GET-only). "Renaming" someone by
  editing a session's driver field resolved by name and therefore **created a
  second driver**, moving one session to it. That path now resolves by identity.

**Needs beyond the standard recipe:** nothing. No migration, no sync.

**Verify — observable outcomes with exact expectations:**
1. *Names follow Discord.* Change your own nickname in the CCR Discord server,
   then log a session. **Expected:** the Drivers board shows the NEW name on your
   existing row, with your session history intact.
   **Before this update the board kept the old name indefinitely.**
2. *Log-on-behalf attaches to the real person.* As manager/admin, log a session
   for a teammate using the roster dropdown. **Expected:** `GET /api/drivers`
   contains exactly one row for that person, and their session count went up by
   one. **Before, a teammate whose name had drifted gained a SECOND row and the
   new session went to the wrong one.**

**Risk if skipped:** duplicate drivers keep accumulating on the leaderboard, and
each one silently splits a real person's history. The failure is invisible at the
moment it happens — it only shows up later as a driver whose stats look wrong.

⚠ **Does NOT merge duplicates that already exist.** This stops new ones being
created; any pair already on the board stays until someone merges them
deliberately. That is a separate job and moves real session data, so it should
not be bundled into a routine update.

### `123b03c` — Fix: session edits discarded lap times; average included out-laps
**Two user-reported bugs. Code change, no schema change.**

- **Editing a session silently discarded lap-time changes.** `PUT
  /api/sessions/:id` omitted `lap_times`, `fuel_per_lap` and `ve_per_lap`, and
  the store only writes keys present in the patch — so edits to those fields
  reverted while `best`/`avg` saved. Sessions could end up with edited averages
  against their original lap array, and consistency scored off the stale one.
- **The pasted-laps average included out-laps and traffic laps.** Only σ used the
  cleaned set, while the form said "excluded from consistency" beside an average
  that had excluded nothing. Now uses the cleaned set — measured 1:43.157 →
  1:40.360 on a real 7-lap paste. Best lap and lap count still use every lap, by
  design; the form now explains that.

**Needs beyond the standard recipe:** nothing. No migration, no sync.

**Verify — stated as observable outcomes, with exact inputs and expected values,
so someone who wasn't part of building it can run them:**

1. *Lap edits persist.* Open any logged session → Edit → change one lap time in
   the pasted list (or delete a line) → Save → reopen that same session.
   **Expected:** the lap list shows your change.
   **Before the fix it showed the ORIGINAL list** — the save reported success and
   the laps reverted, which is the whole bug.
2. *Average ignores out-laps.* On the log form, paste exactly:
   ```
   1:40.000
   1:40.500
   1:40.200
   1:40.800
   1:40.300
   1:52.400
   1:47.900
   ```
   **Expected, exactly:** best `1:40.000` · average `1:40.360` · laps completed
   `7`, and a note reading *"2 laps excluded … lap 6 1:52.400 · lap 7 1:47.900"*.
   **Before the fix the average read `1:43.157`.** If you see that figure, the
   update did not reach the box.

**Risk if skipped:** managers keep silently losing lap-time edits — the failure
is invisible, so it will not be reported as a bug, it will just quietly produce
sessions whose stored average disagrees with their own lap array. Averages also
stay inflated by out-laps. Neither corrupts existing data.

### `e15199e` — Docs: reframe ongoing procedure as "ship an update"
Documentation only — no runtime change, nothing to verify. Retitled `DEPLOY.md`,
marked the first-install steps and the go-live statement as history so they
cannot be mistaken for a task list, and renamed the recipe to "Ship an update".
Ships free alongside anything else.

---

## SHIPPED

### `0c44996` — 2026-08-01 go-live
The catch-up deploy. Full record in `DEPLOY.md` under "HISTORY — deployment
statement". Verified in production: `totalKm` live, `kmCoverage.complete` true
across all logged laps, Wet benchmarks present, Daytona + Laguna Seca present.
