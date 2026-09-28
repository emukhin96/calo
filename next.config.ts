import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker-образа (Dockerfile копирует .next/standalone).
  output: "standalone",
  // PGlite грузит wasm с диска — не бандлить.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
};

export default nextConfig;
