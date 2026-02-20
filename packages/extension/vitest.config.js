import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "./test/setup.js",
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["lib/**/*.js", "panel/**/*.js", "background.js"],
      reporter: ["text", "html"],
    },
  },
});
