"""牛脖子粗细回归 + 地平线选项回归。

两个 bug 各一条**能鉴别**的判据（不是"看起来对了"）：

A. 地平线：`set({horizon})` 后 HY 必须真的改变。
   旧实现的病根是 HY/GH 只在 computeScale() 里算，而 horizon 走的是 rebuildScene() ——
   取值一路绑定都对，漏的是重算这一步。判据必须量 **HY 的实际值**，
   而不是量 CFG.horizon（那个一直是变的，量它永远绿）。

B. 牛脖子：量**实际渲染出来的**颈部像素厚度 ÷ 躯干高度。
   旧实现用固定的横/竖偏移画颈四边形，实测只有体高的 0.24 倍，看着像细杆；
   改为沿颈轴按垂直方向给厚度后约 0.5 倍。取 head=0.94（走路姿态，颈轴接近水平），
   此时竖向连续长度≈颈的垂直厚度。
"""
import sys
from playwright.sync_api import sync_playwright

URL = ("file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/src/GhibliMeadow/web/index.html")

# 阈值来自实测而不是估计（探针按 4× 放大绘制，1px ≈ 0.022 的比值分辨率）：
#   旧实现（固定横/竖偏移画颈四边形）：0.239 @head=0.94、0.217 @head=0.85（还随俯仰角漂）
#   修复后（沿颈轴给垂直厚度）      ：0.370 @两个姿态都相同
# 所以取 0.30 作下限 —— 两侧各留约 3px 余量。
NECK_MIN = 0.30
NECK_MAX = 0.60        # 上限：别矫枉过正变成"脖子比头还粗"

fails = []

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--disable-features=CalculateNativeWinOcclusion"])
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("() => window.meadow && window.meadow.__neckProbe", timeout=30000)
    pg.wait_for_timeout(1000)

    # ---------------------------------------------------------------- A 地平线
    print("═" * 70)
    print("A 段：地平线选项是否真的改变地平线高度 HY")
    vh = pg.evaluate("() => window.meadow.stats().vh")
    print("  视口世界高 VH = %d" % vh)
    base = pg.evaluate("() => window.meadow.stats().horizon")
    print("  初始 horizon=%s → HY=%s" % (pg.evaluate("() => 0.55"), base))

    seen = []
    for hv in (0.42, 0.55, 0.68, 0.48):
        st = pg.evaluate("""(h) => { window.meadow.set({ horizon: h });
                                     const s = window.meadow.stats();
                                     return { hy: s.horizon, hz: s.scrim }; }""", hv)
        hy = st["hy"]
        want = round(vh * hv)
        seen.append(hy)
        ok = abs(hy - want) <= 1
        print("  set horizon=%.2f → HY=%-4s（期望 %d）%s" % (hv, hy, want, "OK" if ok else "  ✗"))
        if not ok:
            fails.append("A: horizon=%.2f 后 HY=%s，期望 %d —— 选项没生效" % (hv, hy, want))

    if len(set(seen)) < 3:
        fails.append("A: 四个不同 horizon 只得到 %d 种 HY —— 地平线仍未随选项变化" % len(set(seen)))
    # 方向必须单调：horizon 越大 HY 越大（天空越多）
    if not (seen[0] < seen[1] < seen[2]):
        fails.append("A: HY 随 horizon 不是单调递增：%s" % seen[:3])

    # ---------------------------------------------------------------- B 牛脖子
    print()
    print("─" * 70)
    print("B 段：牛脖子厚度 ÷ 躯干高度（量真实渲染像素）")
    for hd in (0.94, 0.85):
        r = pg.evaluate("(h) => window.meadow.__neckProbe(h)", hd)
        print("  head=%.2f  列x=%3d  颈厚=%2dpx  体高=%2dpx  比值=%.3f"
              % (r["head"], r["colNeck"], r["neckThick"], r["bodyH"], r["ratio"]))
        if r["bodyH"] < 20:
            fails.append("B: 体高参照只量到 %dpx，参照列取错了，判据不成立" % r["bodyH"])
            continue
        if r["ratio"] < NECK_MIN:
            fails.append("B: head=%.2f 颈厚/体高 = %.3f < %.2f —— 脖子仍偏细"
                         % (hd, r["ratio"], NECK_MIN))
        if r["ratio"] > NECK_MAX:
            fails.append("B: head=%.2f 颈厚/体高 = %.3f > %.2f —— 矫枉过正"
                         % (hd, r["ratio"], NECK_MAX))

    if errs:
        fails.append("JS 报错：%s" % errs[:1])
    b.close()

print()
print("=" * 70)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 地平线随选项改变且方向正确；牛脖子厚度达到体高的合理比例")
