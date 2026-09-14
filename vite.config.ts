import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// pnpm always runs build/dev from the package root, so process.cwd() is the
// project directory regardless of whether this config is loaded as CJS or ESM.
const rootDir = process.cwd();

export default defineConfig({
  root: path.join(rootDir, "src/webapp"),
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, "webapp/dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:9111",
    },
  },
});