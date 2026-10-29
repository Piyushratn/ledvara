import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.int.spec.ts", "node_modules/**"],
  },
});
