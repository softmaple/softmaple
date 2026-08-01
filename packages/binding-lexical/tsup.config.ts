import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react.tsx"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  external: [
    "lexical",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@lexical/code",
    "@lexical/link",
    "@lexical/list",
    "@lexical/react",
    "@lexical/rich-text",
  ],
});
