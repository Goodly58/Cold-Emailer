/** @type {import('next').NextConfig} */
// 'standalone' output is for the Dockerfile (Railway/VM deploys); Vercel has
// its own packaging, so skip it there.
const nextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
