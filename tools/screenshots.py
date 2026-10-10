"""Capture the README screenshots from a running local Worker.

    cd worker && make seed-demo PERSIST=/tmp/demo
    npx wrangler dev --port 8791 --local-upstream localhost:8791 \
        --persist-to /tmp/demo --var DEV_USER_EMAIL:you@example.com
    uv run --with playwright python tools/screenshots.py http://localhost:8791

Uses the demo household only: never point it at real data. Needs Chrome
installed (Playwright's channel="chrome").
"""

import calendar
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
today = date.today()
prev = date(today.year, today.month, 1) - timedelta(days=1)  # last day of the previous month
# The current month has no salary yet, so the Transactions shots use the previous whole month.
month = f"from={prev:%Y-%m}-01&to={prev:%Y-%m}-{calendar.monthrange(prev.year, prev.month)[1]:02d}"

# name -> (path, sizes, Transactions breakdown open?, full page on desktop)
SHOTS = {
    "summary": (f"/?year={today.year}", ("desktop", "phone"), True, True),
    "summary-monthly": (f"/?year={today.year}&tab=monthly", ("desktop", "phone"), True, True),
    "transactions": (f"/transactions?{month}", ("desktop", "phone"), False, False),
    "transactions-breakdown": (f"/transactions?{month}", ("desktop",), True, False),
    "merchants": ("/merchants", ("desktop", "phone"), True, True),
    "import": ("/import", ("desktop", "phone"), True, True),
    "payslips": ("/payslips", ("desktop", "phone"), True, True),
}
SIZES = {"desktop": (1440, 900), "phone": (390, 844)}

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    for name, (path, sizes, breakdown_open, full) in SHOTS.items():
        for size in sizes:
            w, h = SIZES[size]
            ctx = browser.new_context(
                viewport={"width": w, "height": h}, device_scale_factor=2, color_scheme="light"
            )
            ctx.add_init_script(
                f"localStorage.setItem('transactions.breakdownOpen', '{int(breakdown_open)}')"
            )
            page = ctx.new_page()
            page.goto(BASE + path)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(800)  # chart animation
            page.screenshot(path=OUT / f"{name}-{size}.png", full_page=full and size == "desktop")
            print(f"{name}-{size}.png")
            ctx.close()
    browser.close()
