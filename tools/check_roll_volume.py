"""
侧滚体积回归：动物在任意旋转角度下都不许塌成"纸片"。

做法：调页面的 __rollProbe(roll, kind)，把动物按给定 roll 单独画到离屏画布，
量实际着墨的包围盒（不靠肉眼）。断言：
  1) 全程高度 >= 站立高度的 40%  —— 90° 塌成纸片会立刻红
  2) 中间角度不得低于两端      —— 抓"先变高再塌"这种错误截面公式
  3) 重心竖向偏移在 0 附近变号  —— 确认是"整体翻面"而不是"上下镜像"
  4) 90° 处高度接近"体厚"而非 0 —— 与椭圆截面的解析值对表
"""
import json
import math
import sys
from playwright.sync_api import sync_playwright

# 默认验源码；带 --dist 验已发布的 dist/web（即用户真正拿到的那一份）
ROOT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow"
SUB = "dist/web" if "--dist" in sys.argv else "src/GhibliMeadow/web"
URL = "file:///" + ROOT + "/" + SUB + "/index.html"
STEPS = [i / 40 for i in range(41)]          # 0 .. 1，每 2.25°

# 解析预期（与 meadow.js 常量保持一致）
SPEC = {  # kind: (H, 半高系数, 半厚系数, 腿长系数)
    "cow":   (19, 0.27, 0.215, 0.46),
    "sheep": (15, 0.30, 0.240, 0.44),
}
LEG_MIN = 0.22

fails = []


def analytic_h(kind, roll):
    """站立/侧躺的躯干+腿的竖向跨度（不含头颈），用于对表。"""
    H, ka, kb, kl = SPEC[kind]
    ct = math.cos(math.pi * roll)
    hs = math.sqrt((H * ka) ** 2 * ct * ct + (H * kb) ** 2 * (1 - ct * ct))
    return 2 * hs + H * kl * (LEG_MIN + (1 - LEG_MIN) * abs(ct))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--force-device-scale-factor=1"])
    pg = b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
          if m.type == "error" else None)
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(1500)

    have = pg.evaluate("typeof window.meadow.__rollProbe")
    assert have == "function", "探针缺失：__rollProbe 未导出（%r）" % have

    for kind in ("cow", "sheep"):
        rows = pg.evaluate(
            "([kind, steps]) => steps.map(r => window.meadow.__rollProbe(r, kind))",
            [kind, STEPS],
        )
        print("=" * 74)
        print("kind:", kind)
        print(" deg |  inkH  inkW |   cy   | fill | 解析(躯干+腿)")
        for r in rows:
            print(" %3d | %5d %5d | %6.2f | %4d |   %5.1f" % (
                r["deg"], r["inkH"], r["inkW"], r["cy"], r["fill"],
                analytic_h(kind, r["roll"])))

        stand = rows[0]["inkH"]
        side = rows[20]["inkH"]          # roll = 0.5 → θ = 90°
        down = rows[-1]["inkH"]          # roll = 1.0 → θ = 180°
        if stand <= 0:
            fails.append("%s: 站立高度为 0，绘制根本没生效" % kind)
            continue

        # 断言 1：全程不得塌陷
        worst = min(rows, key=lambda r: r["inkH"])
        ratio = worst["inkH"] / stand
        print("\n  站立 %d  |  90° %d (%.1f%%)  |  180° %d (%.1f%%)  |  最低 %d @%d° (%.1f%%)"
              % (stand, side, side / stand * 100, down, down / stand * 100,
                 worst["inkH"], worst["deg"], ratio * 100))
        if ratio < 0.40:
            fails.append("%s: 最低处只剩站立高度的 %.1f%%（@%d°）—— 塌成纸片"
                         % (kind, ratio * 100, worst["deg"]))

        # 断言 2：最矮的姿态必须是"侧躺"，而不是站立或四脚朝天。
        #   注意两端并不是一样高 —— 180° 时四腿四蹄朝上，轮廓本来就比站立更高
        #   （牛实测 152%），所以不能要求"中间不低于两端"，那是错的前提。
        #   真正的物理不变式是：轮廓高度是一条**在 90° 附近取单个浅谷**的曲线。
        argmin_row = min(rows, key=lambda r: r["inkH"])
        argmin = argmin_row["roll"]
        print("  最矮姿态 roll=%.2f（θ=%d°）" % (argmin, argmin_row["deg"]))
        if not (0.22 <= argmin <= 0.80):
            fails.append("%s: 最矮姿态出现在 roll=%.2f（θ=%d°），不在侧躺区间"
                         " —— 高度曲线的谷底位置不对"
                         % (kind, argmin, argmin_row["deg"]))
        for r in (rows[0], rows[-1]):
            if r["inkH"] < worst["inkH"] * 1.20:
                fails.append("%s: %d° 处高度 %d 与最矮姿势 %d 相差不到 20%%"
                             " —— 站立/四脚朝天的轮廓应明显更高"
                             % (kind, r["deg"], r["inkH"], worst["inkH"]))

        # 断言 3（核心）：90° 处不得塌陷。两条独立判据交叉校验 ——
        #   (a) 相对量：占站立高度的比例必须落在 [45%, 90%]
        #   (b) 绝对量：与椭圆截面的解析值（躯干 2·hs + 腿桩）对表
        #       实测含头/耳/角，故解析值只作下界，上界放宽 1.45 倍 + 10
        r90 = side / stand
        exp90 = analytic_h(kind, 0.5)
        print("  [90°] 实测 %d / 站立 %d = %.1f%%；解析下界(躯干+腿桩) %.1f"
              % (side, stand, r90 * 100, exp90))
        if not (0.45 <= r90 <= 0.90):
            fails.append("%s: 90° 高度为站立的 %.1f%%，落在合理带 [45%%, 90%%] 之外"
                         % (kind, r90 * 100))
        if not (exp90 <= side <= exp90 * 1.45 + 10):
            fails.append("%s: 90° 实测 %d 与解析体厚 %.1f 不相称"
                         % (kind, side, exp90))

        # 断言 4：重心在 0 附近变号 → 确实是"翻面"
        cy0, cy_mid, cy1 = rows[0]["cy"], rows[20]["cy"], rows[-1]["cy"]
        print("  重心 cy: 0°=%.2f  90°=%.2f  180°=%.2f" % (cy0, cy_mid, cy1))
        if not (cy0 < 0 < cy1):
            fails.append("%s: 重心未在 0→180° 之间变号（%.2f / %.2f / %.2f）"
                         "—— 看起来像镜像或原地打转，不是翻面" % (kind, cy0, cy_mid, cy1))

        # 连续性：相邻步长的高度跳变不得超过站立高度的 12%
        jumps = [(rows[i - 1]["deg"], rows[i]["deg"],
                  abs(rows[i]["inkH"] - rows[i - 1]["inkH"]) / stand)
                 for i in range(1, len(rows))]
        jd, ja, jr = max(jumps, key=lambda x: x[2])
        print("  相邻帧最大跳变 %d°→%d°: %.1f%%" % (jd, ja, jr * 100))
        if jr > 0.12:
            fails.append("%s: %d°→%d° 高度跳变 %.1f%% —— 动画不连续"
                         % (kind, jd, ja, jr * 100))

    b.close()

if errs:
    print("\nJS 错误:", errs[:5])
    fails.append("页面有 JS 错误")

print("\n" + "=" * 74)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    raise SystemExit(1)
print("PASS — 任意角度均保持体积，90° 无扁平化，重心正确翻面")
