import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app so Next does not walk up to the
  // home directory when it detects stray lockfiles.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
