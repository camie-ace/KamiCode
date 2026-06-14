import { defineConfig } from "tsdown";

const internalPackagePrefixes = ["@t3tools/"];

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: (id) => internalPackagePrefixes.some((prefix) => id.startsWith(prefix)),
  inlineOnly: false,
});
