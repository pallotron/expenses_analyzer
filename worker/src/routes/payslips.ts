/**
 * /api/payslips and /api/source-owners. Parse with zod, check the people
 * exist, call the service. Every 400 carries a message the page shows as is.
 */

import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import {
  MAX_PAYSLIP_FILES, type PayslipImportResponse, type PayslipRemoveResponse, type PayslipsResponse,
  type SourceOwnersResponse,
} from "../api/payslips";
import { users } from "../db/schema";
import type { Db } from "../db/types";
import { monthFromFilename, RUN_PART_KEYS } from "../domain/payslips";
import { importRuns, listPayslips, removeRuns } from "../services/payslips";
import { listSourceOwners, setSourceOwner } from "../services/sourceOwners";
import { parseBody } from "./parseBody";

const LIMIT = 1_000_000_000;
const BOUNDS = "An amount must be between −10,000,000 and 10,000,000";

const cents = (key: string) => z.number(`${key} must be a number`)
  .int("Amounts must be whole cents")
  .min(-LIMIT, BOUNDS).max(LIMIT, BOUNDS);

const Run = z.object({
  sourceFile: z.string("sourceFile must be text").min(1, "A file needs a name").max(500, "File names can be at most 500 characters"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM"),
  ...Object.fromEntries(RUN_PART_KEYS.map((k) => [k, cents(k)])) as Record<(typeof RUN_PART_KEYS)[number], ReturnType<typeof cents>>,
  statedNetCents: cents("statedNetCents").nullable(),
}).strict().superRefine((r, ctx) => {
  if (monthFromFilename(r.sourceFile) !== r.month) {
    ctx.addIssue({ code: "custom", message: `${r.sourceFile}: the month must come from the file name` });
  }
});

const Person = z.number("userId must be a number").int().positive();

const Import = z.object({
  userId: Person,
  runs: z.array(Run).min(1, "Add at least one payslip").max(MAX_PAYSLIP_FILES, `At most ${MAX_PAYSLIP_FILES} files at once`)
    .refine((rs) => new Set(rs.map((r) => r.sourceFile)).size === rs.length, "A file appears more than once"),
}).strict();

const Remove = z.object({
  userId: Person,
  sourceFiles: z.array(z.string().min(1, "A file needs a name"))
    .min(1, "Choose at least one file").max(MAX_PAYSLIP_FILES, `At most ${MAX_PAYSLIP_FILES} files at once`),
}).strict();

const Owner = z.object({
  source: z.string("source must be text").min(1, "Choose an account"),
  userId: Person.nullable(),
}).strict();

async function personExists(db: Db, id: number): Promise<boolean> {
  return (await db.select({ id: users.id }).from(users).where(inArray(users.id, [id]))).length > 0;
}

export function payslipRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/payslips", async (c) => c.json((await listPayslips(c.get("db"))) satisfies PayslipsResponse));

  routes.post("/payslips/import", async (c) => {
    const body = await parseBody(c, Import);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (!(await personExists(c.get("db"), body.data.userId))) return c.json({ error: "No such person" }, 400);
    const result = await importRuns(c.get("db"), body.data.userId, body.data.runs, c.get("user").id);
    return c.json(result satisfies PayslipImportResponse);
  });

  routes.post("/payslips/remove", async (c) => {
    const body = await parseBody(c, Remove);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (!(await personExists(c.get("db"), body.data.userId))) return c.json({ error: "No such person" }, 400);
    return c.json((await removeRuns(c.get("db"), body.data.userId, body.data.sourceFiles)) satisfies PayslipRemoveResponse);
  });

  routes.get("/source-owners", async (c) => c.json((await listSourceOwners(c.get("db"))) satisfies SourceOwnersResponse));

  routes.post("/source-owners", async (c) => {
    const body = await parseBody(c, Owner);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (body.data.userId !== null && !(await personExists(c.get("db"), body.data.userId))) {
      return c.json({ error: "No such person" }, 400);
    }
    if (!(await setSourceOwner(c.get("db"), body.data.source, body.data.userId))) {
      return c.json({ error: `No transactions come from "${body.data.source}".` }, 404);
    }
    return c.json({ ok: true });
  });

  return routes;
}
