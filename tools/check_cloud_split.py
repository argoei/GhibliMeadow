# -*- coding: utf-8 -*-
"""
云朵分裂过渡回归：必须是「渐进裂开」，不能是「瞬间换成两块」。

用页面里的 rAF 采样器逐帧取真值（`__splits()` 返回每帧**实际画出来的**部件），
再在 Python 里判：

  1) 过渡帧数 ≥ 8、k 严格递增、覆盖 0→1     —— 是过程，不是跳变
  2) 实测时长 ≈ CLOUD_SPLIT_ANIM ±20%       —— 过渡确实跑满了
  3) 母云宽单调变窄、两朵子云的合计宽单调变大 —— 形变是渐进的，不是一帧到位
  4) 两朵子云的中心距单调变大                —— "分离"是渐进的
  5) 可见质量逐帧连续（无陡跳/深坑/尖峰）    —— 整段没有"凭空多一块/少一块"
  6) 交接那一帧几乎不可辨                    —— 过渡末帧的子云 α 与宽
                                                必须≈过渡后主列表里那两朵云的 α 与宽
用法：
  python tools/check_cloud_split.py           验源码
  python tools/check_cloud_split.py --dist    验已发布产物
"""
import sys
from playwright.sync_api import sync_playwright

ROOT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow"
SUB = "dist/web" if "--dist" in sys.argv else "src/GhibliMeadow/web"
URL = "file:///" + ROOT + "/" + SUB + "/index.html?fps=30&t0=1"

fails = []

# 挑一朵够大的云，开采样器，并立刻点它
ARM = """
() => {
  const M = window.meadow;
  const cs = M.__clouds();
  const minW = M.__cloudSplitMin;          // 是值，不是函数
  let idx = -1;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].rwBody >= minW + 40 && cs[i].a >= 0.45) { idx = i; break; }
  }
  if (idx < 0) return { err: '没有可分裂的云（阈值 ' + minW + '）', n: cs.length };
  const c = cs[idx];
  window.__tr = [];
  window.__on = true;
  const t0 = performance.now();
  const step = () => {
    const sp = M.__splits();
    const lf = sp.lastFrame[0] || null;
    const rec = { t: performance.now() - t0, inFlight: sp.inFlight };
    if (lf) {
      rec.k = lf.k; rec.mA = lf.motherA; rec.mW = lf.motherW; rec.mH = lf.motherH;
      rec.mX = lf.motherX;
      rec.kA = lf.kids.map(z => z.a); rec.kW = lf.kids.map(z => z.w);
      rec.kH = lf.kids.map(z => z.h); rec.kX = lf.kids.map(z => z.x);
    }
    window.__tr.push(rec);
    if (window.__on && performance.now() - t0 < 3000) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const hit = M.click({ x: c.x, y: c.py });
  return { idx: idx, before: c, hit: hit,
           expectAnim: M.__cloudSplitAnim, minW: minW };
}
"""


def monotone(seq, inc=1):
    """返回第一处违反单调的索引（inc=1 要求不减，inc=-1 要求不增），全对返回 -1。"""
    for i in range(1, len(seq)):
        if inc > 0 and seq[i] < seq[i - 1] - 1e-9:
            return i
        if inc < 0 and seq[i] > seq[i - 1] + 1e-9:
            return i
    return -1


with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="msedge",
                           args=["--force-device-scale-factor=1"])
    pg = br.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
          if m.type == "error" else None)
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(2200)
    pg.evaluate("window.meadow.seedBloom()")
    pg.wait_for_timeout(800)

    arm = pg.evaluate(ARM)
    print("起手:", arm)
    if arm.get("err"):
        print("✗", arm["err"])
        sys.exit(1)
    if arm.get("hit") != "cloud":
        fails.append("点击云没触发分裂（返回 %r）" % arm.get("hit"))

    pg.wait_for_timeout(1400)
    pg.evaluate("window.__on = false")
    tr = pg.evaluate("window.__tr")
    after = pg.evaluate("window.meadow.__clouds()")
    br.close()

if errs:
    print("JS 错误:", errs[:5])
    fails.append("页面有 JS 错误")

seg = [r for r in tr if "k" in r]
# 采样器的 rAF 可能比页面的渲染帧率快（120Hz 采样 / 30fps 渲染），
# 于是会连着读到同一帧的真值。**按 k 去重**，否则"过渡帧数 ≥ 8"会被重复帧灌水。
uniq = []
for r in seg:
    if not uniq or r["k"] != uniq[-1]["k"]:
        uniq.append(r)
print("采样 %d 帧 → 去重后 %d 个真实渲染帧（过渡段）" % (len(seg), len(uniq)))
seg = uniq
if not seg:
    print("✗ 没有任何过渡帧 —— 分裂根本没发生")
    sys.exit(1)

print("\n  t(ms)    k    母云α  母云宽 | 子云α         子云宽        间距   质量")
masses = []
for r in seg:
    m = r["mA"] * r["mW"] * r["mH"] + sum(a * w * h for a, w, h in zip(r["kA"], r["kW"], r["kH"]))
    masses.append(m)
    print("  %6.0f  %.3f  %.3f  %5d | %-13s %-13s %6.1f %7.0f"
          % (r["t"] - seg[0]["t"], r["k"], r["mA"], r["mW"],
             " ".join("%.3f" % v for v in r["kA"]),
             " ".join("%d" % v for v in r["kW"]),
             r["kX"][1] - r["kX"][0] if len(r["kX"]) > 1 else 0, m))

