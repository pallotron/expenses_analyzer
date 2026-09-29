import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not the Workers runtime: query modules take any Drizzle SQLite
    // database, so tests run them over better-sqlite3 rather than D1.
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
