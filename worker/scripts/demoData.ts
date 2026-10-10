/**
 * A made-up household for local development and the README screenshots.
 * Every name and amount is invented. Seeded, so the same day gives the same
 * data; the window is the 18 months ending on `today`.
 */
import type Database from "better-sqlite3";

const MONTHS = 18;

/** mulberry32: small, fast, and the same everywhere. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = "essential" | "discretionary" | null;
const CATEGORIES: [string, Kind][] = [
  ["Groceries", "essential"], ["Mortgage", "essential"], ["Utilities", "essential"], ["Transport", "essential"],
  ["Insurance", "essential"], ["Health", "essential"], ["Childcare", "essential"], ["Phone & Internet", "essential"],
  ["Eating out", "discretionary"], ["Entertainment", "discretionary"], ["Shopping", "discretionary"],
  ["Travel", "discretionary"], ["Subscriptions", "discretionary"], ["Gifts", "discretionary"], ["Home", "discretionary"],
  ["Salary", null],
];

type Freq = "monthly" | "weekly" | "often" | "sometimes" | "rare";
interface Merchant {
  name: string; category: string; freq: Freq; min: number; max: number; source: string;
  /** The statement text; date-stamped ones are folded by an alias. */
  raw?: (d: Date) => string; day?: number;
}

const BANK = "Current account";
const CARD = "Credit card";
const PARTNER = "Partner account";

const ddmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const MERCHANTS: Merchant[] = [
  { name: "Greenleaf Market", category: "Groceries", freq: "weekly", min: 6000, max: 14000, source: BANK },
  { name: "Corner Shop", category: "Groceries", freq: "often", min: 300, max: 2500, source: CARD, raw: (d) => `POS CORNER SHOP ${ddmm(d)}` },
  { name: "Harbour Bakery", category: "Groceries", freq: "often", min: 250, max: 1200, source: PARTNER },
  { name: "Northside Building Society", category: "Mortgage", freq: "monthly", min: 145000, max: 145000, source: BANK, day: 1 },
  { name: "Brightwater Energy", category: "Utilities", freq: "monthly", min: 9000, max: 19000, source: BANK, day: 12 },
  { name: "City Water", category: "Utilities", freq: "monthly", min: 2500, max: 2500, source: BANK, day: 18 },
  { name: "Metro Transit", category: "Transport", freq: "often", min: 200, max: 650, source: CARD, raw: (d) => `METRO TRANSIT ${ddmm(d)}` },
  { name: "Quickfuel", category: "Transport", freq: "sometimes", min: 4000, max: 7500, source: PARTNER },
  { name: "Steadfast Insurance", category: "Insurance", freq: "monthly", min: 8500, max: 8500, source: BANK, day: 5 },
  { name: "Riverside Pharmacy", category: "Health", freq: "sometimes", min: 800, max: 4500, source: PARTNER },
  { name: "Oakwood Clinic", category: "Health", freq: "rare", min: 6000, max: 6000, source: BANK },
  { name: "Little Acorns Creche", category: "Childcare", freq: "monthly", min: 98000, max: 98000, source: BANK, day: 3 },
  { name: "Lumen Mobile", category: "Phone & Internet", freq: "monthly", min: 3500, max: 3500, source: CARD, day: 20 },
  { name: "Fibrenet", category: "Phone & Internet", freq: "monthly", min: 5000, max: 5000, source: BANK, day: 22 },
  { name: "Trattoria Sole", category: "Eating out", freq: "sometimes", min: 4500, max: 11000, source: CARD },
  { name: "Noodle Bar", category: "Eating out", freq: "sometimes", min: 1800, max: 4200, source: PARTNER },
  { name: "Daily Grind Coffee", category: "Eating out", freq: "often", min: 350, max: 900, source: CARD },
  { name: "Starlight Cinema", category: "Entertainment", freq: "sometimes", min: 1600, max: 3200, source: CARD },
  { name: "Pagebound Books", category: "Shopping", freq: "sometimes", min: 1200, max: 4500, source: PARTNER },
  { name: "Megamart Online", category: "Shopping", freq: "sometimes", min: 1500, max: 12000, source: CARD },
  { name: "Streamly", category: "Subscriptions", freq: "monthly", min: 1399, max: 1399, source: CARD, day: 9 },
  { name: "Tunebox", category: "Subscriptions", freq: "monthly", min: 1099, max: 1099, source: CARD, day: 14 },
  { name: "Fitlife Gym", category: "Subscriptions", freq: "monthly", min: 4500, max: 4500, source: PARTNER, day: 2 },
  { name: "Wrapped & Ribboned", category: "Gifts", freq: "rare", min: 2500, max: 9000, source: PARTNER },
  { name: "Hammer & Nail Hardware", category: "Home", freq: "sometimes", min: 900, max: 8000, source: BANK },
  { name: "Skyward Air", category: "Travel", freq: "rare", min: 18000, max: 42000, source: CARD },
];

/** Two trips, as month offsets from the window's start, with the merchants they used. */
const TRIPS = [
  { tag: "trip:seaside-weekend", offset: 4, rows: [["Seaview Hotel", "Travel", 32000], ["Fish Shack", "Eating out", 6400], ["Pier Arcade", "Entertainment", 2500]] },
  { tag: "trip:city-break", offset: 13, rows: [["Skyward Air", "Travel", 38000], ["Grand Central Hotel", "Travel", 54000], ["Museum Quarter", "Entertainment", 4800], ["Bistro Lumiere", "Eating out", 9600]] },
] as const;

const PEOPLE = [
  { id: 1, email: "you@example.com", name: "You", owner: "self", payer: "ACME PAYROLL", source: BANK, day: 25, gross: 650000, eePct: 5, erPct: 8, net: 425000 },
  { id: 2, email: "partner@example.com", name: "Partner", owner: "partner", payer: "GLOBEX PAYROLL", source: PARTNER, day: 28, gross: 450000, eePct: 4, erPct: 6, net: 310000 },
];

