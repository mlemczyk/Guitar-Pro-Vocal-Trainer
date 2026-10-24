import { defineConfig } from "vite";

// Relative base so the build works from GitHub Pages' /vocals-trainer/ path.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { port: 5178 },
});
