/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright and other local tooling hit the app via 127.0.0.1 while Next
  // may serve as localhost; allow both so client chunks hydrate in e2e.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@softmaple/editor", "@softmaple/ui"],
};

export default nextConfig;
