/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `pg` is a native-ish server package; keep it out of the bundle so it loads
  // at runtime in the Node server rather than being traced.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
