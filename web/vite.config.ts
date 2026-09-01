import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("../engine", import.meta.url)),
      "@examples": fileURLToPath(new URL("../examples", import.meta.url)),
    },
  },
  // Prod serves web and API from one origin (vercel.json rewrites /api/*). In dev
  // the API runs separately on :8787; proxy so client code always calls a
  // relative /api path.
  server: {
    port: 5180,
    proxy: { "/api": "http://localhost:8787" },
  },
});
