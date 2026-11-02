import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate opt-in test build: ordinary production bundles contain no counters.
  ...(process.env.COMBINED_COVERAGE === "1" ? {
    distDir: ".next-coverage",
    webpack(config, { isServer }) {
      if (!isServer) config.module.rules.push({
        // path.join keeps the separators consistent with the module paths webpack
        // matches against; a hand-built `${__dirname}/src` instruments nothing on Windows.
        test: /\.tsx?$/, include: path.join(__dirname, "src"), enforce: "pre",
        exclude: /\.(test\.[jt]sx?|d\.ts)$/,
        use: [{ loader: path.join(__dirname, "scripts/coverage/webpack-loader.cjs") }],
      });
      return config;
    },
  } : {}),
  // Pin the workspace root to this app so Next does not walk up to the
  // home directory when it detects stray lockfiles.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
