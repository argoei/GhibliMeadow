# -*- coding: utf-8 -*-
"""
生成两处交互的逐帧对比图（侧躺→四脚朝天、白云分裂）。

难点：截图一次要 ~100ms，而这两段动画只有 0.70s / 0.58s，
直接抓根本抓不到确定的姿态。

做法是**把时间放慢**：用 add_init_script 在页面脚本之前包一层
requestAnimationFrame，把上报的时间戳按 __ts 倍缩放。
主循环的 dt 正是从这个时间戳算的，于是整段动画按比例变慢，
每一帧在真实时间里停留几百毫秒，截图就能稳稳抓住。

注意：主循环里 t = nowSec() 用的是 Date.now()（不受缩放影响），
它只驱动四蹄摆动/草摆这类"氛围"，身体翻转完全由 dt 驱动 —— 正是要拍的部分。
"""
import io
import os
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = "C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow"
URL = "file:///" + ROOT + "/src/GhibliMeadow/web/index.html?fps=30&t0=1&planeInterval=9999"
OUTDIR = ROOT + "/预览图"
SLOW = 0.08                      # 动画放慢到 8%

HOOK = """
(() => {
  window.__ts = %f;
  const raf = window.requestAnimationFrame.bind(window);
  let lt = null, vt = 0;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    if (lt === null) lt = ts;
    vt += (ts - lt) * window.__ts;
    lt = ts;
    cb(vt);
  });
})();
""" % SLOW


