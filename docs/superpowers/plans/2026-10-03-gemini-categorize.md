# Gemini Auto-Categorize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Suggest categories" button on the Merchants page asks Gemini for a category for every uncategorized merchant with live rows, saves the answers flagged as suggested, and a Confirm action clears the flag.

**Architecture:** Pure prompt/parse functions in `worker/src/domain/gemini.ts`, held to the Python by recorded vectors. A tiny `fetch` client in `worker/src/services/gemini.ts`, injected into `worker/src/services/categorize.ts`, which reads merchants, calls Gemini in chunks, and saves everything in one `atomic()` batch. Two Origin-checked routes; the page gets a button, a result toast and a Confirm action.

**Tech Stack:** Cloudflare Worker (Hono, drizzle 0.44 on D1, zod 4), Vitest with better-sqlite3 and `fakeD1`; React 19 + TanStack Query + Tailwind; Python 3.12 (`tools/crosscheck/vectors.py`).

**Spec:** `docs/superpowers/specs/2026-10-03-gemini-categorize-design.md`

## Global Constraints

- Version control is **jj**, never git write commands. Each task is one jj change: `jj describe -m "<message>"` then `jj new`. Every commit message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- In `worker/`, never `npm install <pkg>` (it breaks the lockfile). No new dependencies are needed.
- The repo is public: no real merchant names, banks, people, employer names or personal paths in code, tests or fixtures. All test data is synthetic.
- D1 allows at most 100 bound parameters per statement: pass id/name lists as one `JSON.stringify(...)` parameter read with `json_each`, never `inArray` or one parameter per item.
- Multi-statement writes go through `atomic(db, statements)` from `worker/src/db/atomic.ts`.
- The Gemini key travels only in the `x-goog-api-key` header. Nothing logs the key, the prompt, merchant names or category names; only HTTP status codes may be logged.
- Default model: `gemini-2.5-flash`, overridable by the `GEMINI_MODEL` var.
- Chunk size: at most 100 merchant names per Gemini call.
- Error strings, exactly: `Gemini isn't set up` (503), `Gemini didn't answer (HTTP <status>)` or `Gemini didn't answer` (502), `Gemini's answer couldn't be read` (502).
- Worker tests: `cd worker && npx vitest run <path>`; typecheck: `cd worker && npm run -s typecheck`. Frontend tests: `cd frontend && npx vitest run <path>`; typecheck: `cd frontend && npx tsc -b --noEmit`.

## Review Focus

1. Gemini echoes a merchant name with different case or extra spaces ("cafe one " for "Cafe One") → it still lands on that merchant. Pinned in Task 1.
2. Gemini answers "Uncategorized" (any case) or a blank string → the merchant stays uncategorized, is counted as unanswered, and no "Uncategorized" category is created. Pinned in Task 1 and Task 3.
3. Two answers propose the same new category in different case ("Pets" and "pets"), or one matches an existing category in another case → a single category, existing spelling first, otherwise the first spelling seen. Pinned in Task 3.
4. Gemini is unreachable (`fetch` throws) → 502 "Gemini didn't answer", nothing saved. Pinned in Task 2 and Task 4.
5. Gemini returns HTTP 200 with no candidates (a blocked prompt) → 502 "Gemini's answer couldn't be read", nothing saved. Pinned in Task 2 and Task 4.

---

### Task 1: Prompt and parsing, held to the Python

**Files:**
- Modify: `tools/crosscheck/vectors.py` (import, input constants, `"gemini"` section in `build()`, docstring line)
- Regenerate: `worker/src/__tests__/fixtures/python_vectors.json`
- Create: `worker/src/domain/gemini.ts`
- Test: `worker/src/__tests__/domain/gemini.test.ts`

**Interfaces:**
- Consumes: `TransactionType` (`"expense" | "income"`) from `worker/src/api/transactions.ts`.
- Produces:
  - `categoryGuidance(categories: string[], type: TransactionType): string`
  - `geminiPrompt(names: string[], guidance: string, type: TransactionType): string`
  - `parseGeminiResponse(text: string, asked: string[]): Record<string, string>` — keys are spelled as in `asked`.
  - `class GeminiResponseError extends Error`

- [ ] **Step 1: Record the Python's answers**

In `tools/crosscheck/vectors.py`, add to the imports (after `from expenses import tags as tag_helpers`):

```python
from expenses import gemini_utils
```

Add these constants next to the other input constants (anywhere above `build()`):

```python
GUIDANCE_CASES = [
    (["Groceries", "Eating out", "Transport"], "expense"),
    (["Salary/Wages", "Refunds"], "income"),
    ([], "expense"),
    ([], "income"),
]

PROMPT_CASES = [
    (["Corner Shop", "Cafe One"], "Please use one of the following expense categories if appropriate: "
     "Groceries. If none are suitable, you may suggest a new, concise category.", "expense"),
    (["Acme Payroll"], "", "income"),
    (["Shop \"Quoted\"", "Ünïcode Café"], "", "expense"),
]

PARSE_CASES = [
    '{"Corner Shop": "Groceries", "Cafe One": "Eating out"}',
    '```json\n{"Corner Shop": "Groceries"}\n```',
    '  \n```json{"Acme Payroll": "Salary/Wages"}```  ',
    "{}",
]
```

Add this entry to the dict returned by `build()`, after `"summary": {...},`:

```python
        "gemini": {
            "guidance": [[c, t, gemini_utils._build_category_guidance(c, t)] for c, t in GUIDANCE_CASES],
            "prompts": [[n, g, t, gemini_utils._build_gemini_prompt(n, g, t)] for n, g, t in PROMPT_CASES],
            "parse": [[s, gemini_utils._parse_gemini_response(s)] for s in PARSE_CASES],
        },
```

Append to the module docstring's "Covers ..." paragraph: `, and the Gemini prompt and response parsing`.

Run: `PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py`
Expected: `wrote .../python_vectors.json`; `git diff --stat` style check with `jj diff --stat` shows only the JSON and `vectors.py` changed. Then `PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py --check` prints `python vectors are current`.

- [ ] **Step 2: Write the failing tests**

