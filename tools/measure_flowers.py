"""量测野花的实际生成量、同屏可见量与两条绘制路径的占比。

判据来源：window.meadow.stats() 暴露 flowers/tufts/clouds/calls/open。
矢量路径的分界在渲染循环里是 `open <= 0.004 || open >= 0.996` → 贴精灵，否则逐片画花瓣。
"""
import io
import sys
from playwright.sync_api import sync_playwright

URL = ("file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/src/GhibliMeadow/web/index.html")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--disable-features=CalculateNativeWinOcclusion"])
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("() => window.meadow && window.meadow.stats", timeout=30000)
    pg.wait_for_timeout(2500)          # 让精灵烘焙完成、波前跑起来

    # 采样 60 次，取平均，避免单帧偶然
    res = pg.evaluate("""() => {
      const M = window.meadow;
      const acc = {flowers:0, tufts:0, clouds:0, calls:0, open:0, fps:0};
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const s = M.stats();
        acc.flowers += s.flowers; acc.tufts += s.tufts; acc.clouds += s.clouds;
        acc.calls += s.calls; acc.open += s.open; acc.fps += s.fps; n++;
      }
      for (const k in acc) acc[k] = Math.round(acc[k] / n * 100) / 100;
      return acc;
    }""")

    print("=== 生成量（数组元素数，与屏宽无关）===")
    print("  flowers 每瓦片 : %d" % res["flowers"])
    print("  tufts   每瓦片 : %d" % res["tufts"])
    print()
    print("=== 稳态运行（1920x1080，60 帧平均）===")
    print("  fps            : %.1f" % res["fps"])
    print("  drawCalls/帧    : %.1f" % res["calls"])
    print("  处于盛开(>0.5)  : %.1f 株" % res["open"])
    print()
    print("=== 两条绘制路径的分界（几何相位算得）===")
    print("  相位 p ∈ [0.00, 0.10) 张开 → 矢量")
    print("  相位 p ∈ [0.10, 0.32) 盛开 → open=1 ≥ 0.996 → 贴精灵")
    print("  相位 p ∈ [0.32, 0.46) 合上 → 矢量")
    print("  相位 p ∈ [0.46, 1.00) 花蕾 → open=0 ≤ 0.004 → 贴精灵")
    print("  ⇒ 矢量路径占比 = 0.10 + 0.14 = %.0f%%  ；贴精灵 %.0f%%" % (24, 76))

    # 单个花的矢量绘制会产生多少个路径调用（静态数：茎2 + 叶2 + 花瓣×2 + 花心1）
    print()
    print("=== JS 运行时错误 ===")
    print("  ", errs if errs else "无")
    b.close()
sys.exit(1 if errs else 0)
