import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate opt-in test build: ordinary production bundles contain no counters.
  ...(process.env.COMBINED_COVERAGE === "1" ? {
    distDir: ".next-coverage",
    webpack(config, { isServer }) {
      if (!isServer) config.module.rules.push({
        test: /\.tsx?$/, include: `${__dirname}/src`, enforce: "pre",
        exclude: /\.(test\.[jt]sx?|d\.ts)$/,
        use: [{ loader: `${__dirname}/scripts/coverage/webpack-loader.cjs` }],
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