def font(sz):
    for n in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf"):
        try:
            return ImageFont.truetype(n, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def strip(frames, title, sub, out, label_fmt, cols=None):
    """frames: [(label, PIL.Image), ...] → 横排对比图"""
    cols = cols or len(frames)
    rows = (len(frames) + cols - 1) // cols
    cw = 260                                     # 每格宽
    ch = int(cw * frames[0][1].height / frames[0][1].width)
    gap, pad, head = 10, 26, 96
    W = pad * 2 + cols * cw + (cols - 1) * gap
    H = head + rows * (ch + 34) + (rows - 1) * 16 + pad
    im = Image.new("RGB", (W, H), (24, 28, 36))
    d = ImageDraw.Draw(im)
    d.text((pad, 24), title, font=font(30), fill=(255, 255, 255))
    d.text((pad, 62), sub, font=font(17), fill=(150, 168, 190))
    for i, (lab, fr) in enumerate(frames):
        r, c = divmod(i, cols)
        x = pad + c * (cw + gap)
        y = head + r * (ch + 34 + 16)
        im.paste(fr.resize((cw, ch), Image.LANCZOS), (x, y))
        d.rectangle([x, y, x + cw - 1, y + ch - 1], outline=(70, 82, 100))
        d.text((x + 2, y + ch + 7), lab, font=font(18), fill=(232, 238, 246))
    im.save(out)
    print("saved", out, im.size, flush=True)


def crop(png_bytes, cx, cy, half_w, half_h, vw, vh):
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    x0 = max(0, int(cx - half_w)); x1 = min(vw, int(cx + half_w))
    y0 = max(0, int(cy - half_h)); y1 = min(vh, int(cy + half_h))
    return im.crop((x0, y0, x1, y1))


VW, VH = 1920, 1080

with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="msedge",
                           args=["--force-device-scale-factor=1", "--hide-scrollbars"])
    ctx = br.new_context(viewport={"width": VW, "height": VH})
    ctx.add_init_script(HOOK)
    pg = ctx.new_page()
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(2500)
    pg.evaluate("window.meadow.seedBloom()")
    pg.wait_for_timeout(1200)

    # ---------------- 一、侧躺 → 四脚朝天 ----------------
    info = pg.evaluate("""() => {
      const L = window.meadow.__animals();
      // 挑一头画得最大的牛：体型大、翻面看得清
      let i = -1, best = -1;
      for (let k = 0; k < L.length; k++)
        if (L[k].kind === 'cow' && L[k].w > best) { best = L[k].w; i = k; }
      if (i < 0) { let b2 = -1; for (let k = 0; k < L.length; k++)
        if (L[k].w > b2) { b2 = L[k].w; i = k; } }
      const a = L[i];
      window.__i = i;
      const hit = window.meadow.click({ x: a.x, y: a.y - a.h * 0.45 });
      return { i: i, kind: a.kind, w: a.w, h: a.h, hit: hit };
    }""")
    print("target:", info, flush=True)

    import time
    # 裁切框固定：整段动画里动物尺寸不变，固定框才能逐帧公平对比
    HW, HH = info["w"] * 1.15, info["h"] * 1.15

    shots = []
    t_end = time.time() + 40
    while time.time() < t_end:
        a = pg.evaluate("() => window.meadow.__animals()[window.__i]")
        b = pg.screenshot(clip={"x": max(0, a["x"] - HW), "y": max(0, a["y"] - HH),
                                "width": min(VW, HW * 2), "height": min(VH, HH * 2)})
        shots.append((a["roll"], a["state"], b))
        if a["state"] in ("rise", "recover"):
            break
    print("拍到 %d 帧，roll 覆盖 %.2f ~ %.2f"
          % (len(shots), min(s[0] for s in shots), max(s[0] for s in shots)), flush=True)
    if not shots:
        raise SystemExit("没拍到帧")

    # 目标 roll（θ 从 90° 到 180°）：0.50 / 0.625 / 0.75 / 0.875 / 1.00
    targets = [0.50, 0.625, 0.75, 0.875, 1.00]
    picks = []
    for t in targets:
        best = min(shots, key=lambda s: abs(s[0] - t))
        picks.append(best)
    # 去重（避免慢速下同一帧被反复选中）
    uniq, seen = [], set()
    for s in picks:
        if s[0] not in seen:
            seen.add(s[0]); uniq.append(s)
    frames = []
    for roll, st, b in uniq:
        frames.append(("roll=%.2f  (θ=%d°)" % (roll, round(180 * roll)),
                       Image.open(io.BytesIO(b)).convert("RGB")))
    strip(frames,
          "侧躺 %d° → 四脚朝天 180°：连续翻转（总时长 0.70s，原 1.40s）" % 90,
          "easeOutCubic：起手不为零（立即起动）、末速为零（落定不弹跳）、全程严格单调无顿挫"
          "   ·   由 tools/strip_interactions.py 以 8% 速度逐帧抓取",
          os.path.join(OUTDIR, "侧躺到四脚朝天-逐帧.png"), "%s")

    # ---------------- 二、白云分裂 ----------------
    pg.evaluate("window.meadow.rebuild()")
    pg.wait_for_timeout(2500)
    c0 = pg.evaluate("""() => {
      const M = window.meadow, cs = M.__clouds(), minW = M.__cloudSplitMin;
      let idx = -1;
      for (let i = 0; i < cs.length; i++)
        if (cs[i].rwBody >= minW + 60 && cs[i].a >= 0.5) { idx = i; break; }
      if (idx < 0) return null;
      const c = cs[idx];
      window.__cx = c.x; window.__cy = c.py;
      const hit = M.click({ x: c.x, y: c.py });
      return { x: c.x, y: c.py, rwBody: c.rwBody, hit: hit };
    }""")
    print("cloud:", c0, flush=True)
    if c0 and c0["hit"] == "cloud":
        cshots = []
        seen_any = False
        t_end = time.time() + 40
        # 注意：时间被放慢后，点击那一帧之后要等好几百毫秒才渲染出下一帧。
        # **不能在第一次读到空 splitDiag 时就退出**（我第一版就是这么错的，
        # 结果 cshots 为空），要等到"见到过帧之后"再遇到空才收工。
        while time.time() < t_end:
            sp = pg.evaluate("() => { const s = window.meadow.__splits();"
                             " return { n: s.inFlight, f: s.lastFrame[0] || null }; }")
            f = sp["f"]
            if not f:
                if seen_any:
                    break
                time.sleep(0.25)
                continue
            seen_any = True
            # 收紧裁切：两朵子云最终各偏 0.42M，加半朵宽 0.31M → 需要 ±0.95M
            hw = c0["rwBody"] * 0.95
            hh = c0["rwBody"] * 0.62
            x0 = max(0, c0["x"] - hw); y0 = max(0, c0["y"] - hh)
            b = pg.screenshot(clip={"x": x0, "y": y0,
                                    "width": min(VW - x0, hw * 2),
                                    "height": min(VH - y0, hh * 2)})
            cshots.append((f["k"], b))
        print("分裂拍到 %d 帧，k 覆盖 %s"
              % (len(cshots),
                 "%.2f ~ %.2f" % (min(s[0] for s in cshots), max(s[0] for s in cshots))
                 if cshots else "无"), flush=True)
        if not cshots:
            raise SystemExit("没拍到分裂帧")
        ctargets = [0.05, 0.25, 0.45, 0.65, 0.85, 0.99]
        cframes, seen = [], set()
        for t in ctargets:
            best = min(cshots, key=lambda s: abs(s[0] - t))
            if best[0] in seen:
                continue
            seen.add(best[0])
            cframes.append(("k=%.2f" % best[0],
                            Image.open(io.BytesIO(best[1])).convert("RGB")))
        strip(cframes, "白云分裂：0.58s 的渐进分离（原为瞬间换成两块）",
              "母云被拉扯收窄并淡出；两朵子云自母云中心同时长出、左右分开 —— "
              "首末两帧都与相邻状态逐像素连续",
              os.path.join(OUTDIR, "白云分裂-逐帧.png"), "%s", cols=6)
    br.close()
print("done", flush=True)
