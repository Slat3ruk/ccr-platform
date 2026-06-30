// ============================================================================
// Seed dataset — the LMU car roster, track list, and PLACEHOLDER benchmark
// base times. Benchmarks here are approximate, generated to make the pace
// factor functional out of the box; they are replaced the first time the
// Google Sheets ("Ohne Speed") sync runs. data_readiness_pct is kept low and
// patch_version = "seed" so placeholder rows are obvious.
// ============================================================================

import type { CarCategory } from "@/types";

export interface SeedCar {
  name: string;
  category: CarCategory;
}

export interface SeedTrack {
  name: string;
  country?: string;
  /** Approximate LMH "alien" dry lap in seconds; class times derive from this. */
  lmhAlien: number;
}

export const SEED_CARS: SeedCar[] = [
  // Hypercar (LMH / LMDh)
  { name: "Toyota GR010 Hybrid", category: "Hypercar" },
  { name: "Ferrari 499P", category: "Hypercar" },
  { name: "Porsche 963", category: "Hypercar" },
  { name: "Cadillac V-Series.R", category: "Hypercar" },
  { name: "BMW M Hybrid V8", category: "Hypercar" },
  { name: "Peugeot 9X8", category: "Hypercar" },
  { name: "Alpine A424", category: "Hypercar" },
  { name: "Lamborghini SC63", category: "Hypercar" },
  { name: "Aston Martin Valkyrie", category: "Hypercar" },
  // GT3 (LMGT3)
  { name: "Porsche 911 GT3 R (992)", category: "GT3" },
  { name: "Ferrari 296 GT3", category: "GT3" },
  { name: "Chevrolet Corvette Z06 GT3.R", category: "GT3" },
  { name: "Aston Martin Vantage AMR GT3", category: "GT3" },
  { name: "BMW M4 GT3", category: "GT3" },
  { name: "Lamborghini Huracán GT3 EVO2", category: "GT3" },
  { name: "McLaren 720S GT3 EVO", category: "GT3" },
  { name: "Mercedes-AMG GT3", category: "GT3" },
  { name: "Ford Mustang GT3", category: "GT3" },
  { name: "Lexus RC F GT3", category: "GT3" },
  // LMP2
  { name: "Oreca 07 LMP2", category: "LMP2" },
  // LMP3
  { name: "Ligier JS P320", category: "LMP3" },
  { name: "Duqueine D09", category: "LMP3" },
  { name: "Ginetta G61-LT-P3", category: "LMP3" },
];

export const SEED_TRACKS: SeedTrack[] = [
  { name: "Circuit de la Sarthe (Le Mans)", country: "France", lmhAlien: 204 },
  { name: "Sebring International Raceway", country: "USA", lmhAlien: 108 },
  { name: "Autódromo Internacional do Algarve (Portimão)", country: "Portugal", lmhAlien: 87 },
  { name: "Circuit de Spa-Francorchamps", country: "Belgium", lmhAlien: 123 },
  { name: "Autodromo Nazionale Monza", country: "Italy", lmhAlien: 104 },
  { name: "Bahrain International Circuit", country: "Bahrain", lmhAlien: 101 },
  { name: "Fuji Speedway", country: "Japan", lmhAlien: 92 },
  { name: "Autodromo Enzo e Dino Ferrari (Imola)", country: "Italy", lmhAlien: 98 },
  { name: "Lusail International Circuit (Qatar)", country: "Qatar", lmhAlien: 98 },
  { name: "Autódromo José Carlos Pace (Interlagos)", country: "Brazil", lmhAlien: 74 },
  { name: "Circuit of the Americas (COTA)", country: "USA", lmhAlien: 112 },
  { name: "Silverstone Circuit", country: "UK", lmhAlien: 108 },
  { name: "Circuit Paul Ricard", country: "France", lmhAlien: 95 },
];

/** Class pace relative to the LMH alien base (rough, dry). */
export const CLASS_PACE_MULTIPLIER: Record<string, number> = {
  LMH: 1.0,
  "LMP2-ELMS": 1.06,
  "LMP2-WEC": 1.07,
  LMP3: 1.2,
  LMGT3: 1.16,
};

/** Tier multipliers vs the class "alien" time (SPEC §4). */
export const TIER_MULTIPLIER = {
  alien: 1.0,
  competitive: 1.01,
  good: 1.02,
  midpack: 1.035,
  tail_ender: 1.06,
  offline: 1.07,
} as const;

/** Classes we seed Dry benchmarks for (one per car category in use). */
export const SEED_BENCHMARK_CLASSES = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS"] as const;
