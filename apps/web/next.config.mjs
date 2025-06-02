/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@softmaple/ui", "@softmaple/editor"],
  webpack: (config) => {
    // Ensure splitChunks and cacheGroups exist
    if (!config.optimization.splitChunks) {
      config.optimization.splitChunks = {};
    }
    if (!config.optimization.splitChunks.cacheGroups) {
      config.optimization.splitChunks.cacheGroups = {};
    }
    
    // Split Liveblocks packages into separate chunks to reduce main bundle size
    config.optimization.splitChunks.cacheGroups.liveblocks = {
      name: 'liveblocks',
      test: /[\\/]node_modules[\\/]@liveblocks[\\/]/,
      chunks: 'all',
      priority: 30,
    };
    return config;
  },
}

export default nextConfig
