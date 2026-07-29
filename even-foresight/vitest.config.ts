import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // jsdom is the default because most modules touch `window`/`document`
    // (the webapp views) or `localStorage` (storage-helpers). Pure-logic
    // suites work fine under jsdom too, so a single environment keeps
    // per-file `@vitest-environment` pragmas from drifting out of sync.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
