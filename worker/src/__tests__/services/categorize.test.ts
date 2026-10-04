import { describe, expect, it } from "vitest";

import { createDb } from "../../db/client";
import { categoryGuidance } from "../../domain/gemini";
import { confirmSuggestions, suggestCategories } from "../../services/categorize";
import type { GenerateText } from "../../services/gemini";
import { fakeD1 } from "../helpers/fakeD1";
import { USER, categorise, seed, store } from "../helpers/store";

type Sqlite = ReturnType<typeof store>["sqlite"];

const row = (merchant: string, date = "2026-03-01") => ({ date, merchant, amount: 10, deleted: false });

/**
 * The names a prompt lists. Only the first is indented (as in the Python), and
 * the examples above also start with "- ", so cut out the list itself.
 */
const askedIn = (prompt: string) =>
  prompt.split("Here is the list to categorize:\n")[1].split("\n\n    Return only")[0]
    .split("\n").map((l) => l.trim().replace(/^- /, ""));

/** Answers each prompt with the categories in `answers` for the names it lists. */
function fakeGemini(answers: Record<string, string>) {
  const prompts: string[] = [];
  const generate: GenerateText = async (prompt) => {
    prompts.push(prompt);
    const asked = askedIn(prompt);
    return JSON.stringify(Object.fromEntries(asked.filter((n) => n in answers).map((n) => [n, answers[n]])));
  };
  return { generate, prompts };
}

const merchantState = (sqlite: Sqlite, name: string) => sqlite.prepare(`
  SELECT c.name AS category, m.category_suggested AS suggested, m.category_set_by AS setBy
  FROM merchants m LEFT JOIN categories c ON c.id = m.category_id WHERE m.canonical_name = ?
`).get(name) as { category: string | null; suggested: number; setBy: number | null };

const categoryNames = (sqlite: Sqlite) =>
  (sqlite.prepare(`SELECT name FROM categories ORDER BY name`).all() as { name: string }[]).map((r) => r.name);

const income = (sqlite: Sqlite, name: string) => sqlite.prepare(`
  UPDATE transactions SET type = 'income'
  WHERE merchant_id = (SELECT id FROM merchants WHERE canonical_name = ?)
`).run(name);

