/** @type {import('next').NextConfig} */

// The existing Express + SQLite service is the API/data layer. In dev we proxy
// /api/* to it so the browser talks to one origin. Override with BACKEND_URL.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
