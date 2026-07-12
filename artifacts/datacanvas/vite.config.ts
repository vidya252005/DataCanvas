import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Defaults keep `pnpm dev` working out of the box; override via a `.env`
// file (see `.env.example`) or your shell for CI/deploy environments.
const port = Number(process.env.PORT ?? 5173);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

// Where the Express api-server is actually running. Defaults to the port
// documented in the README (8080) for the two-terminal local setup, but can
// be overridden (e.g. API_PROXY_TARGET="http://localhost:9000") if you run
// it elsewhere.
const apiProxyTarget =
  process.env.API_PROXY_TARGET || `http://localhost:${process.env.API_PORT || 8080}`;

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    fs: {
      strict: true,
    },
    // The frontend and api-server run as two separate processes locally.
    // Every API call in this app uses relative paths like `/api/datasets`,
    // so without this proxy those requests would hit the Vite dev server
    // itself (which has no such route) instead of the Express API.
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
