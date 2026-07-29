/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  transpilePackages: ["@softmaple/ui", "@softmaple/editor"],
}

export default nextConfig
