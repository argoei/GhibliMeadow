import sys, time, os
from playwright.sync_api import sync_playwright

URL_BASE = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"
os.makedirs(OUT, exist_ok=True)

jobs = [
    ("1080p",  1920, 1080, 1.0, "?fps=60&t0=1"),
    ("1440p",  2560, 1440, 1.0, "?fps=60&t0=1"),
    ("tile_check", 1600, 900, 1.0, "?fps=60&t0=1&debug=1"),
]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=[
        "--force-device-scale-factor=1", "--hide-scrollbars", "--allow-file-access-from-files",
    ])
    for name, w, h, dpr, q in jobs:
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=dpr)
        errs = []
        pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
        pg.goto(URL_BASE + q, wait_until="load")
        pg.wait_for_timeout(2200)
        # 让大部分花进入盛开状态
        pg.evaluate("window.meadow.seedBloom()")
        pg.wait_for_timeout(1200)
        st = pg.evaluate("window.meadow.stats()")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        print(name, "| stats:", st)
        if errs:
            print("   ERRORS:", errs[:6])
        pg.close()
    b.close()
print("done")
