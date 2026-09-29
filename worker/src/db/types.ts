import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/**
 * Any Drizzle SQLite database over this schema: D1 in the Worker, a local file
 * in tests or a desktop build. Query modules take this, never a D1 binding, so
 * they run unchanged on either.
 */
export type Db = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;
