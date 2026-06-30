// ============================================================================
// Store singleton. Chooses Postgres when DATABASE_URL is set, otherwise the
// zero-config JSON dev store. Cached on globalThis so Next.js hot-reloads in
// dev reuse one instance (and one JSON read) instead of leaking handles.
// ============================================================================

import { JsonStore } from "./json-store";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __ccrStore: Store | undefined;
}

function build(): Store {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return new PostgresStore(url);
  return new JsonStore();
}

export function getStore(): Store {
  if (!globalThis.__ccrStore) {
    globalThis.__ccrStore = build();
  }
  return globalThis.__ccrStore;
}

export type { Store } from "./types";
