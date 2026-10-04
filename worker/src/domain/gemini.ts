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
