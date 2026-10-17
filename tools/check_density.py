# -*- coding: utf-8 -*-
"""验证页面对 density / scrim / horizon 等参数的响应，以及牛羊与云的表现。"""
import os, json
from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--hide-scrollbars", "--allow-file-access-from-files"])
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text[:200]) if m.type == "error" else None)
    pg.goto(URL + "?fps=60&t0=1", wait_until="load")
    pg.wait_for_timeout(2500)

    base = pg.evaluate("window.meadow.stats()")
    print("初始:           花=%d 草=%d 云=%d 群=%d 动物=%d 调用=%d"
          % (base['flowers'], base['tufts'], base['clouds'], base.get('herds', -1),
             base.get('animals', -1), base['calls']))

    for d in (0.6, 1.6, 2.0, 1.0):
        pg.evaluate(f"window.meadow.set({{density:{d}}})")
        pg.wait_for_timeout(400)
        st = pg.evaluate("window.meadow.stats()")
        print("set density=%.1f → 花=%d 草=%d 云=%d 动物=%d  配置中的值=%s"
              % (d, st['flowers'], st['tufts'], st['clouds'], st.get('animals', -1),
                 pg.evaluate("window.meadow.config.density")))

    # 云的生命周期：跟踪单朵云的年龄推进
    pg.evaluate("window.meadow.set({density:1.0})")
    pg.wait_for_timeout(300)
    a = pg.evaluate("JSON.stringify(window.__probe===undefined?null:null)")
    print("\n云速/寿命检查（连拍 4 秒，看云的位置与尺寸是否在变）:")
    pg.screenshot(path=os.path.join(OUT, "anim_t0.png"))
    pg.wait_for_timeout(4000)
    pg.screenshot(path=os.path.join(OUT, "anim_t4.png"))

    if errs:
        print("\nERR:", errs[:6])
    else:
        print("\n无 JS 错误")
    b.close()

import numpy as np
from PIL import Image
x = np.asarray(Image.open(os.path.join(OUT, "anim_t0.png")).convert("RGB")).astype(np.int16)
y = np.asarray(Image.open(os.path.join(OUT, "anim_t4.png")).convert("RGB")).astype(np.int16)
d = np.abs(x - y).max(axis=2)
print("4 秒内 天空变化=%.2f%%  草地变化=%.2f%%"
      % (100.0 * (d[:560] > 6).mean(), 100.0 * (d[620:] > 6).mean()))
