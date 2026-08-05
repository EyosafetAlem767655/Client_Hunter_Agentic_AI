import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // On Windows, starting many jsdom/Vite workers at once makes the first
    // dynamic import in each file take longer than Vitest's 5 s default. The
    // timed-out import keeps running and can consume mocks intended for the
    // next test, producing misleading follow-on failures. Keep concurrency
    // bounded and give module transforms a realistic ceiling.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "json-summary"],
      include: ["src/lib/agent/**", "src/lib/scrapers/**"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 45,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
