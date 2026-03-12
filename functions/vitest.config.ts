import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/ontology/types.ts",
        "src/events/types.ts",
        // Integration-heavy modules (tested via Firebase emulator integration tests)
        "src/api/domains.ts",
        "src/api/ontology-routes.ts",
        "src/auth/middleware.ts",
        "src/ontology/loader.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 80,
      },
    },
  },
});
