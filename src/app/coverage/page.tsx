"use client";

// ============================================================================
// Test coverage map — "where are we blind?" A tracks × cars grid (per class +
// condition) coloured by how much CURRENT-ERA data each combo has. The board
// answers "which car is best where we have data"; this page directs the team's
// testing time at the combos the engine knows nothing about. Tracks with an
// upcoming race on the calendar are pinned to the top — close those gaps first.
// Managers/admins can PIN a cell as a test request (coverage v2) — it shows on
// the briefing and pings #testdrivers. Computed client-side from the existing
// APIs, era-scoped exactly like the live board.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { currentEra, currentEraRange, inRange } from "@/lib/eras";
import { useRole } from "@/lib/role";
import { categoryToClass, type Car, type Era, type RaceRow, type Session, type TestRequest, type Track } from "@/types";

const CLASSES = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS"];
const CONDITIONS = ["Dry", "Wet", "Mixed"];

interface CellStat {
  count: number;
  drivers: Set<number>;
  lastMs: number;
}

/** Coverage tier for a combo's session count (aligned with the ≥3 qualifying bar). */
function tier(count: number): { cls: string; label: string } {
  if (count === 0) return { cls: "cov-none", label: "no data" };
  if (count < 3) return { cls: "cov-thin", label: "thin — below the 3-run bar" };
  if (count < 6) return { cls: "cov-ok", label: "building" };
  return { cls: "cov-good", label: "solid" };
}

function daysAgo(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
}

