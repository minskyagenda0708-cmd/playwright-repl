import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "./test/setup.js",
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["content/**/*.js", "lib/**/*.js", "panel/**/*.js", "background.js", "devtools.js"],
      reporter: ["text", "html"],
    },
  },
});
