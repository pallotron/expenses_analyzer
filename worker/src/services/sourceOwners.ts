/** Whose account each import source is (the Payslips page's Accounts section). */

import { asc, eq, sql } from "drizzle-orm";

import type { SourceOwnersResponse } from "../api/payslips";
import { sourceOwners, transactions, users } from "../db/schema";
import type { Db } from "../db/types";

export async function listSourceOwners(db: Db): Promise<SourceOwnersResponse> {
  const sources = await db.selectDistinct({ source: transactions.source }).from(transactions).orderBy(asc(transactions.source));
  const owners = await db.select().from(sourceOwners);
  const people = await db.select({ id: users.id, name: users.displayName }).from(users).orderBy(asc(users.id));
  const ownerOf = new Map(owners.map((o) => [o.source, o.userId]));
  return {
    sources: sources.map((s) => ({ source: s.source, userId: ownerOf.get(s.source) ?? null })),
    users: people,
  };
}

/** False when no transaction has this source. */
export async function setSourceOwner(db: Db, source: string, userId: number | null): Promise<boolean> {
  const [known] = await db.select({ n: sql<number>`1` }).from(transactions).where(eq(transactions.source, source)).limit(1);
  if (!known) return false;
  await db.insert(sourceOwners).values({ source, userId })
    .onConflictDoUpdate({ target: sourceOwners.source, set: { userId } });
  return true;
}
