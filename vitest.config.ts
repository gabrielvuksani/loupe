import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run fast; the real-browser integration test is opt-in
    // via `pnpm test:integration`.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*integration.test.ts"],
  },
});
