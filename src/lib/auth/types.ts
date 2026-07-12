// Shared, runtime-neutral (importable from middleware) role type. The
// canonical three-tier name here is "manager" — the drivers table's own
// `role` column instead says "engineer" for historical reasons; map between
// the two only at the DB boundary (see db/postgres.ts, db/json-store.ts).
export type Role = "driver" | "manager" | "admin";
