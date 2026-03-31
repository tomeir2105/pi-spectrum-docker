import type { NextConfig } from "next";

const allowedDevOrigins = ["192.168.1.7", "localhost", "127.0.0.1"];

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
