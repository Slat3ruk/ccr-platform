"use client";

// ============================================================================
// RaceCard — the full BLUF race card (eyebrow · track · pick · engineer's note
// · post/remove). Used for the FEATURED race AND every same-weekend sibling, so
// they render identically by construction. Self-contained note editor; each
// race posts to Discord on its own start time.
// ============================================================================

import { useState } from "react";
import { api } from "@/lib/api-client";
import { countdownLabel } from "@/lib/calendar";
import { confidenceTitle, fmtPct, fmtScore, scoreColor } from "@/lib/format";
import type { RaceRow, RankingRow } from "@/types";

function verdict(score: number): string {
  if (score >= 85) return "Top pick";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Viable";
  if (score >= 45) return "Marginal";
  return "Avoid";
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** Full local date+time in the viewer's timezone when a start time is set, else the day. */
function fmtRaceWhen(race: { event_date: string; start_at?: string | null }): string {
  if (race.start_at) {
    return new Date(race.start_at).toLocaleString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }
  return fmtDate(race.event_date);
}

export interface RaceCardProps {
  race: RaceRow;
  rankings: RankingRow[];
  daysUntil: number;
  isFeatured: boolean;
  weightsPreset?: string;
  canEdit: boolean;
  roleLabel: string;
  announcing: boolean;
  announceMsg: string | null;
  onAnnounce: () => void;
  onRemove: () => void;
  onChanged: () => void;
}

export default function RaceCard({
  race,
  rankings,
  daysUntil,
  isFeatured,
  weightsPreset,
  canEdit,
  roleLabel,
  announcing,
  announceMsg,
  onAnnounce,
  onRemove,
  onChanged,
}: RaceCardProps) {
  const top = rankings[0] ?? null;

  // Self-contained note editor.
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(race.note ?? "");
  const [noteBy, setNoteBy] = useState(race.note_by ?? "");
  const [savingNote, setSavingNote] = useState(false);

  async function saveNote() {
    setSavingNote(true);
    try {
      await api.updateRace(race.id, { note: noteDraft, note_by: noteBy || roleLabel });
      setEditing(false);
      onChanged();
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className={`bluf${isFeatured ? " bluf-live" : ""}`}>
      <div className="bluf-eyebrow">
        <span className={`bluf-badge${isFeatured ? " live" : ""}`}>{isFeatured ? "This weekend" : "Coming up"}</span>
        <span className="muted">
          {race.name ? `${race.name} · ` : ""}
          {fmtRaceWhen(race)} · {countdownLabel(daysUntil)}
          {race.start_at && <span className="hint"> · your local time</span>}
        </span>
      </div>

      <h2 className="bluf-track">
        {race.track_name}
        {race.class && <span className="pill" style={{ marginLeft: 10 }}>{race.class}</span>}
        {race.condition && <span className="pill" style={{ marginLeft: 6 }}>{race.condition}</span>}
      </h2>

      {top ? (
        <div className="bluf-rec">
          <div className="bluf-run">
            <span className="bluf-run-label">Run the</span>
            <span className="bluf-car">{top.car_name}</span>
            {top.weights_preset && (
              <span className="preset-tag" title={`Ranked using the ${top.weights_preset} weighting`}>
                <span className="tag-dot" />
                {top.weights_preset}
              </span>
            )}
          </div>
          <div className="bluf-stats">
            <span className="score-pill" style={{ background: scoreColor(top.car_score) }}>
              {fmtScore(top.car_score)}
            </span>
            <span className="pill" style={{ background: scoreColor(top.car_score), color: "#0c0c0c" }}>
              {verdict(top.car_score)}
            </span>
            <span className="muted">
              {top.car_category} ·{" "}
              <span title={confidenceTitle(top.confidence_score, top.sessions_used)} style={{ cursor: "help" }}>
                {fmtPct(top.confidence_score)} confidence
              </span>{" "}
              · {top.sessions_used} session{top.sessions_used === 1 ? "" : "s"}
            </span>
          </div>
          <div className="bluf-alts">
            {rankings.slice(1, 4).map((r, i) => (
              <span key={r.id} className="bluf-alt">
                <span className="muted">{i + 2}.</span> {r.car_name} <span className="muted">{fmtScore(r.car_score)}</span>
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Mathematically ranked from logged sessions using the{" "}
            <strong style={{ color: "var(--text-muted)" }}>{weightsPreset ?? top.weights_preset ?? "Balanced"}</strong>{" "}
            weighting.
          </div>
        </div>
      ) : (
        <div className="bluf-rec">
          <div className="muted">
            No ranked cars for this track{race.class ? ` in ${race.class}` : ""} yet — log some sessions on{" "}
            <a href="/log">#log-session</a> and the pick will appear here.
          </div>
        </div>
      )}

      {/* ---- Engineer note ---- */}
      <div className="bluf-note">
        <div className="flex spread" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>Engineer's note</strong>
          {canEdit && !editing && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setNoteDraft(race.note ?? "");
                setNoteBy(race.note_by ?? "");
                setEditing(true);
              }}
            >
              {race.note ? "Edit" : "Add note"}
            </button>
          )}
        </div>

        {editing ? (
          <div>
            <textarea
              rows={3}
              value={noteDraft}
              placeholder="e.g. Run the Ferrari 296 — smooth throttle out of the slow stuff, it protects the rears for a longer final stint."
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="flex" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="text"
                style={{ maxWidth: 200 }}
                placeholder={`Posted by (${roleLabel})`}
                value={noteBy}
                onChange={(e) => setNoteBy(e.target.value)}
              />
              <button className="btn btn-sm" disabled={savingNote} onClick={saveNote}>
                {savingNote ? "Saving…" : "Post note"}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={savingNote} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : race.note ? (
          <div>
            <div className="bluf-note-body">{race.note}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              — {race.note_by || "Engineer"}
              {race.note_updated_at ? ` · ${new Date(race.note_updated_at).toLocaleString()}` : ""}
            </div>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>No briefing note yet.</div>
        )}
      </div>

      {/* ---- Actions ---- */}
      {canEdit && (
        <div className="bluf-actions">
          <span className="flex" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={onAnnounce} disabled={announcing}>
              {announcing ? "Posting…" : "📢 Post to Discord"}
            </button>
            {announceMsg && <span style={{ fontSize: 13 }}>{announceMsg}</span>}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onRemove}>
            Remove from calendar
          </button>
        </div>
      )}
    </div>
  );
}
