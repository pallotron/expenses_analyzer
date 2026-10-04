/**
 * The import page's column mappings, one per source, in the settings bag
 * under one key. Saved after a successful import, so a mapping that worked is
 * never replaced by one that failed.
 */

import { eq, sql } from "drizzle-orm";
import type { ImportMapping } from "../api/import";
import { settings } from "../db/schema";
import type { Db } from "../db/types";

const KEY = "import_mappings";

export async function loadImportMappings(db: Db): Promise<Record<string, ImportMapping>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  return (row?.value as Record<string, ImportMapping> | undefined) ?? {};
}

export async function saveImportMapping(db: Db, source: string, mapping: ImportMapping, userId: number): Promise<void> {
  const all = { ...(await loadImportMappings(db)), [source]: mapping };
  await db.insert(settings).values({ key: KEY, value: all, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: all, updatedBy: userId, updatedAt: sql`(unixepoch())` } });
}
