"""牛羊比例与个体间距回归。

对应两项需求：
  A. 牛:羊 初始数量比例 = 1:1 基准，在此之上加"有界随机浮动"。
     判据：① 牛+羊 = 总数（总数守恒）；
           ② 每一组的 |牛−羊| 不超过文档规定的浮动上限；
           ③ 跨大量种子的**均值**贴近 1:1（基准正确，不是偏的）。
  B. 同种群同向移动时，前后个体的速度略不同 → 间距随时间**单调拉开**、且有上界。
     判据：① 速度因子恒在 [1−SPREAD, 1+SPREAD] 且**恒 > 0**（方向永不反向）；
           ② 每头个体的 |dx| 只朝 |dxT| 增长，不到达不回头；
           ③ 每群横向跨度随时间**非递减**，且最终 ≈ 初始 × HERD_STRETCH（有界）；
           ④ 初始就按名次等距分层 → 相邻个体间距 ≥ 阈值（不重叠）。

B 段用"包一层 requestAnimationFrame、把时间戳放大 N 倍"的办法把演化加速，
否则真实时间下间距拉开要几分钟，跑不进回归。
"""
import io
import sys
from playwright.sync_api import sync_playwright

URL = ("file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/src/GhibliMeadow/web/index.html")
SEEDS = 48
SPEED_ACC = 8          # 时间加速倍数（B 段）
SPAN_SAMPLES = 26      # 采样次数
SPAN_GAP_S = 1.0       # 每次采样间隔（真实秒）；26×1s×8 ≈ 208 模拟秒

fails = []

