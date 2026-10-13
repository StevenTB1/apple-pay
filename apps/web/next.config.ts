import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.DEV_ORIGIN_HOST
    ? [process.env.DEV_ORIGIN_HOST]
    : [],
};

export default nextConfig;
