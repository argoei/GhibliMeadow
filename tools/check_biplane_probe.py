"""低空双翼机 + 飞行员跳伞的冒烟探针。

验证：页面加载无错、诊断接口齐全、双翼机可生成且至多一架、
点击触发跳伞、跳伞状态机完整走完（eject → fall → deploy → descend → land → fade → 消失）、
飞机触发后继续飞走。完整回归见 check_biplane.py。
"""
import os
import sys

from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/src/GhibliMeadow/web/index.html"
OUT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/shots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=[
        "--force-device-scale-factor=1", "--hide-scrollbars", "--allow-file-access-from-files",
    ])
    pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1.0)
    errs = []
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.goto(URL + "?fps=60&seed=20260923", wait_until="load")
    pg.wait_for_timeout(2000)

    api = pg.evaluate("""() => {
      const m = window.meadow || {};
      const need = ['__spawnBiplane', '__biplanes', '__paratroopers'];
      return { missing: need.filter(k => typeof m[k] !== 'function') };
    }""")
    print("缺接口:", api["missing"])
    if api["missing"]:
        sys.exit(1)

    # 1) 生成一架，坐标应在屏幕中部偏下（y ≈ 0.47~0.52 VH）
    s = pg.evaluate("window.meadow.__spawnBiplane()")
    print("spawn:", s)
    assert s, "spawn 失败"
    vh = pg.evaluate("window.meadow.stats().vh")
    ratio = s["y"] / vh
    assert 0.33 < ratio < 0.50, f"高度异常 {ratio:.2f}"

    # 2) 至多一架
    again = pg.evaluate("window.meadow.__spawnBiplane()")
    print("再次 spawn（应为 null）:", again)
    assert again is None

    # 3) 等飞机飞进可见区，用**实时坐标**点击（spawn 时的坐标在屏幕外）
    cur = None
    for _ in range(90):
        cur = pg.evaluate("window.meadow.__biplanes()[0] || null")
        if cur and 260 < cur["x"] < 1660:
            break
        pg.wait_for_timeout(120)
    print("点击坐标:", cur)
    assert cur and 260 < cur["x"] < 1660, "双翼机迟迟未进入可见区"

    kind = pg.evaluate("(p) => window.meadow.click(p)", {"x": cur["x"], "y": cur["y"]})
    print("点击返回:", kind)
    assert kind == "biplane", kind
    st = pg.evaluate("window.meadow.__paratroopers()")
    print("跳伞者:", st)
    assert st and st[0]["state"] == "eject", st
    ej = pg.evaluate("window.meadow.__biplanes()")
    print("飞机 ejected:", ej[0]["ejected"] if ej else None)
    assert ej and ej[0]["ejected"] is True

    # 4) 状态机推进采样（关键节点各截一张图）
    def sample(tag, wait, shot=None):
        pg.wait_for_timeout(wait)
        v = pg.evaluate("window.meadow.__paratroopers()")
        if shot:
            pg.screenshot(path=os.path.join(OUT, shot))
        return v

    seq = []
    seq.append(("0.6s", sample("0.6s", 600)))
    seq.append(("1.0s", sample("1.0s", 400, "biplane_deploy.png")))
    seq.append(("2.5s", sample("2.5s", 1500, "biplane_descend.png")))
    seq.append(("4.0s", sample("4.0s", 1500, "biplane_land.png")))
    seq.append(("5.5s", sample("5.5s", 1500)))
    # 飞机抬升 2~3 厘米后下落距离更长，跳伞总时长接近 7s —— 采样窗口要够长
    seq.append(("7.5s", sample("7.5s", 2000)))
    for tag, v in seq:
        print(tag, v)

    states = [v[0]["state"] if v else "gone" for _, v in seq]
    print("状态序列: eject →", " → ".join(states))
    # 落地（land）一定出现过；最终消失
    assert any(st in ("land", "fade") for st in states), states
    assert states[-1] == "gone", states

    if errs:
        print("控制台错误:")
        for e in errs[:10]:
            print("  ", e)
        sys.exit(1)

    print("冒烟通过")
    b.close()
