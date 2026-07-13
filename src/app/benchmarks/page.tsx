"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { formatLapTime } from "@/lib/time";
import { useRole } from "@/lib/role";
import { CONDITIONS, RACING_CLASSES, type Benchmark, type Track } from "@/types";

// Default view groups Dry together, then Wet, then anything else — each
// block alphabetical by track (then class) within itself. A personal
// viewing lens, same for every role; the only other control on this page
// is the track/class/condition filter below, also available to everyone.
const CONDITION_RANK: Record<string, number> = { Dry: 0, Wet: 1, Mixed: 2 };

export default function BenchmarksPage() {
  const { role } = useRole();
  const isAdmin = role === "admin";
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [tracks, setTracks] = useState<Map<number, Track>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([api.benchmarks(), api.tracks()]);
    setBenchmarks(b);
    setTracks(new Map(t.map((x) => [x.id, x])));
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const trackOptions = useMemo(() => {
    const ids = new Set(benchmarks.map((b) => b.track_id));
    return Array.from(ids)
      .map((id) => ({ id, name: tracks.get(id)?.name ?? `Track #${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [benchmarks, tracks]);

  const visible = useMemo(() => {
    const filtered = benchmarks.filter(
      (b) =>
        (trackFilter === "all" || String(b.track_id) === trackFilter) &&
        (classFilter === "all" || b.class === classFilter) &&
        (conditionFilter === "all" || b.condition === conditionFilter),
    );
    return [...filtered].sort((a, b) => {
      const condDiff = (CONDITION_RANK[a.condition] ?? 99) - (CONDITION_RANK[b.condition] ?? 99);
      if (condDiff !== 0) return condDiff;
      const nameDiff = (tracks.get(a.track_id)?.name ?? "").localeCompare(tracks.get(b.track_id)?.name ?? "");
      if (nameDiff !== 0) return nameDiff;
      return a.class.localeCompare(b.class);
    });
  }, [benchmarks, tracks, trackFilter, classFilter, conditionFilter]);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.syncBenchmarks();
      const lastUpdated = result.sheet_last_updated
        ? ` Sheet's own “last updated” note: ${result.sheet_last_updated}.`
        : "";
      setMsg((result.message ?? "Sync complete.") + lastUpdated);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  const hasSeed = benchmarks.some((b) => b.patch_version === "seed");

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>benchmarks</h1>
        <span className="sub">{benchmarks.length} tiers cached</span>
      </div>
      <div className="content">
        <div className="flex spread" style={{ marginBottom: 16 }}>
          <div className="muted" style={{ fontSize: 13, maxWidth: 560 }}>
            Pace tiers from the public “Ohne Speed” LMU laptimes sheet.{" "}
            {isAdmin ? "Press sync to pull the latest — new tracks/layouts are added automatically." : "An admin syncs these from the control panel."}{" "}
            {hasSeed && (
              <>
                Some rows are <span className="pill seed">seed</span> placeholders — a sync replaces them with live data.
              </>
            )}
          </div>
          {isAdmin && (
            <button className="btn" onClick={sync} disabled={busy}>
              {busy ? "Syncing…" : "Sync from Ohne Speed"}
            </button>
          )}
        </div>
        {msg && <div className="msg success">{msg}</div>}

        {benchmarks.length === 0 ? (
          <div className="empty">
            <div className="big">📊</div>
            <div style={{ fontWeight: 700 }}>No benchmarks yet</div>
            <div>Load reference data from #rankings, or sync from Google Sheets.</div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="field">
                <label>Track</label>
                <select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
                  <option value="all">All tracks</option>
                  {trackOptions.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Class</label>
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                  <option value="all">All classes</option>
                  {RACING_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Condition</label>
                <select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
                  <option value="all">All conditions</option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="spacer" />
              <div className="muted" style={{ fontSize: 13 }}>
                {visible.length} of {benchmarks.length}
              </div>
            </div>
            <div className="table-wrap">
              <table className="rank">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Class</th>
                    <th>Cond.</th>
                    <th title="~100%">Alien</th>
                    <th title="101%">Competitive</th>
                    <th title="102–103%">Good</th>
                    <th title="104–105%">Midpack</th>
                    <th title="106%">Tail-ender</th>
                    <th title="107%">Offline</th>
                    <th className="num">Readiness</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => (
                    <tr key={b.id} style={{ cursor: "default" }}>
                      <td>{tracks.get(b.track_id)?.name ?? `#${b.track_id}`}</td>
                      <td>
                        <span className="pill">{b.class}</span>
                      </td>
                      <td>{b.condition}</td>
                      <td>{formatLapTime(b.alien_time)}</td>
                      <td>{formatLapTime(b.competitive_time)}</td>
                      <td>{formatLapTime(b.good_time)}</td>
                      <td>{formatLapTime(b.midpack_time)}</td>
                      <td>{formatLapTime(b.tail_ender_time)}</td>
                      <td>{formatLapTime(b.offline_time)}</td>
                      <td className="num">{b.data_readiness_pct.toFixed(0)}%</td>
                      <td>
                        {b.patch_version === "seed" ? <span className="pill seed">seed</span> : <span className="muted">{b.patch_version ?? "—"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
