import { defineConfig } from "vitest/config";

// happy-dom globally — the web store test needs localStorage for zustand's
// persist middleware, and the api / shared tests don't care either way.
// happy-dom's startup cost is small enough not to bother per-file gating.
export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
    ],
    exclude: [
      "**/*probe*",
      "**/node_modules/**",
      "**/dist/**",
      "**/.terragrunt-cache/**",
    ],
  },
});