describe("suggestCategories", () => {
  it("saves answers as suggested and reports what it did", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Corner Shop"), row("Cafe One"), row("Mystery Ltd"), row("Bakery")], []);
    categorise(sqlite, { Bakery: "Groceries" });
    const { generate } = fakeGemini({ "Corner Shop": "Groceries", "Cafe One": "Coffee" });

    expect(await suggestCategories(db, generate, USER)).toEqual({ asked: 3, suggested: 2, newCategories: ["Coffee"], unanswered: 1 });
    expect(merchantState(sqlite, "Corner Shop")).toEqual({ category: "Groceries", suggested: 1, setBy: USER });
    expect(merchantState(sqlite, "Cafe One")).toEqual({ category: "Coffee", suggested: 1, setBy: USER });
    expect(merchantState(sqlite, "Mystery Ltd")).toMatchObject({ category: null, suggested: 0 });
    expect(merchantState(sqlite, "Bakery")).toMatchObject({ category: "Groceries", suggested: 0 });
  });

  it("does not call Gemini when nothing is uncategorized", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Bakery")], []);
    categorise(sqlite, { Bakery: "Groceries" });
    const { generate, prompts } = fakeGemini({});
    expect(await suggestCategories(db, generate, USER)).toEqual({ asked: 0, suggested: 0, newCategories: [], unanswered: 0 });
    expect(prompts).toEqual([]);
  });

  it("asks for merchants the page lists: live rows or a rule, not deleted-only ones", async () => {
    const { sqlite, db } = store([["^RULE ONLY", "Rule Only Ltd"]]);
    seed(sqlite, [{ ...row("Gone Shop"), deleted: true }, row("Corner Shop")], []);
    const { generate, prompts } = fakeGemini({ "Corner Shop": "Groceries", "Rule Only Ltd": "Fees" });
    expect(await suggestCategories(db, generate, USER)).toMatchObject({ asked: 2, suggested: 2 });
    expect(askedIn(prompts[0])).toEqual(["Corner Shop", "Rule Only Ltd"]);
    expect(merchantState(sqlite, "Rule Only Ltd")).toMatchObject({ category: "Fees", suggested: 1 });
  });

  it("asks per type, guided by the categories that type already uses", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Corner Shop"), row("Acme Payroll"), row("Bakery"), row("Old Employer")], []);
    income(sqlite, "Acme Payroll");
    income(sqlite, "Old Employer");
    categorise(sqlite, { Bakery: "Groceries", "Old Employer": "Salary" });
    const { generate, prompts } = fakeGemini({});

    await suggestCategories(db, generate, USER);
    expect(prompts).toHaveLength(2);
    const [expense, incomePrompt] = prompts;
    expect(expense).toContain("merchant names for expenses");
    expect(expense).toContain(categoryGuidance(["Groceries"], "expense"));
    expect(askedIn(expense)).toEqual(["Corner Shop"]);
    expect(incomePrompt).toContain("income sources");
    expect(incomePrompt).toContain(categoryGuidance(["Salary"], "income"));
    expect(askedIn(incomePrompt)).toEqual(["Acme Payroll"]);
  });

  it("falls back to every unarchived category when a type uses none", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Acme Payroll"), row("Bakery")], []);
    income(sqlite, "Acme Payroll");
    categorise(sqlite, { Bakery: "Groceries" });
    sqlite.exec(`INSERT INTO categories (name, is_archived) VALUES ('Fuel', 0), ('Retired', 1)`);
    const { generate, prompts } = fakeGemini({});
    await suggestCategories(db, generate, USER);
    expect(prompts[0]).toContain(categoryGuidance(["Fuel", "Groceries"], "income"));
  });

  it("sends at most 100 names per call", async () => {
    const { sqlite, db } = store([]);
    const names = Array.from({ length: 205 }, (_, i) => `Shop ${String(i).padStart(3, "0")}`);
    seed(sqlite, names.map((n) => row(n)), []);
    const { generate, prompts } = fakeGemini(Object.fromEntries(names.map((n) => [n, "Groceries"])));
    expect(await suggestCategories(db, generate, USER)).toMatchObject({ asked: 205, suggested: 205 });
    expect(prompts.map((p) => askedIn(p).length)).toEqual([100, 100, 5]);
  });

  it("works through the D1 driver with more than 100 merchants", async () => {
    const { sqlite } = store([]);
    const names = Array.from({ length: 150 }, (_, i) => `Shop ${i}`);
    seed(sqlite, names.map((n) => row(n)), []);
    const db = createDb(fakeD1(sqlite));
    const { generate } = fakeGemini(Object.fromEntries(names.map((n) => [n, "Groceries"])));
    expect(await suggestCategories(db, generate, USER)).toMatchObject({ asked: 150, suggested: 150 });
  });

  it("uses an existing category's spelling and creates one category per new name", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Bakery"), row("Corner Shop"), row("Pet Store"), row("Vet")], []);
    categorise(sqlite, { Bakery: "Groceries" });
    const { generate } = fakeGemini({ "Corner Shop": "groceries", "Pet Store": "Pets", Vet: "pets" });

    expect((await suggestCategories(db, generate, USER)).newCategories).toEqual(["Pets"]);
    expect(categoryNames(sqlite)).toEqual(["Groceries", "Pets"]);
    expect(merchantState(sqlite, "Corner Shop").category).toBe("Groceries");
    expect(merchantState(sqlite, "Vet").category).toBe("Pets");
  });

  it("never creates an Uncategorized category", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Corner Shop")], []);
    const { generate } = fakeGemini({ "Corner Shop": "Uncategorized" });
    expect(await suggestCategories(db, generate, USER)).toEqual({ asked: 1, suggested: 0, newCategories: [], unanswered: 1 });
    expect(categoryNames(sqlite)).toEqual([]);
  });

  it("leaves a merchant alone if it was categorized while Gemini was thinking", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Corner Shop"), row("Cafe One")], []);
    const generate: GenerateText = async () => {
      categorise(sqlite, { "Corner Shop": "Hardware" });
      return JSON.stringify({ "Corner Shop": "Groceries", "Cafe One": "Coffee" });
    };
    expect(await suggestCategories(db, generate, USER)).toMatchObject({ asked: 2, suggested: 1, newCategories: ["Coffee"], unanswered: 1 });
    expect(merchantState(sqlite, "Corner Shop")).toMatchObject({ category: "Hardware", suggested: 0 });
  });

  it("saves nothing when any call fails", async () => {
    const { sqlite, db } = store([]);
    const names = Array.from({ length: 101 }, (_, i) => `Shop ${String(i).padStart(3, "0")}`);
    seed(sqlite, names.map((n) => row(n)), []);
    let calls = 0;
    const generate: GenerateText = async (prompt) => {
      if (++calls === 2) throw new Error("quota");
      return JSON.stringify(Object.fromEntries(askedIn(prompt).map((n) => [n, "Groceries"])));
    };
    await expect(suggestCategories(db, generate, USER)).rejects.toThrow("quota");
    expect(sqlite.prepare(`SELECT count(*) AS n FROM merchants WHERE category_id IS NOT NULL`).get()).toEqual({ n: 0 });
    expect(categoryNames(sqlite)).toEqual([]);
  });
});

describe("confirmSuggestions", () => {
  it("clears the flag on flagged merchants only, keeping their category", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [row("Corner Shop"), row("Cafe One"), row("Bakery")], []);
    categorise(sqlite, { "Corner Shop": "Groceries", "Cafe One": "Coffee", Bakery: "Groceries" });
    sqlite.exec(`UPDATE merchants SET category_suggested = 1, category_set_by = NULL WHERE canonical_name IN ('Corner Shop', 'Cafe One')`);
    const ids = (sqlite.prepare(`SELECT id FROM merchants WHERE canonical_name IN ('Corner Shop', 'Bakery')`).all() as { id: number }[]).map((r) => r.id);

    expect(await confirmSuggestions(db, [...ids, ...ids], USER)).toEqual({ confirmed: 1 });
    expect(merchantState(sqlite, "Corner Shop")).toEqual({ category: "Groceries", suggested: 0, setBy: USER });
    expect(merchantState(sqlite, "Cafe One")).toMatchObject({ suggested: 1 });
    expect(merchantState(sqlite, "Bakery")).toMatchObject({ category: "Groceries", suggested: 0 });
  });

  it("works through the D1 driver with more than 100 ids", async () => {
    const { sqlite } = store([]);
    seed(sqlite, Array.from({ length: 120 }, (_, i) => row(`Shop ${i}`)), []);
    sqlite.exec(`INSERT INTO categories (name) VALUES ('Groceries');
      UPDATE merchants SET category_id = (SELECT id FROM categories), category_suggested = 1`);
    const ids = (sqlite.prepare(`SELECT id FROM merchants`).all() as { id: number }[]).map((r) => r.id);
    expect(await confirmSuggestions(createDb(fakeD1(sqlite)), ids, USER)).toEqual({ confirmed: 120 });
  });
});
