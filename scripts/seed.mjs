// Seed helper — POSTs to the running dev/prod server's /api/seed endpoint.
// Usage: start the app (`npm run dev`), then in another terminal `npm run seed`.
// Or just click "Load sample data" in the app's setup banner.

const base = process.env.SEED_URL || "http://localhost:3000";

try {
  const res = await fetch(`${base}/api/seed`, { method: "POST" });
  const json = await res.json();
  if (!res.ok) {
    console.error("Seed failed:", json);
    process.exit(1);
  }
  console.log("✅ Seeded.");
  console.log(`   backend:        ${json.backend}`);
  console.log(`   cars:           ${json.seeded.cars}`);
  console.log(`   tracks:         ${json.seeded.tracks}`);
  console.log(`   benchmarks:     ${json.seeded.benchmarks}`);
  console.log(`   recommendations:${json.recompute.recommendations}`);
} catch (err) {
  console.error(`Could not reach ${base}. Is the dev server running? (npm run dev)`);
  console.error(String(err));
  process.exit(1);
}
