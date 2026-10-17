# -*- coding: utf-8 -*-
"""多分辨率性能与坐标一致性回归测试。"""
import os
from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"
os.makedirs(OUT, exist_ok=True)

CASES = [
    ("1080p @100%", 1920, 1080, 1.0),
    ("1440p @100%", 2560, 1440, 1.0),
    ("4K    @100%", 3840, 2160, 1.0),
    ("4K    @150%", 2560, 1440, 1.5),
]

with sync_playwright() as p:
    for name, w, h, dsf in CASES:
        b = p.chromium.launch(headless=True, channel="msedge",
                              args=["--hide-scrollbars", "--allow-file-access-from-files"])
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=dsf)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL + "?fps=60&t0=1", wait_until="load")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => { window.__n=0; window.__t0=performance.now();
            const f=()=>{ window.__n++; requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
        pg.wait_for_timeout(6000)
        fps = pg.evaluate("window.__n / ((performance.now()-window.__t0)/1000)")
        st = pg.evaluate("window.meadow.stats()")
        print("%-12s %sx%s@%s  FPS=%5.1f  绘制=%5d  世界=%dx%d  画布=%s  k=%s  ui=%s"
              % (name, w, h, dsf, fps, st["calls"], st["vw"], st["vh"], st["canvas"], st["scale"], st["ui"]))
        if errs:
            print("    ERR:", errs[:3])
        if name.startswith("1080"):
            pg.screenshot(path=os.path.join(OUT, "new_1080.png"))
        b.close()
print("done")
