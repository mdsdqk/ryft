import { defineConfig } from "vitest/config";

/**
 * Engine + domain unit tests. The `web/` package has its own toolchain and its
 * own vitest config; this one covers the framework-free code under `engine/` and
 * `src/`.
 *
 * The engine imports with `.js` specifiers (NodeNext); vitest's resolver maps
 * those to the `.ts` sources, same as `tsx` does for the spike runners.
 */
export default defineConfig({
  test: {
    include: ["engine/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
