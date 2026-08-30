import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("../engine", import.meta.url)),
    },
  },
  server: { port: 5180 },
});
