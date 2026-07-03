"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatLapTime } from "@/lib/time";
import type { Benchmark, Track } from "@/types";

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [tracks, setTracks] = useState<Map<number, Track>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([api.benchmarks(), api.tracks()]);
    setBenchmarks(b);
    setTracks(new Map(t.map((x) => [x.id, x])));
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.syncBenchmarks();
      setMsg(result.message ?? "Sync complete.");
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
            Pace tiers from the public “Ohne Speed” LMU laptimes sheet. Press sync to pull the latest —
            new tracks/layouts are added automatically. {hasSeed && (
              <>
                Some rows are <span className="pill seed">seed</span> placeholders — a sync replaces them with live data.
              </>
            )}
          </div>
          <button className="btn" onClick={sync} disabled={busy}>
            {busy ? "Syncing…" : "Sync from Ohne Speed"}
          </button>
        </div>
        {msg && <div className="msg success">{msg}</div>}

        {benchmarks.length === 0 ? (
          <div className="empty">
            <div className="big">📊</div>
            <div style={{ fontWeight: 700 }}>No benchmarks yet</div>
            <div>Load sample data from #rankings, or sync from Google Sheets.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Class</th>
                  <th>Cond.</th>
                  <th>Alien</th>
                  <th>Competitive</th>
                  <th>Good</th>
                  <th>Midpack</th>
                  <th>Tail-ender</th>
                  <th className="num">Readiness</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => (
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
                    <td className="num">{b.data_readiness_pct.toFixed(0)}%</td>
                    <td>
                      {b.patch_version === "seed" ? <span className="pill seed">seed</span> : <span className="muted">{b.patch_version ?? "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
