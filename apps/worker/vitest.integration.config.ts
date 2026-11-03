import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.int.spec.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