Create `worker/src/__tests__/domain/gemini.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { TransactionType } from "../../api/transactions";
import {
  categoryGuidance, geminiPrompt, GeminiResponseError, parseGeminiResponse,
} from "../../domain/gemini";
import rawVectors from "../fixtures/python_vectors.json";

const vectors = (rawVectors as unknown as {
  gemini: {
    guidance: [string[], TransactionType, string][];
    prompts: [string[], string, TransactionType, string][];
    parse: [string, Record<string, string>][];
  };
}).gemini;

describe("Gemini prompt and parsing match the Python", () => {
  it.each(vectors.guidance)("guidance for %j (%s)", (categories, type, expected) => {
    expect(categoryGuidance(categories, type)).toBe(expected);
  });

  it.each(vectors.prompts)("prompt for %j", (names, guidance, type, expected) => {
    expect(geminiPrompt(names, guidance, type)).toBe(expected);
  });

  it.each(vectors.parse)("parses %j", (text, expected) => {
    expect(parseGeminiResponse(text, Object.keys(expected))).toEqual(expected);
  });
});

describe("parseGeminiResponse beyond the Python", () => {
  it("keeps only names that were asked", () => {
    expect(parseGeminiResponse('{"Corner Shop": "Groceries", "Other Shop": "Fuel"}', ["Corner Shop"]))
      .toEqual({ "Corner Shop": "Groceries" });
  });

  it("matches an echoed name ignoring case and surrounding spaces, keeping the asked spelling", () => {
    expect(parseGeminiResponse('{" cafe ONE ": "Eating out"}', ["Cafe One"])).toEqual({ "Cafe One": "Eating out" });
  });

  it("keeps the first answer when two keys map to one asked name", () => {
    expect(parseGeminiResponse('{"Cafe One": "Eating out", "cafe one": "Coffee"}', ["Cafe One"]))
      .toEqual({ "Cafe One": "Eating out" });
  });

  it("trims categories and drops blank, non-string and Uncategorized answers", () => {
    expect(parseGeminiResponse(
      '{"A": "  Fuel ", "B": "", "C": 3, "D": null, "E": "uncategorized", "F": "UNCATEGORIZED "}',
      ["A", "B", "C", "D", "E", "F"],
    )).toEqual({ A: "Fuel" });
  });

  it.each(['["Groceries"]', '"Groceries"', "null", "not json at all"])("rejects %j", (text) => {
    expect(() => parseGeminiResponse(text, ["A"])).toThrow(GeminiResponseError);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd worker && npx vitest run src/__tests__/domain/gemini.test.ts`
Expected: FAIL — `Failed to resolve import "../../domain/gemini"`.

- [ ] **Step 4: Implement**

Create `worker/src/domain/gemini.ts`. The prompt text must match the Python byte for byte, including the four- and eight-space indents inside the examples and the trailing `"\n    "`:

```ts
/**
 * gemini_utils.py's prompt building and response parsing, pure so the
 * Worker can be held to the Python (python_vectors.json, "gemini"). The
 * parser also checks what the Python trusted: the answer must be an object,
 * and only names that were asked, with non-blank text, count.
 */

import type { TransactionType } from "../api/transactions";

/** Gemini's answer was not a JSON object of name -> category. */
export class GeminiResponseError extends Error {}

/** _build_category_guidance. */
export function categoryGuidance(categories: string[], type: TransactionType): string {
  if (categories.length === 0) return "";
  const label = type === "income" ? "income" : "expense";
  return `Please use one of the following ${label} categories if appropriate: ${categories.join(", ")}`
    + ". If none are suitable, you may suggest a new, concise category.";
}

/** _build_gemini_prompt. */
export function geminiPrompt(names: string[], guidance: string, type: TransactionType): string {
  const list = names.map((n) => `- ${n}`).join("\n");
  const income = type === "income";
  const context = income ? "income sources" : "merchant names for expenses";
  const exampleInput = income
    ? "- ACME Corporation\n    - PayPal Transfer\n    - Dividend Payment"
    : "- Starbucks\n    - Whole Foods\n    - Shell\n    - Netflix";
  const exampleOutput = income
    ? '{\n        "ACME Corporation": "Salary/Wages",\n        "PayPal Transfer": "Freelance Income",\n        "Dividend Payment": "Dividends"\n    }'
    : '{\n        "Starbucks": "Coffee",\n        "Whole Foods": "Groceries",\n        "Shell": "Fuel",\n        "Netflix": "Subscriptions"\n    }';
  return `
    You are an AI assistant that categorizes ${context} for personal finance tracking.
    Given a list of names, return a single JSON object that maps each name
    to a concise, relevant category. ${guidance}

    Example Input:
    ${exampleInput}

    Example Output:
    \`\`\`json
    ${exampleOutput}
    \`\`\`

    Here is the list to categorize:
    ${list}

    Return only the JSON object.
    `;
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * _parse_gemini_response, then: keep names that were asked (matched ignoring
 * case and surrounding spaces, returned in the asked spelling), and non-blank
 * string categories, trimmed. "Uncategorized" means no answer.
 */
