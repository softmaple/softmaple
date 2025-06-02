/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@softmaple/ui", "@softmaple/editor"],
  experimental: {
    optimizePackageImports: ["@liveblocks/react", "@liveblocks/react-lexical", "@liveblocks/react-ui"],
  },
}

export default nextConfig
