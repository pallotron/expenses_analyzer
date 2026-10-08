/**
 * The free plan's daily D1 read allowance. Once it is spent, every query
 * fails until midnight UTC, including the user lookup that guards the static
 * files, so the whole app would otherwise answer a bare 500.
 *
 * D1 reports it as code 7500, worded "exceeded D1's free tier daily row read
 * limit"; Drizzle wraps that in its own error, so the whole cause chain is
 * checked.
 */

const PATTERN = /daily (row )?read limit|rows? read limit|\b7500\b/i;

export function isReadLimit(err: unknown): boolean {
  for (let e = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (PATTERN.test(e.message)) return true;
  }
  return false;
}

/** The next midnight UTC, when the allowance resets. */
export function nextReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function readLimitMessage(now: Date): string {
  const at = nextReset(now).toLocaleTimeString("en-IE", {
    timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit",
  });
  return `The database's free daily read limit is used up. It resets at midnight UTC (${at} Irish time).`;
}

export function readLimitPage(now: Date): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expenses: back soon</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 32rem; margin: 15vh auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; }
  p { color: GrayText; }
</style>
</head>
<body>
<main>
  <h1>Daily read limit reached</h1>
  <p>${readLimitMessage(now)}</p>
  <p>Nothing is lost: the data is untouched and the app comes back by itself.</p>
</main>
</body>
</html>`;
}
