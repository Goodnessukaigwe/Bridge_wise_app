import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /\/api\/parse(?:\?|$)/,
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
