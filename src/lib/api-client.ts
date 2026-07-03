// ============================================================================
// Tiny typed fetch wrappers used by the client components. All calls are
// same-origin to the Next.js API routes.
// ============================================================================

import type {
  Benchmark,
  Car,
  Era,
  FactorWeights,
  NewEraInput,
  NewRaceInput,
  RaceRow,
  RankingRow,
  Session,
  SessionInput,
  Track,
  WeightsConfig,
} from "@/types";

export interface WeightsPreset {
  name: string;
  hint: string;
  weights: FactorWeights;
}

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function jsend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${method} ${url} → ${res.status}`);
  return json as T;
}

export const api = {
  cars: () => jget<Car[]>("/api/cars"),
  tracks: () => jget<Track[]>("/api/tracks"),
  benchmarks: () => jget<Benchmark[]>("/api/benchmarks"),

  rankings: (params: { track_id?: number; class?: string; condition?: string; era_id?: number | "pre" } = {}) => {
    const q = new URLSearchParams();
    if (params.track_id != null) q.set("track_id", String(params.track_id));
    if (params.class) q.set("class", params.class);
    if (params.condition) q.set("condition", params.condition);
    if (params.era_id != null) q.set("era_id", String(params.era_id));
    const qs = q.toString();
    return jget<RankingRow[]>(`/api/rankings${qs ? `?${qs}` : ""}`);
  },

  sessions: (params: { car_id?: number; track_id?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.car_id != null) q.set("car_id", String(params.car_id));
    if (params.track_id != null) q.set("track_id", String(params.track_id));
    if (params.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<Session[]>(`/api/sessions${qs ? `?${qs}` : ""}`);
  },

  status: () => jget<{ backend: string; counts: Record<string, number> }>("/api/seed"),

  async seed() {
    const res = await fetch("/api/seed", { method: "POST" });
    return res.json();
  },

  async createSession(input: SessionInput) {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) {
      const details: string[] = json.details ?? [json.error ?? "Request failed"];
      throw new Error(details.join("\n"));
    }
    return json;
  },

  async updateSession(id: number, input: SessionInput) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) {
      const details: string[] = json.details ?? [json.error ?? "Request failed"];
      throw new Error(details.join("\n"));
    }
    return json;
  },

  async deleteSession(id: number) {
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    return res.json();
  },

  async syncBenchmarks() {
    const res = await fetch("/api/benchmarks/sync", { method: "POST" });
    return res.json();
  },

  async recompute() {
    const res = await fetch("/api/rankings/recompute", { method: "POST" });
    return res.json();
  },

  // weighting -----------------------------------------------------------------
  weights: () => jget<{ active: WeightsConfig; presets: WeightsPreset[] }>("/api/rankings/weights"),

  setWeights: (body: { preset?: string; weights?: FactorWeights }) =>
    jsend<{ ok: true; active: WeightsConfig; recompute: unknown }>("/api/rankings/weights", "POST", body),

  // eras ------------------------------------------------------------------------
  eras: () => jget<Era[]>("/api/eras"),

  createEra: (input: NewEraInput) => jsend<{ ok: true; era: Era; recompute: unknown }>("/api/eras", "POST", input),

  deleteEra: (id: number) => jsend<{ ok: true; recompute: unknown }>(`/api/eras/${id}`, "DELETE"),

  purgeSessions: () =>
    jsend<{ ok: true; sessions_removed: number; recompute: unknown }>("/api/admin/purge", "POST", { confirm: "PURGE" }),

  // race calendar + briefing --------------------------------------------------
  races: () => jget<RaceRow[]>("/api/races"),

  createRace: (input: NewRaceInput) => jsend<{ ok: true; race: RaceRow }>("/api/races", "POST", input),

  updateRace: (id: number, patch: Record<string, unknown>) =>
    jsend<{ ok: true; race: RaceRow }>(`/api/races/${id}`, "PATCH", patch),

  deleteRace: (id: number) => jsend<{ ok: true }>(`/api/races/${id}`, "DELETE"),
};
