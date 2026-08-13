import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/visual.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