export default function CoveragePage() {
  const [cars, setCars] = useState<Car[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [eras, setEras] = useState<Era[]>([]);
  const [races, setRaces] = useState<RaceRow[]>([]);
  const [requests, setRequests] = useState<TestRequest[]>([]);
  const [cls, setCls] = useState<string>("LMGT3");
  const [condition, setCondition] = useState<string>("Dry");
  const [loading, setLoading] = useState(true);
  const [pinBusy, setPinBusy] = useState<string | null>(null);

  const { role } = useRole();
  const canManage = role !== "driver";

  const loadRequests = useCallback(async () => {
    setRequests(await api.testRequests().catch(() => []));
  }, []);

  useEffect(() => {
    Promise.all([
      api.cars(),
      api.tracks(),
      api.sessions(),
      api.eras().catch(() => [] as Era[]),
      api.races().catch(() => [] as RaceRow[]),
      api.testRequests().catch(() => [] as TestRequest[]),
    ])
      .then(([c, t, s, e, r, tr]) => {
        setCars(c);
        setTracks(t);
        setSessions(s);
        setEras(e);
        setRaces(r);
        setRequests(tr);
      })
      .finally(() => setLoading(false));
  }, []);

  // (car|track|condition) → request, for O(1) pin lookup on each cell.
  const requestByKey = useMemo(() => {
    const m = new Map<string, TestRequest>();
    for (const r of requests) m.set(`${r.car_id}|${r.track_id}|${r.condition}`, r);
    return m;
  }, [requests]);

  const togglePin = useCallback(
    async (carId: number, trackId: number) => {
      if (!canManage) return;
      const key = `${carId}|${trackId}|${condition}`;
      if (pinBusy) return;
      setPinBusy(key);
      try {
        const existing = requestByKey.get(key);
        if (existing) await api.deleteTestRequest(existing.id);
        else await api.createTestRequest({ car_id: carId, track_id: trackId, condition, created_by: "Team" });
        await loadRequests();
      } finally {
        setPinBusy(null);
      }
    },
    [canManage, condition, pinBusy, requestByKey, loadRequests],
  );

  const nowMs = Date.now();
  const era = useMemo(() => currentEra(eras, nowMs), [eras, nowMs]);

  // Same scoping as the live board: only current-era sessions count as coverage.
  const eraSessions = useMemo(() => {
    const range = currentEraRange(eras, nowMs);
    return sessions.filter((s) => inRange(Date.parse(s.created_at), range));
  }, [sessions, eras, nowMs]);

  const classCars = useMemo(
    () => cars.filter((c) => categoryToClass(c.category) === cls).sort((a, b) => a.name.localeCompare(b.name)),
    [cars, cls],
  );

  // (car, track) → stats for the selected condition.
  const cells = useMemo(() => {
    const m = new Map<string, CellStat>();
    for (const s of eraSessions) {
      if (s.condition_reported !== condition) continue;
      const key = `${s.car_id}|${s.track_id}`;
      let cell = m.get(key);
      if (!cell) {
        cell = { count: 0, drivers: new Set(), lastMs: 0 };
        m.set(key, cell);
      }
      cell.count++;
      cell.drivers.add(s.driver_id);
      cell.lastMs = Math.max(cell.lastMs, Date.parse(s.created_at));
    }
    return m;
  }, [eraSessions, condition]);

  // Tracks with an upcoming race (today or later) float to the top.
  const upcomingByTrack = useMemo(() => {
    const m = new Map<number, RaceRow>();
    const today = new Date().toISOString().slice(0, 10);
    for (const r of races) {
      if (r.event_date < today) continue;
      const prev = m.get(r.track_id);
      if (!prev || r.event_date < prev.event_date) m.set(r.track_id, r);
    }
    return m;
  }, [races]);

  const orderedTracks = useMemo(
    () =>
      [...tracks].sort((a, b) => {
        const ra = upcomingByTrack.has(a.id) ? 0 : 1;
        const rb = upcomingByTrack.has(b.id) ? 0 : 1;
        return ra - rb || a.name.localeCompare(b.name);
      }),
    [tracks, upcomingByTrack],
  );

  // Headline numbers for the selected class/condition.
  const summary = useMemo(() => {
    const total = orderedTracks.length * classCars.length;
    let covered = 0;
    let thin = 0;
    for (const t of orderedTracks) {
      for (const c of classCars) {
        const n = cells.get(`${c.id}|${t.id}`)?.count ?? 0;
        if (n >= 3) covered++;
        else if (n > 0) thin++;
      }
    }
    return { total, covered, thin, empty: total - covered - thin };
  }, [orderedTracks, classCars, cells]);

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>coverage</h1>
        <span className="sub">
          where are we blind · era: {era ? era.name : "all data"} · {condition} · {cls}
        </span>
      </div>
      <div className="content">
        <div className="toolbar">
          <div className="field">
            <label>Class</label>
            <select value={cls} onChange={(e) => setCls(e.target.value)}>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="spacer" />
          <div className="cov-legend">
            <span>
              <i className="cov-swatch cov-none" /> none
            </span>
            <span>
              <i className="cov-swatch cov-thin" /> 1–2
            </span>
            <span>
              <i className="cov-swatch cov-ok" /> 3–5
            </span>
            <span>
              <i className="cov-swatch cov-good" /> 6+
            </span>
          </div>
        </div>

        <div className="msg" style={{ background: "var(--bg-card-2)", border: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
          <strong style={{ color: "var(--text-muted)" }}>
            {summary.covered}/{summary.total} combos at the 3-run bar
          </strong>{" "}
          · {summary.thin} thin · {summary.empty} with no data — the empty cells are where the engine is guessing.
          Sessions from before the current era don’t count (same scoping as the live board). 📅 = upcoming race.
          {canManage ? " Click a cell to flag a 📌 test request — it shows on the briefing and pings #testdrivers." : " 📌 = flagged for testing."}
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : classCars.length === 0 ? (
          <div className="empty">
            <div className="big">🚗</div>
            <div>No {cls} cars yet.</div>
          </div>
        ) : (
          <div className="table-wrap cov-wrap">
            <table className="rank cov-table">
              <thead>
                <tr>
                  <th className="cov-track-col">Track</th>
                  {classCars.map((c) => (
                    <th key={c.id} title={c.name}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedTracks.map((t) => {
                  const race = upcomingByTrack.get(t.id);
                  return (
                    <tr key={t.id} className={race ? "cov-race-row" : undefined}>
                      <td className="cov-track-col">
                        <span className="cov-track">
                          {race && (
                            <span title={`${race.name ?? "Race"} on ${race.event_date} — close these gaps first`}>📅 </span>
                          )}
                          {t.name}
                        </span>
                      </td>
                      {classCars.map((c) => {
                        const cell = cells.get(`${c.id}|${t.id}`);
                        const n = cell?.count ?? 0;
                        const tr = tier(n);
                        const pinned = requestByKey.has(`${c.id}|${t.id}|${condition}`);
                        const dataTitle =
                          n === 0
                            ? `${c.name} @ ${t.name} — no ${condition.toLowerCase()} data this era`
                            : `${c.name} @ ${t.name} — ${n} session${n === 1 ? "" : "s"} · ${cell!.drivers.size} driver${cell!.drivers.size === 1 ? "" : "s"} · last ${daysAgo(cell!.lastMs)} (${tr.label})`;
                        const title = canManage
                          ? `${dataTitle}\n\nClick to ${pinned ? "clear the" : "flag a"} test request.`
                          : pinned
                            ? `${dataTitle}\n\n📌 Flagged for testing.`
                            : dataTitle;
                        return (
                          <td
                            key={c.id}
                            className={`cov-cell ${tr.cls}${pinned ? " cov-pinned" : ""}${canManage ? " cov-clickable" : ""}`}
                            title={title}
                            onClick={canManage ? () => togglePin(c.id, t.id) : undefined}
                          >
                            {pinned && <span className="cov-pin">📌</span>}
                            {n === 0 ? "·" : n}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
