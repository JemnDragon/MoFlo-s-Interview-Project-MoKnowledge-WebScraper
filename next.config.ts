import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom + @mozilla/readability are Node-only and must never be bundled for
  // the browser. All scraping happens inside Route Handlers (server-only).
  serverExternalPackages: ["jsdom", "@mozilla/readability"],
};

export default nextConfig;