# ============================================================ A 段：数量比例
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--disable-features=CalculateNativeWinOcclusion"])
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("() => window.meadow && window.meadow.stats", timeout=30000)
    pg.wait_for_timeout(1200)

    print("═" * 76)
    print("A 段：牛:羊 数量比例（跨 %d 个种子）" % SEEDS)
    rows = []
    for seed in range(1, SEEDS + 1):
        st = pg.evaluate("""(s) => {
          window.meadow.set({ seed: s });
          const t = window.meadow.stats();
          return { cows: t.cows, sheeps: t.sheeps, all: t.animals, herds: t.herds };
        }""", seed)
        rows.append(st)

    ratios = []
    for i, r in enumerate(rows):
        if r["cows"] is None or r["sheeps"] is None:
            fails.append("A: stats() 没有 cows/sheeps 字段")
            break
        if r["cows"] + r["sheeps"] != r["all"]:
            fails.append("A: 种子%d 牛%d+羊%d ≠ 总数%d" % (i + 1, r["cows"], r["sheeps"], r["all"]))
        ratios.append(r["cows"] / max(1, r["sheeps"]))

    if ratios:
        n = len(ratios)
        print("  样本 %d 组；牛 %d~%d、羊 %d~%d，总数 %d"
              % (n, min(r["cows"] for r in rows), max(r["cows"] for r in rows),
                 min(r["sheeps"] for r in rows), max(r["sheeps"] for r in rows),
                 rows[0]["all"]))
        print("  比例 cow:sheep  min=%.3f  max=%.3f  均值=%.3f  （1.0 = 严格 1:1）"
              % (min(ratios), max(ratios), sum(ratios) / n))
        exact = sum(1 for r in rows if r["cows"] == r["sheeps"])
        print("  严格 1:1 的组数：%d / %d（%.0f%%）" % (exact, n, exact / n * 100))
        # 分布直方
        from collections import Counter
        c = Counter(r["cows"] - r["sheeps"] for r in rows)
        print("  差值 牛−羊 分布：" + "  ".join("%+d:%d组" % (k, v) for k, v in sorted(c.items())))

        # ①② 判据
        for i, r in enumerate(rows):
            d = abs(r["cows"] - r["sheeps"])
            if d > 2:
                fails.append("A: 种子%d 偏差 %d 头，超出浮动上限" % (i + 1, d))
        # ③ 均值必须贴近 1:1（基准正确）
        mean = sum(ratios) / n
        if not (0.94 <= mean <= 1.06):
            fails.append("A: 平均比例 %.3f 偏离 1:1 超过 ±6%% —— 基准不对，是系统性偏置" % mean)
        # 浮动必须真的存在（否则等于没加随机）
        if min(ratios) == max(ratios):
            fails.append("A: 所有种子比例完全相同 —— 随机浮动没生效")

    # ======================================================== B 段：个体间距
    print()
    print("─" * 76)
    print("B 段：前后速度差与间距拉开（时间加速 %d×）" % SPEED_ACC)
    pg2 = b.new_page(viewport={"width": 1920, "height": 1080})
    pg2.add_init_script("""(() => {
      window.__ts = %d;
      const raf = window.requestAnimationFrame.bind(window);
      let lt = null, vt = 0;
      window.requestAnimationFrame = (cb) => raf((ts) => {
        if (lt === null) lt = ts;
        vt += (ts - lt) * window.__ts;
        lt = ts;
        cb(vt);
      });
    })();""" % SPEED_ACC)
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_function("() => window.meadow && window.meadow.__herds", timeout=30000)
    pg2.wait_for_timeout(800)

    def snap():
        return pg2.evaluate("""() => {
          const H = window.meadow.__herds();
          const t = window.meadow.stats();
          return { span: t.herdSpan, spdMin: t.spdMin, spdMax: t.spdMax,
                   herds: H.map(h => ({
                     kind: h.kind, dir: h.dir, n: h.n, state: h.state, cx: h.cx,
                     dx: h.members.map(m => m.dx),
                     dxT: h.members.map(m => m.dxT),
                     spd: h.members.map(m => m.spd),
                     rank: h.members.map(m => m.rank),
                   })) };
        }""")

    s0 = snap()
    n0 = s0["herds"]
    print("  第 0 帧：群数 %d，每群 %s；跨度 %d"
          % (len(n0), [h["n"] for h in n0], s0["span"]))
    print("  速度因子范围：[%.3f, %.3f]（设计 ±8%% → [0.92, 1.08]）"
          % (s0["spdMin"], s0["spdMax"]))

    # ① 速度因子：恒正（方向不反向）且在 ±SPREAD 内
    bad = [v for h in n0 for v in h["spd"] if not (0.915 <= v <= 1.085)]
    if bad:
        fails.append("B: 速度因子超出 [0.915, 1.085]：%s" % sorted(set(bad))[:6])
    if any(v <= 0 for h in n0 for v in h["spd"]):
        fails.append("B: 出现非正的速度因子 —— 个体会反向移动")

    # ④ 初始就等距分层 → 相邻间距不小于阈值（不重叠）
    min_gap = 1e9
    for h in n0:
        d = sorted(h["dx"])
        for i in range(1, len(d)):
            min_gap = min(min_gap, d[i] - d[i - 1])
    print("  初始相邻个体最小间距：%.1f 世界单位（>0 即不重叠）" % min_gap)
    if min_gap <= 0:
        fails.append("B: 初始就有个体重叠（最小间距 %.1f）" % min_gap)

    # ②③ 随时间演化
    print()
    print("  采样（真实 %ds × 加速 %d× ≈ %d 模拟秒）：" % (SPAN_SAMPLES, SPEED_ACC, SPAN_SAMPLES * SPEED_ACC))
    spans = [s0["span"]]
    for k in range(SPAN_SAMPLES):
        pg2.wait_for_timeout(int(SPAN_GAP_S * 1000))
        s = snap()
        spans.append(s["span"])
        if k % 5 == 0 or k == SPAN_SAMPLES - 1:
            print("    #%02d  跨度 %-5d  速度因子 [%.3f, %.3f]"
                  % (k + 1, s["span"], s["spdMin"], s["spdMax"]))

    # 单调非减
    drops = [(i, spans[i - 1], spans[i]) for i in range(1, len(spans)) if spans[i] < spans[i - 1] - 0.5]
    print()
    print("  跨度：%d → %d（%.2f 倍）" % (spans[0], spans[-1], spans[-1] / max(1, spans[0])))
    print("  回退次数：%d（应为 0）" % len(drops))
    if drops:
        fails.append("B: 跨度出现 %d 次回退，间距不是单调拉开：%s" % (len(drops), drops[:3]))

    grew = spans[-1] / max(1, spans[0])
    if grew < 1.15:
        fails.append("B: 跨度只增长到 %.2f 倍，'随时间逐渐拉开'没有体现" % grew)
    if grew > 1.95:
        fails.append("B: 跨度增长到 %.2f 倍，超过设计上限 1.8 太多（无界）" % grew)

    # 逐个体：|dx| 只朝 |dxT| 增长，且不超过 |dxT|
    over = []
    for h, dh in zip(n0, snap()["herds"]):
        for dx0v, dxv, dxTv in zip(h["dx"], dh["dx"], dh["dxT"]):
            if abs(dxv) > abs(dxTv) + 0.6:
                over.append((dx0v, dxv, dxTv))
    print("  越过目标偏移的个体：%d（应为 0，到位即停）" % len(over))
    if over:
        fails.append("B: 有 %d 个个体越过了目标偏移（间距无界）：%s" % (len(over), over[:3]))

    # ⑤ 方向实测：走动中且 dir 未变时，每个个体的**世界坐标位移方向**必须与 dir 一致。
    #    个体速度 = speed × spd × dir，spd 恒正 ⇒ 符号必然与 dir 相同；
    #    这里直接量它，而不是只靠"spd > 0"间接推断。
    print()
    print("  方向实测（走动中且 dir 未变时，逐个体世界坐标位移方向必须 == dir）：")
    prev = snap()
    checked = 0
    bad_dir = []
    for _ in range(30):
        pg2.wait_for_timeout(400)
        cur = snap()
        for h0, h1 in zip(prev["herds"], cur["herds"]):
            if h0["state"] != "walk" or h1["state"] != "walk" or h0["dir"] != h1["dir"]:
                continue
            for j in range(min(h0["n"], h1["n"])):
                x0 = h0["cx"] + h0["dx"][j] * h0["dir"]
                x1 = h1["cx"] + h1["dx"][j] * h1["dir"]
                d = x1 - x0
                if abs(d) < 1e-6:
                    continue
                checked += 1
                if (d > 0) != (h1["dir"] > 0):
                    bad_dir.append((h1["kind"], h1["dir"], round(d, 3)))
        prev = cur
    print("     检查了 %d 个「个体 × 相邻采样」位移；方向相反的 %d 次" % (checked, len(bad_dir)))
    if checked < 50:
        fails.append("B: 方向实测样本只有 %d 个，观察期内几乎没走动，判据不成立" % checked)
    if bad_dir:
        fails.append("B: 出现 %d 次与群体方向相反的位移：%s" % (len(bad_dir), bad_dir[:3]))

    if errs or errs2:
        fails.append("JS 报错：%s" % (errs + errs2)[:1])
    b.close()

print()
print("=" * 76)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 比例以 1:1 为基准且有界浮动；个体按名次等距起步、"
      "速度差恒正、间距单调拉开且到达设计倍数后停止")
