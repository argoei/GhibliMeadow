# -*- coding: utf-8 -*-
"""
掀翻动画的"侧躺 → 四脚朝天"过渡回归：连贯性 + 时长。

判据全在**逐帧真值**上算（在页面里用 rAF 采样，不在 Python 里轮询，
避免往返延迟把时序量歪）：
  1) roll 单调不减            —— 有顿挫（sin 摆动）会立刻红
  2) 侧躺处的"停顿" ≤ 60ms    —— 这是本轮的病根：easeInOutCubic 在 p=0 速度为 0
  3) 翻转段时长 ≈ 0.70s±15%   —— 即"在现有 1.40s 基础上缩短 50%"
  4) 衔接速度比 ≥ 0.55        —— 量化"立即起动"：翻转段起始速度 与 倒下段结束速度 之比
  5) 落到四脚朝天不回头      —— 末段速度趋于 0（easeOutCubic 的性质）
用法：
  python tools/check_knock_timing.py           验源码
  python tools/check_knock_timing.py --dist    验已发布产物
"""
import sys
from playwright.sync_api import sync_playwright

ROOT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow"
SUB = "dist/web" if "--dist" in sys.argv else "src/GhibliMeadow/web"
URL = "file:///" + ROOT + "/" + SUB + "/index.html?fps=30&t0=1"

OLD_FLIP = 1.40          # 改动前的时长，用来核对"缩短 50%"
fails = []

# 在页面里开一个 rAF 采样器，并立刻点倒一头牲口
ARM = """
() => {
  const list = window.meadow.__animals();
  if (!list.length) return { err: '没有牲口' };
  // 挑一头命中的：点它的躯干中部（判定框是 x±w/2、y-h .. y+5）
  const i = Math.floor(list.length / 2);
  const a = list[i];
  const t0 = performance.now();
  window.__trace = [];
  window.__idx = i;
  window.__target = a;
  const step = () => {
    const T = window.meadow.__animals();
    const cur = T[window.__idx];
    if (cur) window.__trace.push({
      t: performance.now() - t0, roll: cur.roll, st: cur.state, lock: cur.lockT });
    if (performance.now() - t0 < 12000 && window.__traceOn) requestAnimationFrame(step);
  };
  window.__traceOn = true;
  requestAnimationFrame(step);
  const hit = window.meadow.click({ x: a.x, y: a.y - a.h * 0.45 });
  window.__hit = hit;
  return { idx: i, kind: a.kind, at: [a.x, a.y], hit: hit };
}
"""


def find(trace, pred):
    for s in trace:
        if pred(s):
            return s
    return None


def boundary(trace, state):
    """状态切到 `state` 的时刻，取"前一帧与这一帧"的中点 —— 半帧内的偏差。"""
    for i, s in enumerate(trace):
        if s["st"] == state:
            if i == 0:
                return s["t"]
            return (trace[i - 1]["t"] + s["t"]) / 2.0
    return None


def roll_at(trace, t):
    """roll 在时刻 t 的线性插值。用插值而不是"最近样本"，
    否则算速度时会被帧量化系统性地压低（±1 帧的偏差在 90ms 窗口里就是 30%）。"""
    if t <= trace[0]["t"]:
        return trace[0]["roll"]
    if t >= trace[-1]["t"]:
        return trace[-1]["roll"]
    for i in range(1, len(trace)):
        if trace[i]["t"] >= t:
            t0, t1 = trace[i - 1]["t"], trace[i]["t"]
            r0, r1 = trace[i - 1]["roll"], trace[i]["roll"]
            return r0 if t1 <= t0 else r0 + (r1 - r0) * (t - t0) / (t1 - t0)
    return trace[-1]["roll"]


def vel_at(trace, t, win=100.0):
    """以 t 为中心的 [t-win, t] / [t, t+win] 平均 roll 速度（/s）；返回 (前, 后)。"""
    return ((roll_at(trace, t) - roll_at(trace, t - win)) / (win / 1000.0),
            (roll_at(trace, t + win) - roll_at(trace, t)) / (win / 1000.0))


with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="msedge",
                           args=["--force-device-scale-factor=1"])
    pg = br.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
          if m.type == "error" else None)
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(2000)
    pg.evaluate("window.meadow.seedBloom()")
    pg.wait_for_timeout(600)

    arm = pg.evaluate(ARM)
    print("起手:", arm)
    if arm.get("err"):
        print("✗", arm["err"])
        sys.exit(1)
    if arm.get("hit") not in ("cow", "sheep"):
        fails.append("点击没命中牲口（返回 %r）" % arm.get("hit"))

    pg.wait_for_timeout(6500)
    pg.evaluate("window.__traceOn = false")
    trace = pg.evaluate("window.__trace")
    br.close()

if errs:
    print("JS 错误:", errs[:5])
    fails.append("页面有 JS 错误")

print("采样 %d 帧，跨度 %.2fs" % (len(trace), (trace[-1]["t"] - trace[0]["t"]) / 1000))
if not trace:
    print("✗ 没有采样到数据")
    sys.exit(1)

