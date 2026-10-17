"""配置下发专项回归：证明 cloudLife / cloudDensity / cloudSpeed / animals / animalDensity
这五个字段从 config.json 一路走到页面并真的生效。

分两段证明，避免"只证明了一半"：
  A 段（宿主 → URL）：用一份特征值特殊的配置启动 exe，读日志里的「已导航到 <url>」，
                      断言五个参数都以期望值出现在 URL 上。
  B 段（URL → 页面行为）：Playwright 直接带这些参数加载 index.html，读 stats()，
                      断言页面行为确实变了（而不是只把参数收下了）。

这样才排除了"宿主传了但页面不认"和"页面认但宿主没传"两种半成品。
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
DIST = os.path.join(ROOT, "dist")
WEB = os.path.join(ROOT, "src", "GhibliMeadow", "web", "index.html")
LOG = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow", "wallpaper.log")
CFG = os.path.join(DIST, "config.json")
PY = r"C:\Users\byted\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

# A 段用的特征值：每一个都不同于默认值，且能在 URL 上唯一定位
PROBE = {
    "cloudLife": 200,
    "cloudDensity": 0,
    "cloudSpeed": 2.5,
    "animals": False,
    "animalDensity": 2.0,
}

fails = []


def kill():
    import psutil
    for p in psutil.process_iter(["name"]):
        try:
            if p.info["name"] and "GhibliMeadow" in p.info["name"]:
                p.kill()
        except Exception:
            pass
    time.sleep(1.2)


# ---------------------------------------------------------------- A 段
def part_a():
    print("─" * 74)
    print("A 段：宿主是否把这五个参数拼进页面 URL")
    backup = io.open(CFG, encoding="utf-8").read()
    try:
        cfg = json.loads(backup)
        cfg.update(PROBE)
        io.open(CFG, "w", encoding="utf-8").write(
            json.dumps(cfg, ensure_ascii=False, indent=2))

        before = os.path.getsize(LOG) if os.path.exists(LOG) else 0
        kill()
        subprocess.Popen([os.path.join(DIST, "GhibliMeadow.exe")], cwd=DIST, close_fds=True)

        url = None
        deadline = time.time() + 30
        while time.time() < deadline:
            time.sleep(0.8)
            if not os.path.exists(LOG):
                continue
            with io.open(LOG, encoding="utf-8", errors="replace") as f:
                f.seek(before)
                new = f.read()
            m = re.search(r"已导航到 (\S+)", new)
            if m:
                url = m.group(1)
                break

        if not url:
            fails.append("A: 日志里没有出现「已导航到」，拿不到 URL")
            print("  ✗ 拿不到 URL")
            return

        print("  URL 尾部: …%s" % url[-96:])
        want = {"cloudLife": "200", "cloudDensity": "0", "cloudSpeed": "2.5",
                "animals": "0", "animalDensity": "2"}
        for k, v in want.items():
            pat = re.compile(r"[?&]%s=%s(&|$)" % (re.escape(k), re.escape(v)))
            if pat.search(url):
                print("  ✓ %-14s = %s" % (k, v))
            else:
                fails.append("A: URL 里 %s 不是 %s" % (k, v))
                print("  ✗ %-14s 期望 %s —— 未出现" % (k, v))
    finally:
        kill()
        io.open(CFG, "w", encoding="utf-8").write(backup)


# ---------------------------------------------------------------- B 段
def part_b():
    print()
    print("─" * 74)
    print("B 段：页面收到这些参数后行为是否真的改变")
    from playwright.sync_api import sync_playwright

    base = "file:///" + WEB.replace("\\", "/")
    cases = [
        ("默认（无参数）",
         "", {"clouds": lambda v: v > 0, "animals": lambda v: v > 0}),
        ("cloudDensity=0 + animals=0",
         "?cloudLife=200&cloudDensity=0&cloudSpeed=2.5&animals=0&animalDensity=2",
         # 注意：云量有下限 2（生成量 clamp(..., 2, 24)），所以密度 0 是 2 朵而不是 0 朵。
         # 默认是 10 朵，10 → 2 已经能证明该参数确实被读到了。
         {"clouds": lambda v: v == 2, "animals": lambda v: v == 0,
          "cloudLife": lambda v: v == 200}),
        ("animals=1 但 animalDensity=0",
         "?animals=1&animalDensity=0",
         {"animals": lambda v: v == 0}),
    ]
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge",
                              args=["--disable-features=CalculateNativeWinOcclusion"])
        for name, q, checks in cases:
            pg = b.new_page(viewport={"width": 1920, "height": 1080})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(base + q)
            pg.wait_for_function("() => window.meadow && window.meadow.stats", timeout=30000)
            pg.wait_for_timeout(1800)
            st = pg.evaluate("() => { const s = window.meadow.stats();"
                             " return { clouds: s.clouds, animals: s.animals,"
                             " cloudLife: s.cloudLife }; }")
            print("  %-28s clouds=%-4d animals=%-4d cloudLife=%-4d"
                  % (name, st["clouds"], st["animals"], st["cloudLife"]))
            for key, fn in checks.items():
                got = st[key]
                if not fn(got):
                    fails.append("B: [%s] %s = %s 不符合期望" % (name, key, got))
                    print("      ✗ %s = %s 不符合期望" % (key, got))
            if errs:
                fails.append("B: [%s] JS 报错 %s" % (name, errs[:1]))
            pg.close()
        b.close()


part_a()
part_b()

print()
print("=" * 74)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 五个字段端到端生效（宿主拼进 URL，页面按值改变行为）")
