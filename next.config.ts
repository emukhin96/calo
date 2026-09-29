import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker-образа (Dockerfile копирует .next/standalone).
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