const epoch = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 1000;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export function buildDemo(sqlite: Database.Database, today: Date): void {
  const rand = rng(20261010);
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const end = epoch(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const run = sqlite.transaction(() => {
    for (const p of PEOPLE) {
      sqlite.prepare("INSERT INTO users (id, email, display_name, owner_key) VALUES (?, ?, ?, ?)").run(p.id, p.email, p.name, p.owner);
    }
    for (const [s, uid] of [[BANK, 1], [CARD, 1], [PARTNER, 2]] as const) {
      sqlite.prepare("INSERT INTO source_owners (source, user_id) VALUES (?, ?)").run(s, uid);
    }
    const catId = new Map<string, number>();
    for (const [name, kind] of CATEGORIES) {
      catId.set(name, Number(sqlite.prepare("INSERT INTO categories (name, spending_type) VALUES (?, ?)").run(name, kind).lastInsertRowid));
    }
    const merchantId = new Map<string, number>();
    const merchant = (name: string, category: string) => {
      let id = merchantId.get(name);
      if (id === undefined) {
        id = Number(sqlite.prepare("INSERT INTO merchants (canonical_name, category_id) VALUES (?, ?)").run(name, catId.get(category)!).lastInsertRowid);
        merchantId.set(name, id);
      }
      return id;
    };
    for (const m of MERCHANTS) merchant(m.name, m.category);
    for (const p of PEOPLE) merchant(p.payer === "ACME PAYROLL" ? "Acme Payroll" : "Globex Payroll", "Salary");
    sqlite.prepare("INSERT INTO merchant_aliases (pattern, merchant_id) VALUES (?, ?)").run("^POS CORNER SHOP", merchantId.get("Corner Shop")!);
    sqlite.prepare("INSERT INTO merchant_aliases (pattern, merchant_id) VALUES (?, ?)").run("^METRO TRANSIT", merchantId.get("Metro Transit")!);

    const tagId = (name: string) => {
      sqlite.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
      return (sqlite.prepare("SELECT id FROM tags WHERE name = ?").raw().get(name) as [number])[0];
    };
    sqlite.prepare("INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency')").run();

    // (date, merchant, amount) seen so far: equal rows on one day need distinct occurrences.
    const seen = new Map<string, number>();
    const insertTx = sqlite.prepare(
      "INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, occurrence) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const add = (date: number, raw: string, mid: number, cents: number, type: "expense" | "income", source: string, tags: string[] = []) => {
      if (date > end) return;
      const key = `${date}|${mid}|${cents}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      const id = Number(insertTx.run(date, raw, mid, cents, type, source, occurrence).lastInsertRowid);
      for (const t of tags) sqlite.prepare("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(id, tagId(t));
    };

    const startY = today.getUTCFullYear();
    const startM = today.getUTCMonth() - (MONTHS - 1);
    for (let i = 0; i < MONTHS; i++) {
      const y = new Date(Date.UTC(startY, startM + i, 1)).getUTCFullYear();
      const mo = new Date(Date.UTC(startY, startM + i, 1)).getUTCMonth();
      const last = daysIn(y, mo);
      const on = (d: number) => epoch(y, mo, Math.min(d, last));
      for (const m of MERCHANTS) {
        const mid = merchantId.get(m.name)!;
        const days =
          m.freq === "monthly" ? [m.day ?? 1]
          : m.freq === "weekly" ? [2, 9, 16, 23, 30].filter((d) => d <= last)
          : m.freq === "often" ? Array.from({ length: between(6, 10) }, () => between(1, last))
          : m.freq === "sometimes" ? Array.from({ length: between(1, 3) }, () => between(1, last))
          : rand() < 0.15 ? [between(1, last)] : [];
        for (const d of days) {
          const date = on(d);
          add(date, m.raw ? m.raw(new Date(date * 1000)) : m.name.toUpperCase(), mid, between(m.min, m.max), "expense", m.source);
        }
      }
      for (const p of PEOPLE) {
        const date = on(p.day);
        if (date > end) continue;
        add(date, p.payer, merchantId.get(p.payer === "ACME PAYROLL" ? "Acme Payroll" : "Globex Payroll")!, p.net, "income", p.source);
        const month = `${y}-${String(mo + 1).padStart(2, "0")}`;
        const ee = (p.gross * p.eePct) / 100;
        const er = (p.gross * p.erPct) / 100;
        const tax = p.gross - p.net - ee;
        const file = `payslip-${p.owner}-${month}.pdf`;
        sqlite.prepare(`INSERT INTO payslip_runs (user_id, source_file, month, salary_cents, pension_ee_cents, pension_er_cents,
            paye_cents, gross_cents, tax_total_cents, net_cents, stated_net_cents, net_reconciled, imported_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(p.id, file, month, p.gross, ee, er, tax, p.gross, tax, p.net, p.net, p.id);
        sqlite.prepare(`INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents, pension_ee_cents,
            pension_er_cents, source_files, net_reconciled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(p.id, month, p.gross, p.net, tax, ee, er, JSON.stringify([file]));
      }
      for (const trip of TRIPS) {
        if (trip.offset !== i) continue;
        trip.rows.forEach(([name, category, cents], k) => add(on(10 + k), name.toUpperCase(), merchant(name, category), cents, "expense", CARD, [trip.tag]));
      }
      if (i === 9) add(on(14), "EMERGENCY PLUMBING CO", merchant("Emergency Plumbing Co", "Home"), 68000, "expense", BANK, ["emergency"]);
    }
  });
  run();
}
