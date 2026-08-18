import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `@/…` resolves to `web/src/…`, mirroring the Expo app's alias so ported
// modules (letterbox maths, the analysis contract) keep their import paths.
const srcDir = new URL("./src/", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": srcDir.replace(/\/$/, "") },
  },
  server: {
    port: 5183,
    // The analysis server (analysis/server.py) runs on 8082 by default. Proxying
    // /api keeps the browser same-origin, so no CORS config is needed on the
    // Python side and uploads/polling work straight from `npm run dev`.
    proxy: {
      "/api": {
        target: "http://localhost:8082",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
  },
});
