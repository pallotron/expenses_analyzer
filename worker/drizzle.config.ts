import { defineConfig } from "drizzle-kit";

/**
 * Generates plain SQLite DDL from src/db/schema.ts into ./drizzle.
 *
 * The generated SQL is the single source of truth for the schema: the Worker
 * applies it to D1, and the seed scripts apply the same file to local
 * databases, so a seeded DB cannot drift from the code.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
