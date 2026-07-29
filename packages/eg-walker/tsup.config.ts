import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/internal.ts"],
  format: ["esm"],
  dts: {
    // tsup 8 injects the removed `baseUrl` option into its TypeScript 6 DTS pass.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  sourcemap: true,
  clean: true,
  minify: false,
});
