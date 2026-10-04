/**
 * /api/import: rows the browser parsed from a bank export, through the same
 * importTransactions the TUI's import used; and the mappings it remembers.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import { MAX_IMPORT_ROWS, type ImportMappingsResponse, type ImportResponse } from "../api/import";
import { ValidationError } from "../domain/validation";
import { loadImportMappings, saveImportMapping } from "../services/importMappings";
import { importTransactions } from "../services/transactions";
import { parseBody } from "./parseBody";

const Mapping = z.object({
  date: z.string().min(1),
  merchant: z.string().min(1),
  amount: z.string().min(1),
  amountOut: z.string().min(1).optional(),
  typeMode: z.enum(["auto", "expense", "income"]),
  dateOrder: z.enum(["dmy", "mdy"]),
  headerRow: z.number().int().min(0).optional(),
  filter: z.object({ column: z.string().min(1), value: z.string() }).strict().optional(),
}).strict();

const Row = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD"),
  // Blank merchants reach importTransactions, which refuses them in the Python's words.
  merchant: z.string(),
  amountCents: z.number().int().min(0, "Amounts are positive; the type says which way"),
  type: z.enum(["expense", "income"]),
}).strict();

const ImportBody = z.object({
  source: z.string().trim().min(1, "Choose a source").max(100, "A source name can be at most 100 characters"),
  filename: z.string().max(255).optional(),
  mapping: Mapping,
  rows: z.array(Row).min(1, "Nothing to import")
    .max(MAX_IMPORT_ROWS, "At most 5,000 rows per import: split the file"),
}).strict();

export function importRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.post("/import", async (c) => {
    const body = await parseBody(c, ImportBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const { source, filename, mapping, rows } = body.data;
    const userId = c.get("user").id;
    try {
      const result = await importTransactions(c.get("db"), rows, { source, filename, userId });
      await saveImportMapping(c.get("db"), source, mapping, userId);
      return c.json(result satisfies ImportResponse);
    } catch (e) {
      if (e instanceof ValidationError) {
        return c.json({ error: "The file has rows the import refuses", errors: e.errors }, 400);
      }
      throw e;
    }
  });

  routes.get("/import/mappings", async (c) =>
    c.json({ mappings: await loadImportMappings(c.get("db")) } satisfies ImportMappingsResponse));

  return routes;
}
