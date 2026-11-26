import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  // package.json e "type": "module" ache, tai ESM output dilam (dist/server.js)
  format: ["esm"],
  platform: "node",
  target: "esnext",
  outDir: "dist",
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: true,
  // CJS dependency gulo ESM-e require() korle jate kaj kore
  banner: {
    js: `
      import { createRequire } from 'module';
      const require = createRequire(import.meta.url);
    `,
  },
});
