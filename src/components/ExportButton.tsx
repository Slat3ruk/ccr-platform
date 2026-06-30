"use client";

import type { RankingRow } from "@/types";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: RankingRow[]): string {
  const header = [
    "rank", "car", "category", "track", "class", "condition", "car_score",
    "pace", "consistency", "tyre", "drivability", "mistakes",
    "sessions_used", "confidence",
  ];
  const lines = rows.map((r, i) =>
    [
      i + 1,
      `"${r.car_name}"`,
      r.car_category,
      `"${r.track_name}"`,
      r.class,
      r.condition,
      r.car_score,
      r.pace_factor,
      r.consistency_factor,
      r.tyre_factor,
      r.drivability_factor,
      r.mistakes_factor,
      r.sessions_used,
      r.confidence_score,
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export default function ExportButton({ rows, label = "rankings" }: { rows: RankingRow[]; label?: string }) {
  const disabled = rows.length === 0;
  return (
    <div className="flex" style={{ gap: 8 }}>
      <button
        className="btn btn-ghost btn-sm"
        disabled={disabled}
        onClick={() => download(`ccr-${label}.json`, JSON.stringify(rows, null, 2), "application/json")}
      >
        Export JSON
      </button>
      <button
        className="btn btn-ghost btn-sm"
        disabled={disabled}
        onClick={() => download(`ccr-${label}.csv`, toCsv(rows), "text/csv")}
      >
        Export CSV
      </button>
    </div>
  );
}
