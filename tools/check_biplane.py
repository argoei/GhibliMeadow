"""低空双翼机 + 飞行员跳伞的回归校验。

覆盖：
  1. 自然出现路径（时钟越过 nextBiplaneAt 后自动生成）与"至多一架"约束
  2. 点击触发跳伞：返回 'biplane'、飞机标记 ejected、跳伞者进入 eject 态
  3. 已触发的飞机不再响应；点击偏离 80px 也不触发
  4. 飞机继续飞走（ejected 后坐标持续变化）
  5. 跳伞状态机完整走完：eject → … → land/fade → 消失
  6. 像素验证：descend 阶段跳伞者上方出现红色伞面（画出来的才算数）
  7. 开关关闭（set({biplane:false})）清空屏上飞机与跳伞者
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"
os.makedirs(OUT, exist_ok=True)

FAILS = []


def check(name, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  | " + str(detail)) if detail else ""))
    if not ok:
        FAILS.append(name)


def wait_visible(pg, lo=260, hi=1660, tries=110, step=120):
    """等双翼机飞进可见区，返回当前坐标"""
    cur = None
    for _ in range(tries):
        cur = pg.evaluate("window.meadow.__biplanes()[0] || null")
        if cur and lo < cur["x"] < hi:
            return cur
        pg.wait_for_timeout(step)
    return cur


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=[
        "--force-device-scale-factor=1", "--hide-scrollbars", "--allow-file-access-from-files",
    ])

    # ------------------------------------------------ 场景 1：自然出现 + 跳伞
    print("[1] 自然出现（时钟已越过 nextBiplaneAt）")
    t0 = int(time.time() * 1000) - 25000          # 让 nowSec 从 25s 起跳，首架立即自然生成
    pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1.0)
    errs = []
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.goto(URL + f"?fps=60&seed=20260923&biplaneInterval=15&t0={t0}", wait_until="load")
    pg.wait_for_timeout(800)

    cur = wait_visible(pg)
    check("自然生成了一架", cur is not None, cur)
    if not cur:
        sys.exit(1)
    check("屏幕内至多一架", len(pg.evaluate("window.meadow.__biplanes()")) == 1)
    check("__spawnBiplane 在已有飞机时拒绝再生成",
          pg.evaluate("window.meadow.__spawnBiplane()") is None)

    st = pg.evaluate("window.meadow.stats()")
    check("高度抬升 2~3 厘米后仍在地平线上方（0.33~0.50 VH）",
          0.33 < cur["y"] / st["vh"] < 0.50, f"{cur['y'] / st['vh']:.2f}")
    check("尺寸放大约 30%（基准 0.9~1.15 × 1.3）",
          0.9 * 1.3 * 0.95 < cur["s"] < 1.15 * 1.3 * 1.05, f"s={cur['s']}")

    print("\n[2] 点击触发跳伞")
    kind = pg.evaluate("(p) => window.meadow.click(p)", {"x": cur["x"], "y": cur["y"]})
    check("点击返回 biplane", kind == "biplane", kind)
    para = pg.evaluate("window.meadow.__paratroopers()")
    check("跳伞者进入 eject 态", bool(para) and para[0]["state"] == "eject", para)
    check("飞机标记 ejected",
          pg.evaluate("window.meadow.__biplanes()[0].ejected") is True)

    print("\n[3] 重复点击与偏离点击都不再触发")
    kind2 = pg.evaluate("(p) => window.meadow.click(p)", {"x": cur["x"], "y": cur["y"]})
    check("已触发的飞机不再响应", kind2 != "biplane", kind2)
    kind3 = pg.evaluate("(p) => window.meadow.click(p)",
                        {"x": cur["x"] + 80, "y": cur["y"] + 80})
    check("偏离 80px 不触发", kind3 != "biplane", kind3)
    check("跳伞者仍只有一个", len(pg.evaluate("window.meadow.__paratroopers()")) == 1)

    print("\n[4] 飞机继续飞走")
    x1 = pg.evaluate("window.meadow.__biplanes()[0].x")
    pg.wait_for_timeout(600)
    x2 = pg.evaluate("window.meadow.__biplanes()[0].x")
    check("ejected 后飞机仍在移动", x1 is not None and x2 is not None and abs(x2 - x1) > 8,
          f"{x1} → {x2}")

    print("\n[5] 跳伞状态机完整走完")
    # 注：[3][4] 的断言已经花掉约 1s，eject/fall 大概率错过 —— eject 已在 [2] 断言过，
    # 这里只要求后半段（开伞/飘落）与落地、消失全部出现。
    seen, last = [], None
    for i in range(40):
        pg.wait_for_timeout(300)
        v = pg.evaluate("window.meadow.__paratroopers()")
        s = v[0]["state"] if v else "gone"
        if not seen or seen[-1] != s:
            seen.append(s)
        last = s
        if s == "gone":
            break
    check("开伞与飘落出现过", "deploy" in seen or "descend" in seen, seen)
    check("落地或站定出现过", any(s in ("land", "fade") for s in seen), seen)
    check("最终消失", last == "gone", seen)
    print("        状态序列:", " → ".join(seen))

    if errs:
        check("无控制台错误", False, errs[:3])
    pg.close()

    # ------------------------------------------------ 场景 2：像素验证伞面
    print("\n[6] 像素验证：descend 阶段伞面真的画出来了")
    try:
        from PIL import Image
    except ImportError:
        check("PIL 可用", False, "无法做像素验证")
        Image = None

    if Image is not None:
        pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1.0)
        pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
        pg.goto(URL + "?fps=60&seed=20260923", wait_until="load")
        pg.wait_for_timeout(1500)
        check("__spawnBiplane 可用", pg.evaluate("window.meadow.__spawnBiplane()") is not None)
        cur = wait_visible(pg)
        pg.evaluate("(p) => window.meadow.click(p)", {"x": cur["x"], "y": cur["y"]})
        # 等 descend（伞全开）再截。**坐标必须在截图前读**：
        # 截图之后再读的话跳伞者已落地收伞，窗口里只剩绿色小人（首跑即踩此坑）。
        shot = None
        v = None
        for _ in range(30):
            pg.wait_for_timeout(200)
            v = pg.evaluate("window.meadow.__paratroopers()[0] || null")
            if v and v["state"] == "descend" and v["chute"] >= 0.99:
                shot = os.path.join(OUT, "biplane_chute.png")
                pg.screenshot(path=shot)
                break
        check("捕捉到伞全开的画面", shot is not None)
        if shot:
            im = Image.open(shot).convert("RGB")
            x0, y0 = int(v["x"]), int(v["y"])
            win = im.crop((max(0, x0 - 34), max(0, y0 - 64), x0 + 34, y0))
            # 判据用"红色占优"而不是绝对色值：伞面会被图标压暗层压暗，
            # 实测 #E23B3B 在压暗区变成 (170,50,54)，按绝对亮度数会得 0（首跑踩坑）。
            red = 0
            for r_, g_, b_ in list(win.getdata()):
                if r_ > 120 and (r_ - g_) > 45 and (r_ - b_) > 45:
                    red += 1
            check("伞面出现大量红色像素", red > 150, f"red={red} 窗口中心=({x0},{y0})")
            pg.screenshot(path=os.path.join(OUT, "biplane_full.png"))
            pg.screenshot(path=os.path.join(OUT, "biplane_full.png"))
        pg.close()

    # ------------------------------------------------ 场景 3：开关清空
    print("\n[7] 开关关闭清空")
    pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1.0)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.goto(URL + "?fps=60&seed=20260923", wait_until="load")
    pg.wait_for_timeout(1500)
    pg.evaluate("window.meadow.__spawnBiplane()")
    cur = wait_visible(pg)
    pg.evaluate("(p) => window.meadow.click(p)", {"x": cur["x"], "y": cur["y"]})
    pg.wait_for_timeout(300)
    check("关闭前屏上有飞机与跳伞者",
          pg.evaluate("window.meadow.__biplanes().length") == 1
          and len(pg.evaluate("window.meadow.__paratroopers()")) == 1)
    pg.evaluate("window.meadow.set({biplane: false})")
    pg.wait_for_timeout(200)
    check("关闭后飞机清空", pg.evaluate("window.meadow.__biplanes().length") == 0)
    check("关闭后跳伞者清空", pg.evaluate("window.meadow.__paratroopers().length") == 0)
    pg.close()

    if errs:
        print("\n控制台错误:")
        for e in errs[:10]:
            print("  ", e)
        FAILS.append("console errors")

    b.close()

print("\n" + ("全部通过" if not FAILS else "失败项: " + ", ".join(FAILS)))
sys.exit(1 if FAILS else 0)
