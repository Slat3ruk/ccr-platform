"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type WeightsPreset } from "@/lib/api-client";
import type { Role } from "@/lib/role";
import type { FactorWeights, WeightsConfig } from "@/types";

const FIELDS: { key: keyof FactorWeights; label: string }[] = [
  { key: "pace", label: "Pace" },
  { key: "consistency", label: "Consistency" },
  { key: "tyre", label: "Tyre" },
  { key: "drivability", label: "Drivability" },
  { key: "mistakes", label: "Mistakes" },
];

const CUSTOM = "__custom";

/** Percentages (0–100) from a weights object. */
function toPct(w: FactorWeights): Record<keyof FactorWeights, number> {
  return {
    pace: Math.round(w.pace * 100),
    consistency: Math.round(w.consistency * 100),
    tyre: Math.round(w.tyre * 100),
    drivability: Math.round(w.drivability * 100),
    mistakes: Math.round(w.mistakes * 100),
  };
}

export default function WeightsControl({
  role,
  active,
  onApplied,
}: {
  role: Role;
  active: WeightsConfig | null;
  onApplied: () => void;
}) {
  const [presets, setPresets] = useState<WeightsPreset[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<keyof FactorWeights, number>>({
    pace: 35,
    consistency: 25,
    tyre: 15,
    drivability: 15,
    mistakes: 10,
  });

  useEffect(() => {
    api
      .weights()
      .then((r) => setPresets(r.presets))
      .catch(() => {});
  }, []);

  const canEdit = role !== "driver";
  const presetNames = useMemo(() => presets.map((p) => p.name), [presets]);
  const isKnown = active ? presetNames.includes(active.preset) : true;
  const selectValue = active ? (isKnown ? active.preset : CUSTOM) : "Balanced";

  const draftTotal = FIELDS.reduce((sum, f) => sum + draft[f.key], 0);

  async function applyPreset(name: string) {
    setBusy(true);
    try {
      await api.setWeights({ preset: name });
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  function openPanel() {
    if (active) setDraft(toPct(active.weights));
    setOpen(true);
  }

  async function applyCustom() {
    setBusy(true);
    try {
      // Send raw values; the server normalises to sum 1.
      await api.setWeights({ preset: "Custom", weights: { ...draft } });
      onApplied();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // Drivers just see the active weighting, read-only.
  if (!canEdit) {
    return (
      <div className="field" style={{ minWidth: 0 }}>
        <label>Weighting</label>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
          {active?.preset ?? "Balanced"}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="field" style={{ minWidth: 168 }}>
        <label>Weighting</label>
        <div className="flex" style={{ gap: 6 }}>
          <select
            value={selectValue}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM) openPanel();
              else applyPreset(v);
            }}
          >
            {presets.map((p) => (
              <option key={p.name} value={p.name} title={p.hint}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Fine-tune the factor weights"
            onClick={() => (open ? setOpen(false) : openPanel())}
          >
            ⚙
          </button>
        </div>
      </div>

      {open && (
        <div className="weights-panel">
          <div className="flex spread" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Custom weighting</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              Scores stay 0–100 — values are normalised to 100% on apply.
            </span>
          </div>
          <div className="weights-sliders">
            {FIELDS.map((f) => {
              const pct = draftTotal > 0 ? Math.round((draft[f.key] / draftTotal) * 100) : 0;
              return (
                <div className="weights-slider" key={f.key}>
                  <div className="ws-head">
                    <span>{f.label}</span>
                    <span className="ws-val">{pct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-sm" disabled={busy || draftTotal <= 0} onClick={applyCustom}>
              {busy ? "Applying…" : "Apply & recompute"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
