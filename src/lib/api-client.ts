// ============================================================================
// Tiny typed fetch wrappers used by the client components. All calls are
// same-origin to the Next.js API routes.
// ============================================================================

import type { Benchmark, Car, RankingRow, Session, SessionInput, Track } from "@/types";

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  cars: () => jget<Car[]>("/api/cars"),
  tracks: () => jget<Track[]>("/api/tracks"),
  benchmarks: () => jget<Benchmark[]>("/api/benchmarks"),

  rankings: (params: { track_id?: number; class?: string; condition?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.track_id != null) q.set("track_id", String(params.track_id));
    if (params.class) q.set("class", params.class);
    if (params.condition) q.set("condition", params.condition);
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
};
