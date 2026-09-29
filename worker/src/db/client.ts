import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Db } from "./types";

/** The only place the Worker touches env.DB. */
export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}