states = []
for s in trace:
    if not states or states[-1] != s["st"]:
        states.append(s["st"])
print("状态序列:", " → ".join(states))

if "flip" not in states:
    fails.append("状态序列里没有 flip 段（%s）—— 翻转段没跑到" % states)

t_half = boundary(trace, "flip")
t_down = boundary(trace, "down")
t_full = find(trace, lambda s: s["roll"] >= 0.999)
if t_half is None:
    fails.append("状态序列里没有 flip 段 —— 翻转段没跑到")
if t_down is None:
    fails.append("状态序列里没有 down 段")
if not t_full:
    fails.append("roll 从未到 1.0（四脚朝天）")

if t_half is not None and t_down is not None:
    # 时长用**状态切换的边界时刻**算：roll 阈值会被帧量化带偏
    # （easeOutCubic 起手极快，第一个 roll≥0.5 的采样点已经跑过头了）
    dur = (t_down - t_half) / 1000.0
    print("\n侧躺→四脚朝天: %.3fs（原 %.2fs，缩短 %.1f%%）"
          % (dur, OLD_FLIP, (1 - dur / OLD_FLIP) * 100))
    if not (0.70 * 0.90 <= dur <= 0.70 * 1.10):
        fails.append("翻转段时长 %.3fs 不在 0.70s±10%% 内（要求缩短 50%%）" % dur)
    if dur > OLD_FLIP * 0.60:
        fails.append("翻转段 %.3fs 相对原来的 %.2fs 缩短不足 40%%" % (dur, OLD_FLIP))

    # 1) 单调性：只约束「倒下 + 翻转」这一段（roll 0 → 1）。
    #    rise 段 roll 是从 1 回到 0 的，那里递减是**正确的**，
    #    把整条轨迹一起判单调会误报（第一版就犯了这个错，49 处"回退"全在 rise 段）。
    seg = [s for s in trace if s["t"] <= t_down]
    bad = [(round(seg[i - 1]["t"]), seg[i - 1]["roll"], seg[i]["roll"])
           for i in range(1, len(seg))
           if seg[i]["roll"] < seg[i - 1]["roll"] - 0.002]
    print("倒下+翻转段的回退帧数: %d（共 %d 帧）" % (len(bad), len(seg)))
    if bad:
        fails.append("倒下+翻转段 roll 出现 %d 处回退（顿挫），例：%s" % (len(bad), bad[:3]))

    # 2) 起手不能"卡住"：量**翻转段前 15% 时长内的平均角速度**。
    #    这是一个 105ms 的积分窗口（30fps 下约 3 帧），端点用插值取，
    #    所以不像"首个采样帧落点"那样被帧量化摆布。
    #    实测分离度：easeOutCubic 1.84 /s（本实现）；旧曲线 0.57 /s —— 3.2 倍。
    #
    #    【写这条判据时踩的两个坑，记下来免得再犯】
    #    · 第一版写的是"统计 roll 落在 0.498~0.505 窄带里的时长"：
    #      30fps 下第一帧 roll 就跳到 0.567，永远落不进那个带 —— 新旧两版都量到 0ms，
    #      **是个空跑的判据**，靠反向验证才戳穿。
    #    · 第二版写的是"roll 从 0.50 转到 0.55 的耗时"：它在注入态确实报警（67ms），
    #      但那个 67ms 是**顿挫项把 roll 顶上去**造成的，并非缓动曲线本身的起手迟滞 ——
    #      量到的不是想量的东西；而且 24ms 的理论值叠上 ±33ms 帧量化会贴近阈值，容易假红。
    win = 0.15 * (t_down - t_half)
    v_early = (roll_at(trace, t_half + win) - roll_at(trace, t_half)) / (win / 1000.0)
    print("翻转段前 15%%（%.0fms）平均角速度: %.2f /s（旧曲线实测 0.57）" % (win, v_early))
    if v_early < 1.10:
        fails.append("翻转段起手平均角速度只有 %.2f /s（<1.10）—— 侧躺后先停住再翻"
                     % v_early)

    # 3) 衔接速度：量化"立即起动"
    v_end, v_str = vel_at(trace, t_half)
    print("倒下段结束速度 %.2f /s ；翻转段起始速度 %.2f /s" % (v_end, v_str))
    ratio = v_str / v_end if v_end > 1e-6 else 0.0
    print("衔接速度比 %.2f（解析理想值 0.94）" % ratio)
    if ratio < 0.55:
        fails.append("翻转段起始速度只有倒下段的 %.2f 倍 —— 起手明显减速/停顿" % ratio)

    # 4) 末段收敛：落定不弹跳
    if t_full:
        _, v_tail = vel_at(trace, t_full["t"] - 120)
        print("末段速度 %.2f /s（应趋近 0）" % v_tail)
        if v_tail > 0.45:
            fails.append("末段速度 %.2f /s 过大，落定不稳（会显得'砸'下去）" % v_tail)

print("\n" + "=" * 70)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 侧躺→四脚朝天 连续、单调、立即起动，时长已缩短约 50%")
