"use client";

// Preset-winners strip: the top car under each weighting preset, computed
// client-side from the loaded factor scores. Chips whose winner differs from
// Balanced are highlighted — those are the genuinely interesting ones (a car the
// default weighting hides). Click a chip to view the whole board that way.

export interface PresetWinner {
  preset: string;
  car_name: string;
  car_id: number;
  score: number;
}

export default function PresetWinners({
  winners,
  lens,
  onPick,
}: {
  winners: PresetWinner[];
  lens: string;
  onPick: (preset: string) => void;
}) {
  if (winners.length === 0) return null;
  const balancedId = winners.find((w) => w.preset === "Balanced")?.car_id ?? -1;
  const allSame = winners.every((w) => w.car_id === balancedId);

  return (
    <div className="preset-winners">
      <div className="pw-head">
        <span className="pw-title">Preset winners</span>
        <span className="pw-sub">
          {allSame ? "one car tops every lens — it's just the best here" : "top car under each weighting · highlighted = differs from Balanced"}
        </span>
      </div>
      <div className="pw-chips">
        {winners.map((w) => {
          const differs = w.car_id !== balancedId;
          const active = lens === w.preset || (lens === "" && w.preset === "Balanced");
          return (
            <button
              key={w.preset}
              type="button"
              className={`pw-chip${differs ? " differs" : ""}${active ? " active" : ""}`}
              title={`Top car under ${w.preset}${differs ? " — a car the Balanced weighting hides" : ""}. Click to view the board this way.`}
              onClick={() => onPick(active && lens ? "" : w.preset)}
            >
              <span className="pw-preset">{w.preset}</span>
              <span className="pw-car">{w.car_name}</span>
              <span className="pw-score">{Math.round(w.score)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