ks = [r["k"] for r in seg]
span = (seg[-1]["t"] - seg[0]["t"]) / 1000.0
tgt = arm["expectAnim"]
print("\n实测过渡 %.3fs（设计 %.2fs）  k: %.3f → %.3f" % (span, tgt, ks[0], ks[-1]))

# 1) 是过程而不是跳变
if len(seg) < 8:
    fails.append("过渡只采到 %d 帧，不足 8 帧 —— 太快，看不出渐进过程" % len(seg))
i = monotone(ks, +1)
if i >= 0:
    fails.append("k 在第 %d 帧回退（%.3f → %.3f），过渡不单调" % (i, ks[i - 1], ks[i]))
if ks[0] > 0.12:
    fails.append("过渡首帧 k 已经 %.3f，起手就是跳变" % ks[0])
if ks[-1] < 0.90:
    fails.append("过渡末帧 k 只有 %.3f，没跑到尾" % ks[-1])

# 2) 时长
if not (tgt * 0.80 <= span <= tgt * 1.20):
    fails.append("实测过渡 %.3fs 偏离设计 %.2fs 超过 20%%" % (span, tgt))

# 3) 形变渐进
i = monotone([r["mW"] for r in seg], -1)
if i >= 0:
    fails.append("母云宽在第 %d 帧变大（%d → %d），不是逐步收窄"
                 % (i, seg[i - 1]["mW"], seg[i]["mW"]))
totW = [sum(r["kW"]) for r in seg]
i = monotone(totW, +1)
if i >= 0:
    fails.append("子云合计宽在第 %d 帧变小（%d → %d），不是逐步长大"
                 % (i, totW[i - 1], totW[i]))

# 4) 分离渐进
seps = [r["kX"][1] - r["kX"][0] for r in seg if len(r["kX"]) > 1]
i = monotone(seps, +1)
if i >= 0:
    fails.append("两朵子云间距在第 %d 帧变小（%.1f → %.1f），分离不是渐进的"
                 % (i, seps[i - 1], seps[i]))
print("两朵子云间距: %.1f → %.1f（首→末）" % (seps[0], seps[-1]))
# 末态必须真的"分开"：中心距 > 单朵宽，才有肉眼可见的缝
if seps[-1] <= seg[-1]["kW"][0]:
    fails.append("末态中心距 %.1f ≤ 单朵宽 %d —— 两朵仍叠在一起，看不出'分成两块'"
                 % (seps[-1], seg[-1]["kW"][0]))

# 5) 可见质量连续
m0 = masses[0]
jumps = [(seg[i]["k"], abs(masses[i] - masses[i - 1]) / m0) for i in range(1, len(masses))]
jk, jr = max(jumps, key=lambda x: x[1])
print("可见质量: 首 %.0f  最低 %.0f（%.0f%%）  最高 %.0f（%.0f%%）  最大逐帧跳变 %.1f%% @k=%.2f"
      % (m0, min(masses), min(masses) / m0 * 100,
         max(masses), max(masses) / m0 * 100, jr * 100, jk))
if jr > 0.28:
    fails.append("可见质量在 k=%.2f 处逐帧跳变 %.1f%%，超过 28%% —— 有陡跳" % (jk, jr * 100))
if min(masses) < 0.45 * m0:
    fails.append("可见质量最低掉到首帧的 %.0f%%，中间被'抽空'了"
                 % (min(masses) / m0 * 100))
if max(masses) > 2.2 * m0:
    fails.append("可见质量最高冲到首帧的 %.0f%%，中间有尖峰"
                 % (max(masses) / m0 * 100))

# 6) 交接那一帧几乎不可辨
last = seg[-1]
for j, kx in enumerate(last["kX"]):
    # 在过渡后的主列表里找 x 最接近的那朵云
    cand = sorted(after, key=lambda c: abs(c["x"] - kx))
    if not cand:
        fails.append("过渡后主列表里找不到子云")
        break
    c = cand[0]
    da, dw = abs(c["a"] - last["kA"][j]), abs(c["rwBody"] - last["kW"][j])
    print("交接检查 #%d: 过渡末帧 α=%.3f w=%d  →  过渡后 α=%.3f w=%d   (Δα=%.3f, Δw=%d)"
          % (j, last["kA"][j], last["kW"][j], c["a"], c["rwBody"], da, dw))
    if abs(c["x"] - kx) > 30:
        fails.append("交接检查 #%d：最近的子云离预期位置 %d px，匹配错了对象"
                     % (j, abs(c["x"] - kx)))
    if da > 0.08:
        fails.append("交接检查 #%d：透明度跳变 %.3f（>0.08），最后那一帧看得出替换" % (j, da))
    if dw > 5:
        fails.append("交接检查 #%d：宽度跳变 %d px（>5），最后那一帧看得出替换" % (j, dw))

print("\n" + "=" * 70)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 分裂是渐进连续的：母云逐步让位、两朵子云逐步长出并分开，交接无跳变")
