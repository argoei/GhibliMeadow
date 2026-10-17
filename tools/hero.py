# -*- coding: utf-8 -*-
"""渲染一张 1920x1080 的纯画面预览图（不改动任何状态）。"""
import os
from playwright.sync_api import sync_playwright
URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = r"C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots/hero.png"
p = sync_playwright().start()
b = p.chromium.launch(headless=True, channel="msedge", args=["--hide-scrollbars", "--allow-file-access-from-files"])
pg = b.new_page(viewport={"width": 1920, "height": 1080})
pg.goto(URL + "?fps=60&t0=1&planeInterval=12", wait_until="load")
pg.wait_for_timeout(2800)
pg.screenshot(path=OUT, timeout=20000)
print("saved", flush=True)
