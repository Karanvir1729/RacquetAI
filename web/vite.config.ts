import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `@/…` resolves to `web/src/…`, mirroring the Expo app's alias so ported
// modules (letterbox maths, the analysis contract) keep their import paths.
const srcDir = new URL("./src/", import.meta.url).pathname;

// `@app/…` resolves into the EXPO APP's src. The scoring engine (squash rules,
// announcements, video playback) is pure TypeScript with no react-native or
// expo imports, so the web referee runs the exact same code the phone does
// rather than a port. web/src/analysis was ported by hand and drifted from its
// app twin — sharing the source is how that does not happen twice.
const appSrcDir = new URL("../src/", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Order matters: the more specific prefix must win. The shared scoring
      // modules import "@/features/analysis/types" using the APP's alias, and
      // web/src has no features/ directory, so pointing that one prefix at the
      // app's src is unambiguous.
      "@/features": `${appSrcDir.replace(/\/$/, "")}/features`,
      "@": srcDir.replace(/\/$/, ""),
      "@app": appSrcDir.replace(/\/$/, ""),
    },
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
