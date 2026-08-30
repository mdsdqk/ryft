import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * One runner for the whole repo. `engine/` and `src/` are framework-free; the
 * `web/` entries are the pure view-model selectors and formatters only
 * (`docs/engine-test-catalog.md` §5) — no DOM, so no jsdom and no react plugin.
 *
 * The engine imports with `.js` specifiers (NodeNext); vitest's resolver maps
 * those to the `.ts` sources, same as `tsx` does for the spike runners. `web/`
 * code reaches the engine through the `@engine` alias, mirrored from
 * `web/vite.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine", import.meta.url)),
    },
  },
  test: {
    include: [
      "engine/**/*.test.ts",
      "src/**/*.test.ts",
      "web/src/**/*.test.ts",
      "api/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
