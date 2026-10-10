/** Write the demo household to a new SQLite file: npx tsx scripts/demo-data.ts <out.db> */
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { buildDemo } from "./demoData";
import { migrate } from "./migrate";

const out = process.argv[2];
if (!out) { console.error("usage: demo-data.ts <out.db>"); process.exit(2); }
if (existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(1); }
const sqlite = new Database(out);
migrate(sqlite);
buildDemo(sqlite, new Date());
const [n] = sqlite.prepare("SELECT COUNT(*) FROM v_transactions").raw().get() as [number];
console.log(`demo: ${n} transactions written to ${out}`);
sqlite.close();
