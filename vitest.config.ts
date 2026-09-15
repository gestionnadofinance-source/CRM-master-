import { defineConfig } from "vitest/config";
import path from "path";

// Minimal Vitest config — no vitest.config.ts existed before this file.
//
// Two aliases are needed so the integration tests in tests/ can import the
// real server modules (src/server/**, src/lib/**) directly:
//
//  - "@/*" mirrors tsconfig.json's "paths" entry ("@/*": ["./src/*"]).
//    vite-tsconfig-paths is not a project dependency, so the alias is
//    hand-written here instead of adding a new dependency.
//  - "server-only" is redirected to an inert stub (tests/stubs/server-only.ts)
//    because the real package throws unconditionally on import — it's a
//    build-time guard against server code leaking into client bundles, and
//    has no meaning inside a Node test process. See that file for details.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./tests/setup-env.ts")],
    // Integration tests hit the real local Postgres via a shared Prisma
    // client and each file manages its own throwaway fixture rows — running
    // files in parallel workers is safe since fixtures are namespaced by
    // unique __TEST__ prefixes, but we keep it conservative (single fork)
    // to avoid surprising interleaving between files that both touch
    // sequence-like counters (e.g. QuoteCounter).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