export function parseGeminiResponse(text: string, asked: string[]): Record<string, string> {
  const cleaned = text.trim().replaceAll("```json", "").replaceAll("```", "").trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new GeminiResponseError("not JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new GeminiResponseError("not an object");

  const byKey = new Map(asked.map((n) => [key(n), n]));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) {
    const askedName = byKey.get(key(name));
    if (askedName === undefined || askedName in out || typeof value !== "string") continue;
    const category = value.trim();
    if (category === "" || category.toLowerCase() === "uncategorized") continue;
    out[askedName] = category;
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd worker && npx vitest run src/__tests__/domain/gemini.test.ts`
Expected: PASS. If a prompt vector fails, diff the strings character by character (`JSON.stringify` both) and fix the template's whitespace — never edit the JSON by hand.

- [ ] **Step 6: Commit**

```bash
jj describe -m "Port the Gemini prompt and response parsing, held to the Python

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 2: The Gemini client

**Files:**
- Create: `worker/src/services/gemini.ts`
- Test: `worker/src/__tests__/services/gemini.test.ts`

**Interfaces:**
- Consumes: `GeminiResponseError` from `worker/src/domain/gemini.ts` (Task 1).
- Produces:
  - `type GenerateText = (prompt: string) => Promise<string>`
  - `const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"`
  - `class GeminiCallError extends Error { readonly status: number | null }`
  - `geminiClient(apiKey: string, model: string, fetchImpl?: typeof fetch): GenerateText`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/__tests__/services/gemini.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { GeminiResponseError } from "../../domain/gemini";
import { GeminiCallError, geminiClient } from "../../services/gemini";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("geminiClient", () => {
  it("posts the prompt with the key in a header, and joins the answer's text parts", async () => {
    const fetchImpl = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: '{"A":' }, { text: ' "B"}' }] } }] }));
    const generate = geminiClient("secret-key", "gemini-test", fetchImpl as unknown as typeof fetch);
    expect(await generate("hello")).toBe('{"A": "B"}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("secret-key");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    expect(JSON.parse(String(init.body))).toEqual({ contents: [{ parts: [{ text: "hello" }] }] });
  });

  it("throws GeminiCallError with the status on a non-2xx answer", async () => {
    const generate = geminiClient("k", "m", (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toMatchObject({ constructor: GeminiCallError, status: 429 });
  });

  it("throws GeminiCallError without a status when fetch itself fails", async () => {
    const generate = geminiClient("k", "m", (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toMatchObject({ constructor: GeminiCallError, status: null });
  });

  it.each([
    [{ promptFeedback: { blockReason: "SAFETY" } }],
    [{ candidates: [] }],
    [{ candidates: [{ finishReason: "SAFETY" }] }],
  ])("throws GeminiResponseError on a 200 with no usable candidate: %j", async (body) => {
    const generate = geminiClient("k", "m", (async () => ok(body)) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("throws GeminiResponseError when the 200 body is not JSON", async () => {
    const generate = geminiClient("k", "m", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toBeInstanceOf(GeminiResponseError);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd worker && npx vitest run src/__tests__/services/gemini.test.ts`
Expected: FAIL — cannot resolve `../../services/gemini`.

- [ ] **Step 3: Implement**

Create `worker/src/services/gemini.ts`:

```ts
/**
 * The one network call: Gemini's generateContent REST endpoint. The key goes
 * in a header so it never lands in a URL or a log; only status codes are
 * logged. Services take a GenerateText, so tests never reach the network.
 */

import { GeminiResponseError } from "../domain/gemini";

export type GenerateText = (prompt: string) => Promise<string>;

/** What the TUI hardcoded; GEMINI_MODEL overrides it. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Gemini could not be reached, or answered with an HTTP error. */
export class GeminiCallError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "Gemini could not be reached" : `Gemini answered HTTP ${status}`);
  }
}

interface GenerateContentBody {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[];
}

export function geminiClient(apiKey: string, model: string, fetchImpl?: typeof fetch): GenerateText {
  return async (prompt) => {
    let res: Response;
    try {
      res = await (fetchImpl ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
    } catch {
      console.warn("gemini: request failed");
      throw new GeminiCallError(null);
    }
    if (!res.ok) {
      console.warn(`gemini: HTTP ${res.status}`);
      throw new GeminiCallError(res.status);
    }
    const body = await res.json().catch(() => null) as GenerateContentBody | null;
    const parts = body?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new GeminiResponseError("no candidate");
    return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd worker && npx vitest run src/__tests__/services/gemini.test.ts`
Expected: PASS (the `console.warn` lines in the output are expected).

- [ ] **Step 5: Commit**

```bash
jj describe -m "Add a minimal Gemini REST client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 3: Suggest and confirm services

**Files:**
- Modify: `worker/src/api/merchants.ts` (append the shared types)
- Create: `worker/src/services/categorize.ts`
- Test: `worker/src/__tests__/services/categorize.test.ts`

**Interfaces:**
- Consumes: `categoryGuidance`, `geminiPrompt`, `parseGeminiResponse` (Task 1); `GenerateText` (Task 2); `listMerchants(db): Promise<MerchantRow[]>` from `worker/src/queries/merchants.ts` (existing — its `type` is `"income"` when `income * 2 > count`); `atomic` from `worker/src/db/atomic.ts`; `categories`, `merchants` from `worker/src/db/schema.ts`.
- Produces (in `worker/src/api/merchants.ts`):
  - `interface SuggestResponse { asked: number; suggested: number; newCategories: string[]; unanswered: number }`
  - `interface ConfirmRequest { ids: number[] }`
  - `interface ConfirmResponse { confirmed: number }`
- Produces (in `worker/src/services/categorize.ts`):
  - `const SUGGEST_CHUNK = 100`
  - `suggestCategories(db: Db, generate: GenerateText, userId: number): Promise<SuggestResponse>`
  - `confirmSuggestions(db: Db, merchantIds: number[], userId: number): Promise<ConfirmResponse>`

- [ ] **Step 1: Add the shared types**

Append to `worker/src/api/merchants.ts`:

```ts

/** POST /api/merchants/suggest: what Gemini was asked and what was saved. */
export interface SuggestResponse {
  /** Uncategorized merchants with live rows that were sent. */
  asked: number;
  /** Merchants that now carry a suggested category. */
  suggested: number;
  /** Categories created for these answers, in first-seen spelling. */
  newCategories: string[];
  /** asked - suggested. */
  unanswered: number;
}

/** POST /api/merchants/confirm. Only merchants still flagged change. */
export interface ConfirmRequest { ids: number[] }
export interface ConfirmResponse { confirmed: number }
```

- [ ] **Step 2: Write the failing tests**

Create `worker/src/__tests__/services/categorize.test.ts`. `seed(sqlite, specs, rules)` makes one merchant per distinct name (all expense rows); helper `income()` flips a merchant's rows to income; `generate` is a fake that records prompts and answers from a map.

```ts
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

  it("skips merchants with no live rows", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ ...row("Gone Shop"), deleted: true }, row("Corner Shop")], []);
    const { generate, prompts } = fakeGemini({ "Corner Shop": "Groceries" });
    expect((await suggestCategories(db, generate, USER)).asked).toBe(1);
    expect(askedIn(prompts[0])).toEqual(["Corner Shop"]);
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
    expect(await suggestCategories(db, generate, USER)).toMatchObject({ asked: 2, suggested: 1, unanswered: 1 });
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
```

Before relying on them, check the helpers: open `worker/src/__tests__/helpers/store.ts` and confirm `seed` creates one `merchants` row per distinct name with `type = 'expense'` rows, and `categorise(sqlite, {merchant: category})` creates the category and sets `category_id`. If `categorise` does not create missing categories, add `INSERT OR IGNORE INTO categories (name) VALUES (?)` in the test's own helper instead of changing the shared one.

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd worker && npx vitest run src/__tests__/services/categorize.test.ts`
Expected: FAIL — cannot resolve `../../services/categorize`.

- [ ] **Step 4: Implement**

Create `worker/src/services/categorize.ts`:

```ts
/**
 * Gemini auto-categorize (the TUI's "Auto-Categorize Uncategorized"). Every
 * call is made before anything is written, and the write is one batch, so a
 * failure leaves the store as it was. Answers are saved flagged as
 * suggested; the Merchants page confirms them.
 */

import { sql } from "drizzle-orm";
import type { ConfirmResponse, SuggestResponse } from "../api/merchants";
import type { TransactionType } from "../api/transactions";
import { atomic } from "../db/atomic";
import { categories, merchants } from "../db/schema";
import type { Db } from "../db/types";
import { categoryGuidance, geminiPrompt, parseGeminiResponse } from "../domain/gemini";
import { listMerchants } from "../queries/merchants";
import type { GenerateText } from "./gemini";

/** Names per Gemini call, so a large backlog never makes one huge prompt. */
export const SUGGEST_CHUNK = 100;

export async function suggestCategories(db: Db, generate: GenerateText, userId: number): Promise<SuggestResponse> {
  const rows = await listMerchants(db);
  const todo = rows.filter((m) => m.category === null && m.count > 0);
  if (todo.length === 0) return { asked: 0, suggested: 0, newCategories: [], unanswered: 0 };

  const stored = await db.select({ name: categories.name, archived: categories.isArchived }).from(categories);
  const active = stored.filter((c) => !c.archived).map((c) => c.name).sort();
  const activeSet = new Set(active);
  // Lower-case name -> the spelling to save, so "groceries" lands on "Groceries".
  const spelling = new Map(stored.map((c) => [c.name.toLowerCase(), c.name]));
  const newCategories: string[] = [];
  const idByName = new Map(todo.map((m) => [m.name, m.id]));
  const answers: { id: number; category: string }[] = [];

  for (const type of ["expense", "income"] as TransactionType[]) {
    const names = todo.filter((m) => m.type === type).map((m) => m.name).sort();
    if (names.length === 0) continue;
    const used = [...new Set(rows
      .filter((m) => m.type === type && m.category !== null && activeSet.has(m.category))
      .map((m) => m.category as string))].sort();
    const guidance = categoryGuidance(used.length > 0 ? used : active, type);
    for (let i = 0; i < names.length; i += SUGGEST_CHUNK) {
      const chunk = names.slice(i, i + SUGGEST_CHUNK);
      const parsed = parseGeminiResponse(await generate(geminiPrompt(chunk, guidance, type)), chunk);
      for (const [name, answer] of Object.entries(parsed)) {
        let category = spelling.get(answer.toLowerCase());
        if (category === undefined) {
          category = answer;
          spelling.set(answer.toLowerCase(), answer);
          newCategories.push(answer);
        }
        answers.push({ id: idByName.get(name) as number, category });
      }
    }
  }
  if (answers.length === 0) return { asked: todo.length, suggested: 0, newCategories: [], unanswered: todo.length };

  const payload = JSON.stringify(answers);
  await atomic(db, [
    ...(newCategories.length > 0
      ? [sql`INSERT OR IGNORE INTO categories (name) SELECT value FROM json_each(${JSON.stringify(newCategories)})`]
      : []),
    // Only merchants still uncategorized: one set meanwhile wins over Gemini.
    sql`
      UPDATE merchants
      SET category_id = c.id, category_suggested = 1, category_set_by = ${userId}, category_set_at = unixepoch()
      FROM json_each(${payload}) j
      JOIN categories c ON c.name = json_extract(j.value, '$.category')
      WHERE merchants.id = json_extract(j.value, '$.id') AND merchants.category_id IS NULL
    `,
  ]);

  // Count what the update actually changed, not what Gemini answered.
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(merchants).where(sql`
    ${merchants.categorySuggested} = 1 AND EXISTS (
      SELECT 1 FROM json_each(${payload}) j
      JOIN categories c ON c.name = json_extract(j.value, '$.category')
      WHERE ${merchants.id} = json_extract(j.value, '$.id') AND ${merchants.categoryId} = c.id
    )
  `);
  const usedNew = new Set(answers.map((a) => a.category));
  return {
    asked: todo.length,
    suggested: n,
    newCategories: newCategories.filter((c) => usedNew.has(c)),
    unanswered: todo.length - n,
  };
}

/** Accept suggested categories as they are. Unflagged ids are ignored. */
export async function confirmSuggestions(db: Db, merchantIds: number[], userId: number): Promise<ConfirmResponse> {
  const ids = JSON.stringify([...new Set(merchantIds)]);
  const flagged = sql`${merchants.id} IN (SELECT value FROM json_each(${ids})) AND ${merchants.categorySuggested} = 1`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(merchants).where(flagged);
  if (n === 0) return { confirmed: 0 };
  await atomic(db, [sql`
    UPDATE merchants SET category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
    WHERE id IN (SELECT value FROM json_each(${ids})) AND category_suggested = 1
  `]);
  return { confirmed: n };
}
```

Notes for the implementer:
- `${merchants.id}` inside a drizzle `sql` template renders as `"merchants"."id"`; inside the raw `UPDATE` above the plain names are used on purpose, because the column-qualified form is not valid on the left of `SET`.
- If SQLite rejects `UPDATE … FROM json_each(...) j JOIN categories c`, rewrite the FROM as `FROM (SELECT json_extract(j.value, '$.id') AS mid, c.id AS cid FROM json_each(${payload}) j JOIN categories c ON c.name = json_extract(j.value, '$.category')) a` and use `a.cid` / `a.mid`. Re-run the D1-driver test either way.

- [ ] **Step 5: Run the tests**

Run: `cd worker && npx vitest run src/__tests__/services/categorize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj describe -m "Suggest categories with Gemini and confirm them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 4: Routes, the lookups flag and config

**Files:**
- Modify: `worker/src/app.ts` (`AppBindings`)
- Modify: `worker/wrangler.toml` (`[vars]`)
- Modify: `worker/src/routes/merchants.ts` (two routes)
- Modify: `worker/src/api/transactions.ts` (`LookupsResponse.gemini`)
- Modify: `worker/src/queries/transactions.ts` (`listLookups` return type)
- Modify: `worker/src/routes/transactions.ts:73` (lookups route)
- Test: `worker/src/__tests__/app/categorizeRoute.test.ts`; adjust `worker/src/__tests__/app/transactionsRoute.test.ts` if its lookups assertion is exact

**Interfaces:**
- Consumes: `suggestCategories`, `confirmSuggestions` (Task 3); `geminiClient`, `GeminiCallError`, `DEFAULT_GEMINI_MODEL` (Task 2); `GeminiResponseError` (Task 1).
- Produces:
  - `POST /api/merchants/suggest` → 200 `SuggestResponse` | 503/502 `{ error }`
  - `POST /api/merchants/confirm` `{ ids }` → 200 `ConfirmResponse` | 400 `{ error }`
  - `LookupsResponse.gemini: boolean`
  - `AppBindings.GEMINI_API_KEY?: string`, `AppBindings.GEMINI_MODEL?: string`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/__tests__/app/categorizeRoute.test.ts`. Gemini is faked by stubbing the global `fetch` the client falls back to:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { LookupsResponse } from "../../api/transactions";
import { categorise, seed, store } from "../helpers/store";

const base: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup(env: AppBindings = { ...base, GEMINI_API_KEY: "test-key" }) {
  const s = store([]);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "Corner Shop", amount: 10, deleted: false },
    { date: "2026-03-02", merchant: "Bakery", amount: 5, deleted: false },
  ], []);
  categorise(s.sqlite, { Bakery: "Groceries" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method, headers: { "content-type": "application/json", origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}

const geminiAnswers = (text: string) => vi.fn(async () => new Response(
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 },
));

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/merchants/suggest", () => {
  it("asks Gemini with the configured model and saves the answers", async () => {
    const fetchMock = geminiAnswers('{"Corner Shop": "Groceries"}');
    vi.stubGlobal("fetch", fetchMock);
    const { send } = setup({ ...base, GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" });
    const res = await send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asked: 1, suggested: 1, newCategories: [], unanswered: 0 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/models/gemini-test:generateContent");
  });

  it("uses gemini-2.5-flash when no model is configured", async () => {
    const fetchMock = geminiAnswers("{}");
    vi.stubGlobal("fetch", fetchMock);
    await setup().send("POST", "/api/merchants/suggest", {});
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("is 503 without a key", async () => {
    const res = await setup(base).send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Gemini isn't set up" });
  });

  it.each([
    [async () => new Response("quota", { status: 429 }), "Gemini didn't answer (HTTP 429)"],
    [async () => { throw new TypeError("offline"); }, "Gemini didn't answer"],
    [async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }), "Gemini's answer couldn't be read"],
    [async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sorry, no." }] } }] }), { status: 200 }), "Gemini's answer couldn't be read"],
  ])("is 502 with a short message when Gemini fails (%#), saving nothing", async (impl, message) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    const { send, sqlite } = setup();
    const res = await send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: message });
    expect(sqlite.prepare(`SELECT count(*) AS n FROM merchants WHERE category_suggested = 1`).get()).toEqual({ n: 0 });
  });

  it("refuses a request from another site", async () => {
    vi.stubGlobal("fetch", geminiAnswers("{}"));
    expect((await setup().send("POST", "/api/merchants/suggest", {}, "https://evil.example")).status).toBe(403);
  });
});

describe("POST /api/merchants/confirm", () => {
  it("confirms flagged merchants", async () => {
    const { send, sqlite } = setup();
    sqlite.exec(`UPDATE merchants SET category_suggested = 1 WHERE canonical_name = 'Bakery'`);
    const id = (sqlite.prepare(`SELECT id FROM merchants WHERE canonical_name = 'Bakery'`).get() as { id: number }).id;
    const res = await send("POST", "/api/merchants/confirm", { ids: [id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: 1 });
  });

  it.each([[{ ids: [] }], [{ ids: [0] }], [{ ids: "1" }], [{}], [{ ids: [1], extra: true }]])("refuses %j", async (body) => {
    const res = await setup().send("POST", "/api/merchants/confirm", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
  });

  it("refuses a request from another site", async () => {
    expect((await setup().send("POST", "/api/merchants/confirm", { ids: [1] }, "https://evil.example")).status).toBe(403);
  });
});

describe("GET /api/lookups", () => {
  it("says whether Gemini is set up", async () => {
    const on = await (await setup().send("GET", "/api/lookups")).json() as LookupsResponse;
    const off = await (await setup(base).send("GET", "/api/lookups")).json() as LookupsResponse;
    expect(on.gemini).toBe(true);
    expect(off.gemini).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd worker && npx vitest run src/__tests__/app/categorizeRoute.test.ts`
Expected: FAIL — 404s for the new routes, `gemini` undefined, and a type error on `GEMINI_API_KEY` in `AppBindings` (Vitest still runs; typecheck comes later).

- [ ] **Step 3: Config and bindings**

In `worker/src/app.ts`, inside `interface AppBindings`, after `DEV_USER_EMAIL?: string;`:

```ts
  /** Secret. Unset: the Merchants page hides "Suggest categories". */
  GEMINI_API_KEY?: string;
  /** Defaults to DEFAULT_GEMINI_MODEL. */
  GEMINI_MODEL?: string;
```

In `worker/wrangler.toml`, inside `[vars]` after `CF_ACCESS_AUD = ...`:

```toml
# The model the Merchants page's "Suggest categories" asks.
GEMINI_MODEL = "gemini-2.5-flash"
```

- [ ] **Step 4: Routes**

In `worker/src/routes/merchants.ts`:

1. Extend the header comment's first sentence to: `The merchant editor and the Merchants page: list, rule lookup, preview, the writes, and Gemini suggestions.`
2. Change the imports:

```ts
import type {
  ConfirmResponse, DecisionResponse, MerchantCategoryResponse, MerchantsResponse, RuleDeletedResponse, SuggestResponse,
} from "../api/merchants";
import { GeminiResponseError } from "../domain/gemini";
import { listMerchants, ruleFor } from "../queries/merchants";
import { confirmSuggestions, suggestCategories } from "../services/categorize";
import { DEFAULT_GEMINI_MODEL, GeminiCallError, geminiClient } from "../services/gemini";
```

(keep the existing `../services/merchants` import and `parseBody` import as they are).

3. After `const CategoryBody = ...;` add:

```ts
const ConfirmBody = z.object({
  ids: z.array(z.number().int().positive("ids must be positive whole numbers"))
    .min(1, "Choose at least one merchant").max(10_000, "At most 10,000 merchants at once"),
}).strict();
```

4. Before `return routes;` add:

```ts
  routes.post("/merchants/suggest", async (c) => {
    const key = c.env.GEMINI_API_KEY;
    if (!key) return c.json({ error: "Gemini isn't set up" }, 503);
    const generate = geminiClient(key, c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
    try {
      return c.json(await suggestCategories(c.get("db"), generate, c.get("user").id) satisfies SuggestResponse);
    } catch (e) {
      if (e instanceof GeminiCallError) {
        return c.json({ error: e.status === null ? "Gemini didn't answer" : `Gemini didn't answer (HTTP ${e.status})` }, 502);
      }
      if (e instanceof GeminiResponseError) return c.json({ error: "Gemini's answer couldn't be read" }, 502);
      throw e;
    }
  });

  routes.post("/merchants/confirm", async (c) => {
    const body = await parseBody(c, ConfirmBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return c.json(await confirmSuggestions(c.get("db"), body.data.ids, c.get("user").id) satisfies ConfirmResponse);
  });
```

- [ ] **Step 5: The lookups flag**

In `worker/src/api/transactions.ts`, inside `interface LookupsResponse`, after `essentialCategories: string[];`:

```ts
  /** GEMINI_API_KEY is set, so "Suggest categories" can work. */
  gemini: boolean;
```

In `worker/src/queries/transactions.ts`, change `listLookups`'s return type to `Promise<Omit<LookupsResponse, "gemini">>` (the body is unchanged).

In `worker/src/routes/transactions.ts`, replace line 73:

```ts
  routes.get("/lookups", async (c) =>
    c.json({ ...(await listLookups(c.get("db"))), gemini: Boolean(c.env.GEMINI_API_KEY) } satisfies LookupsResponse));
```

and add `LookupsResponse` to that file's type import from `../api/transactions` if it is not already imported.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd worker && npx vitest run src/__tests__/app/categorizeRoute.test.ts`
Expected: PASS.

Run: `cd worker && npx vitest run && npm run -s typecheck`
Expected: every test passes; the typecheck prints nothing. If `transactionsRoute.test.ts` compares the whole lookups body with `toEqual`, add `gemini: false` to its expected object (its env has no key).

- [ ] **Step 7: Commit**

```bash
jj describe -m "Add the suggest and confirm routes and the Gemini lookups flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 5: "Suggest categories" on the Merchants page

**Files:**
- Modify: `frontend/src/lib/types.ts` (re-export the new types)
- Modify: `frontend/src/merchants/mutations.ts`
- Create: `frontend/src/merchants/suggest.ts`
- Modify: `frontend/src/merchants/MerchantsPage.tsx`
- Modify: test fixtures that build a full `LookupsResponse` (typecheck will name them)
- Test: `frontend/src/__tests__/merchants/suggest.test.tsx`

**Interfaces:**
- Consumes: `SuggestResponse`, `ConfirmRequest`, `ConfirmResponse` and `LookupsResponse.gemini` (Tasks 3–4); `merchantCount(n)` from `frontend/src/merchants/count.ts`; `useToast` from `frontend/src/lib/Toast.tsx`; `ApiError` from `frontend/src/lib/api.ts`.
- Produces:
  - `useSuggestCategories()` — mutation with no variables, resolves `SuggestResponse`
  - `useConfirmSuggestions()` — mutation taking `number[]`, resolves `ConfirmResponse`
  - `suggestMessage(r: SuggestResponse): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/merchants/suggest.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { suggestMessage } from "../../merchants/suggest";
import { api, merchant, renderMerchants, useHarness } from "./harness";

useHarness();

const lookups = (gemini: boolean) => () => ({
  body: { categories: ["Groceries"], tags: [], sources: [], essentialCategories: [], gemini },
});
const rows = [merchant(1, "Corner Shop", { category: null }), merchant(2, "Bakery")];
const button = () => screen.queryByRole("button", { name: "Suggest categories" });

describe("suggestMessage", () => {
  it.each([
    [{ asked: 0, suggested: 0, newCategories: [], unanswered: 0 }, "No uncategorized merchants"],
    [{ asked: 1, suggested: 1, newCategories: [], unanswered: 0 }, "Suggested categories for 1 merchant"],
    [{ asked: 4, suggested: 3, newCategories: ["Pets", "Hobbies"], unanswered: 1 },
      "Suggested categories for 3 merchants · new: Pets, Hobbies · 1 got no answer"],
  ])("%j", (r, message) => expect(suggestMessage(r)).toBe(message));
});

describe("the Suggest categories button", () => {
  it("is hidden when Gemini is not set up", async () => {
    renderMerchants("/merchants", api(rows, { "GET /api/lookups": lookups(false) }));
    await screen.findByRole("table");
    expect(button()).not.toBeInTheDocument();
  });

  it("is hidden when no merchant with live rows is uncategorized", async () => {
    renderMerchants("/merchants", api(
      [merchant(1, "Corner Shop", { category: null, count: 0, rules: [{ id: 1, pattern: "^C" }] }), merchant(2, "Bakery")],
      { "GET /api/lookups": lookups(true) },
    ));
    await screen.findByRole("table");
    expect(button()).not.toBeInTheDocument();
  });

  it("asks, shows the result, and Review switches to the Suggested filter", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/suggest": () => ({ body: { asked: 1, suggested: 1, newCategories: ["Pets"], unanswered: 0 } }),
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.path === "/api/merchants/suggest")).toBe(true));
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Suggested categories for 1 merchant · new: Pets"));
    await userEvent.click(within(toast).getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("location")).toHaveTextContent("attention=suggested");
  });

  it("is disabled and says so while Gemini is thinking", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = api(rows, { "GET /api/lookups": lookups(true) });
    const slow = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/merchants/suggest")) {
        await gate;
        return new Response(JSON.stringify({ asked: 1, suggested: 0, newCategories: [], unanswered: 1 }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return mock.fetch(input, init);
    };
    renderMerchants("/merchants", { ...mock, fetch: slow });
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    expect(await screen.findByRole("button", { name: "Asking Gemini…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 got no answer"));
  });

  it("shows the Worker's message with Retry when it fails", async () => {
    let attempts = 0;
    renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/suggest": () => (++attempts === 1
        ? { status: 502, body: { error: "Gemini didn't answer (HTTP 429)" } }
        : { body: { asked: 1, suggested: 1, newCategories: [], unanswered: 0 } }),
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Gemini didn't answer (HTTP 429)"));
    await userEvent.click(within(toast).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(toast).toHaveTextContent("Suggested categories for 1 merchant"));
    expect(attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/merchants/suggest.test.tsx`
Expected: FAIL — cannot resolve `../../merchants/suggest`.

- [ ] **Step 3: Types and mutations**

In `frontend/src/lib/types.ts`, extend the merchants re-export:

```ts
export type {
  AliasPreviewResponse, ConfirmRequest, ConfirmResponse, DecisionRequest, DecisionResponse, MerchantCategoryRequest,
  MerchantCategoryResponse, MerchantRow, MerchantRule, MerchantsResponse, RuleDeletedResponse, RuleLookupResponse,
  SuggestResponse,
} from "../../../worker/src/api/merchants";
```

In `frontend/src/merchants/mutations.ts`, add `ConfirmResponse, SuggestResponse` to the type import and append:

```ts
export const useSuggestCategories = () =>
  useWrite(() => send<SuggestResponse>("POST", "/api/merchants/suggest", {}), MERCHANT_WRITES);
export const useConfirmSuggestions = () =>
  useWrite((ids: number[]) => send<ConfirmResponse>("POST", "/api/merchants/confirm", { ids }), MERCHANT_WRITES);
```

Create `frontend/src/merchants/suggest.ts`:

```ts
import type { SuggestResponse } from "../lib/types";
import { merchantCount } from "./count";

/** The toast after "Suggest categories". */
export function suggestMessage(r: SuggestResponse): string {
  if (r.asked === 0) return "No uncategorized merchants";
  const parts = [`Suggested categories for ${merchantCount(r.suggested)}`];
  if (r.newCategories.length > 0) parts.push(`new: ${r.newCategories.join(", ")}`);
  if (r.unanswered > 0) parts.push(`${r.unanswered} got no answer`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: The button**

In `frontend/src/merchants/MerchantsPage.tsx`:

1. Imports: add `ApiError` from `"../lib/api"`, `useSuggestCategories` to the `./mutations` import, and `suggestMessage` from `"./suggest"`.
2. After `const clear = useSetMerchantCategory();` add:

```tsx
  const suggest = useSuggestCategories();
  // Gemini only sees merchants with live rows, so only those make the button worth showing.
  const canSuggest = lookups.data?.gemini === true && (all ?? []).some((m) => m.category === null && m.count > 0);
  const askGemini = () => !suggest.isPending && suggest.mutate(undefined, {
    onSuccess: (r) => notify({
      message: suggestMessage(r),
      ...(r.suggested > 0 && { action: { label: "Review", run: () => { update({ attention: "suggested" }); dismiss(); } } }),
    }),
    onError: (e) => notify({
      message: e instanceof ApiError ? e.message : `Couldn't ask Gemini: ${e.message}`,
      action: { label: "Retry", run: askGemini },
    }),
  });
```

`update` is defined further down with `const`; move this block below the `const update = ...` line so it is initialised first.

3. Replace the count line:

```tsx
        {all && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
            <span>{merchantCount(rows.length)} · {rows.filter((r) => r.category === null).length} uncategorized</span>
            {canSuggest && (
              <button type="button" onClick={askGemini} disabled={suggest.isPending}
                className="underline disabled:no-underline disabled:opacity-60">
                {suggest.isPending ? "Asking Gemini…" : "Suggest categories"}
              </button>
            )}
          </p>
        )}
```

The existing test asserts `screen.getByText("3 merchants · 1 uncategorized")`; with the text now in its own `<span>` that still matches.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd frontend && npx vitest run src/__tests__/merchants`
Expected: PASS.

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no output. If a fixture typed as `LookupsResponse` now lacks `gemini`, add `gemini: false` to it (likely `src/__tests__/transactions/pageHarness.tsx`, `src/__tests__/summary/fixtures.ts`); do not make the field optional.

- [ ] **Step 6: Commit**

```bash
jj describe -m "Suggest categories with Gemini from the Merchants page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 6: Confirm suggested categories

**Files:**
- Modify: `frontend/src/merchants/MerchantActionBar.tsx`
- Modify: `frontend/src/merchants/MerchantsPage.tsx`
- Test: `frontend/src/__tests__/merchants/selection.test.tsx` (append)

**Interfaces:**
- Consumes: `useConfirmSuggestions()` (Task 5); `merchantCount`.
- Produces: `MerchantActionBar` prop `onConfirm?: () => void` — the Confirm button shows only when it is given.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/merchants/selection.test.tsx` (it already defines `bar()` and `posts()`):

```tsx
describe("confirming suggestions", () => {
  const flagged = [
    merchant(1, "Corner Shop", { suggested: true }),
    merchant(2, "Cafe One", { suggested: true, category: "Coffee" }),
    merchant(3, "Bakery"),
  ];

  it("confirms only the selected merchants that are flagged", async () => {
    const mock = renderMerchants("/merchants", api(flagged, {
      "POST /api/merchants/confirm": (b) => ({ body: { confirmed: (b as { ids: number[] }).ids.length } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Bakery" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(posts(mock)).toEqual([{ ids: [1] }]));
    await waitFor(() => expect(screen.getByText("Confirmed 1 merchant")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Selected merchants" })).not.toBeInTheDocument();
  });

  it("offers no Confirm when nothing selected is flagged", async () => {
    renderMerchants("/merchants", api(flagged));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    expect(within(bar()).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("keeps the selection and offers Retry when confirming fails", async () => {
    renderMerchants("/merchants", api(flagged, {
      "POST /api/merchants/confirm": () => ({ status: 500, body: { error: "Database is busy" } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Confirm" }));
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Database is busy"));
    expect(within(toast).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(bar()).toHaveTextContent("1 selected");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/merchants/selection.test.tsx`
Expected: FAIL — no "Confirm" button.

- [ ] **Step 3: Implement**

In `frontend/src/merchants/MerchantActionBar.tsx`, add `onConfirm?: () => void;` to the props type (after `onClearCategory`), and before the "Set category" button:

```tsx
      {props.onConfirm && (
        <button type="button" onClick={props.onConfirm} disabled={props.busy} className={btn}>Confirm</button>
      )}
```

In `frontend/src/merchants/MerchantsPage.tsx`:

1. Add `useConfirmSuggestions` to the `./mutations` import.
2. After `const clear = useSetMerchantCategory();` add `const confirm = useConfirmSuggestions();`.
3. After `clearCategory` is defined, add:

```tsx
  // Only flagged rows have anything to confirm; the rest of the selection is ignored.
  const confirmIds = rows.filter((r) => effective.has(r.id) && r.suggested).map((r) => r.id);
  const confirmSuggested = (ids: number[]) => !confirm.isPending && confirm.mutate(ids, {
    onSuccess: ({ confirmed }) => { notify({ message: `Confirmed ${merchantCount(confirmed)}` }); setSelected(new Set()); },
    onError: (e) => notify({ message: `Couldn't confirm: ${e.message}`, action: { label: "Retry", run: () => confirmSuggested(ids) } }),
  });
```

4. On `<MerchantActionBar …>`, change `busy={clear.isPending}` to `busy={clear.isPending || confirm.isPending}` and add:

```tsx
            onConfirm={confirmIds.length > 0 ? () => confirmSuggested(confirmIds) : undefined}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b --noEmit`
Expected: every test passes; no typecheck output.

- [ ] **Step 5: Commit**

```bash
jj describe -m "Confirm suggested categories from the selection bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 7: Docs, build and a real run

**Files:**
- Modify: `docs/WEB_PORT_PLAN.md` (the Gemini section and the order line)
- Modify: `CLAUDE.md` only if it names the Gemini model for the web (it describes the TUI; leave TUI text alone)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Update the port plan**

In `docs/WEB_PORT_PLAN.md`:
- In the Merchants section, change `- "Auto-categorize uncategorized" → Gemini, below.` to `- ~~"Auto-categorize uncategorized" → Gemini, below.~~ Done.`
- Replace the paragraph starting `Port: \`worker/src/services/categorize.ts\`` with:

```markdown
~~Port~~ Done: `worker/src/services/categorize.ts` calls the Gemini REST API
(`services/gemini.ts`, key in the `x-goog-api-key` header) from the Worker.
The key is a Worker secret (`wrangler secret put GEMINI_API_KEY`), never
sent to the browser; `GEMINI_MODEL` in `[vars]` (default
`gemini-2.5-flash`). Prompt building and parsing (`domain/gemini.ts`) are
held to the Python by the `gemini` section of `python_vectors.json`.
"Suggest categories" on the Merchants page sends every uncategorized
merchant with live rows, 100 per call, and saves the answers at once
flagged as suggested (`merchants.category_suggested`); the Suggested filter
and the selection bar's Confirm review them. New categories are allowed.
Import will reuse `suggestCategories` when it is ported. Only merchant and
category names are sent, as today.
```

- In the **Order** line, change `Merchants page (done) +\nGemini →` to `Merchants page (done) +\nGemini (done) →`.

- [ ] **Step 2: Full verification**

Run, from the repo root:

```bash
(cd worker && npx vitest run && npm run -s typecheck)
(cd frontend && npx vitest run && npm run -s build)
PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py --check
```

Expected: all tests pass, the typecheck is silent, the build succeeds (the chunk-size warning is normal), and `python vectors are current`.

- [ ] **Step 3: Privacy scan**

```bash
jj diff -r 'main..@' | grep '^+' | grep -n -i -E "/Users/|@gmail|ptsb|aib|revolut|failla"
```

Expected: no output. Also read the new test fixtures once: every merchant name is invented ("Corner Shop", "Cafe One", "Acme Payroll" …).

- [ ] **Step 4: Real run (controller only, with the owner's OK)**

This step makes a real call to Google with the local uncategorized merchant names. Ask the owner first; skip it if they decline.

1. The owner adds `GEMINI_API_KEY=…` to `worker/.dev.vars` themselves (never paste the key into chat or a file Claude writes).
2. Copy `worker/.wrangler/state` to `$CLAUDE_JOB_DIR/tmp/d1`, start `npx wrangler dev --port 8790 --persist-to $CLAUDE_JOB_DIR/tmp/d1 --local-upstream localhost:8790` from `worker/`.
3. With `uv run --with playwright` and `chromium.launch(channel="chrome")`: open `/merchants`, press "Suggest categories", wait for the toast, press Review, select all, press Confirm, and check that `GET /api/merchants` shows no `suggested: true` rows afterwards.
4. Stop wrangler and delete the copy.

- [ ] **Step 5: Commit**

```bash
jj describe -m "Record Gemini auto-categorize in the port plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

After the final whole-branch review passes, delete this plan and the spec in their own change ("Remove the finished Gemini spec and plan").
