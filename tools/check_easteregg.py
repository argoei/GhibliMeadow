# -*- coding: utf-8 -*-
"""验证彩蛋：命中判定、彩纸数量、以及"受阻力约束的抛洒"物理。"""
import os, time
from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = r"C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"

p = sync_playwright().start()
b = p.chromium.launch(headless=True, channel="msedge", args=["--hide-scrollbars","--allow-file-access-from-files"])
pg = b.new_page(viewport={"width":1920,"height":1080})
errs = []
pg.on("pageerror", lambda e: errs.append(str(e)))
pg.on("console", lambda m: errs.append(m.type + ": " + m.text[:160]) if m.type == "error" else None)
pg.goto(URL + "?fps=60&t0=1&planeInterval=8", wait_until="load")
pg.wait_for_timeout(3000)

# 等一架飞机进入画面
st = None
for _ in range(40):
    st = pg.evaluate("window.meadow.stats()")
    if 200 < st.get("planeX", -1) < 1700:
        break
    pg.wait_for_timeout(400)
print("客机位置:", st.get("planeX"), st.get("planeY"), "方向", st.get("planeDir"))

# 故意打偏，应当不触发
miss = pg.evaluate(f"window.meadow.click({{x:{st['planeX']+300}, y:{st['planeY']+200}}})")
print("打偏 300px 的结果:", miss, " 彩纸数:", pg.evaluate("window.meadow.stats().confetti"))

hit = pg.evaluate(f"window.meadow.click({{x:{st['planeX']}, y:{st['planeY']}}})")
s0 = pg.evaluate("window.meadow.stats()")
print("命中结果:", hit, " 彩纸数:", s0["confetti"], " 横向散布:", s0["confSpread"])

print("\n阻力验证（若是自由落体，vy 会一路线性增长；受阻力则应收敛到终端速度）:")
for k in range(9):
    pg.wait_for_timeout(350)
    s = pg.evaluate("window.meadow.stats()")
    print("   t=%5.2fs  数量=%3d  平均 vy=%4d 世界px/s  横向散布=%4d" %
          ((k+1)*0.35, s["confetti"], s["confVy"], s["confSpread"]))
    if k in (1, 3):
        pg.screenshot(path=os.path.join(OUT, "conf_%d.png" % k))

st2 = pg.evaluate("window.meadow.stats()")
print("\n最终：彩纸=%d，绘制调用=%d，FPS=%.1f" % (st2["confetti"], st2["calls"], st2["fps"]))
print("ERR:" if errs else "无 JS 错误", errs[:4])
import sys; sys.stdout.flush()
