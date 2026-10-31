import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The CDN serves public/; server functions only read JSON (stories and motion plans), so keep media out of their bundles.
  outputFileTracingExcludes: {
    "/**": ["public/stories/**/*.{png,webp,jpg,mp4}", "public/family/**", "pipeline/photos/**", "stories/*/source/**", ".next/dev/**", ".next/cache/**"],
  },
};

export default config;
