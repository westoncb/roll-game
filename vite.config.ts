import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [
    react(),
    {
      name: "watch-game-assets",
      configureServer({ watcher }) {
        // The catalogs import globs outside the client root. Watch for new and removed files too.
        watcher.add(fileURLToPath(new URL("./assets", import.meta.url)));
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:3001" }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
