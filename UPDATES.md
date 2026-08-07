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

---

## PENDING — not yet on the box

**Last confirmed on production: `0c44996`** (the 2026-08-01 go-live).

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
**Verify:** edit any session, change or delete a lap time, save, reopen — the
change must persist. Paste a lap list containing an obvious out-lap; the average
should ignore it and the note should name which laps were dropped.
**Risk if skipped:** managers keep silently losing lap-time edits, and averages
stay inflated. Neither corrupts existing data.

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
