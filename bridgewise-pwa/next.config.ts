import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // New cache names so old runtime caches (including the old black icons) are dropped.
    cacheId: "onrecord-v2",
    runtimeCaching: [
      {
        urlPattern: /\/api\/(?:parse|agent)(?:\?|$)/,
        handler: "NetworkOnly",
        method: "POST",
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withPWA(nextConfig);
