import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",

  async rewrites() {
    const backend = process.env.BACKEND_API_URL;
    if (!backend) return [];
    return [{ source: "/backend/:path*", destination: `${backend}/:path*` }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
