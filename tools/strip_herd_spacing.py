"""生成"牛羊个体间距拉开"的对比图：同一个群，起步时 vs 走过一段之后。

做法：用包一层 requestAnimationFrame 把时间放大 N 倍，让"要几分钟才看得出"的演化
在几秒内跑完；取成员最多的那个群，裁同一块取景框、放大 3 倍，上下并排。
"""
import io
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

# PIL 自带位图字体不含中文字形，直接用会把标签画成方块 —— 必须指定系统 CJK 字体
FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
FONT = ImageFont.truetype(FONT_PATH, 17)

URL = ("file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/src/GhibliMeadow/web/index.html")
OUT = ("C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/预览图/牛羊间距-拉开对比.png")
ACC = 8
VW, VH = 1920, 1080
ZOOM = 3


def screen_of(h, dx):
    """把一群里某个个体的世界位置换成屏幕坐标（与页面同一套公式）。"""
    return (h["cx"] + dx * h["dir"] - h["ox"], h["hy"] + h["gh"] * h["gy"])


def pick_and_clip(pg):
    """挑成员最多的群，返回 (群信息, 裁剪框)。"""
    herds = pg.evaluate("() => window.meadow.__herds()")
    h = max(herds, key=lambda x: x["n"])
    xs = [screen_of(h, m["dx"])[0] for m in h["members"]]
    ys = [screen_of(h, m["dx"])[1] for m in h["members"]]
    cx = sum(xs) / len(xs)
    cy = ys[0]
    half = 120                     # 取景半宽（世界单位）
    box = (int(max(0, cx - half)), int(max(0, cy - 34)),
           int(min(VW, cx + half)), int(min(VH, cy + 20)))
    return h, box


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge",
                          args=["--disable-features=CalculateNativeWinOcclusion"])
    pg = b.new_page(viewport={"width": VW, "height": VH})
    pg.add_init_script("""(() => {
      window.__ts = %d;
      const raf = window.requestAnimationFrame.bind(window);
      let lt = null, vt = 0;
      window.requestAnimationFrame = (cb) => raf((ts) => {
        if (lt === null) lt = ts;
        vt += (ts - lt) * window.__ts;
        lt = ts;
        cb(vt);
      });
    })();""" % ACC)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("() => window.meadow && window.meadow.__herds", timeout=30000)
    pg.wait_for_timeout(700)

    h0, box = pick_and_clip(pg)
    kind = h0["kind"]
    span0 = max(m["dx"] for m in h0["members"]) - min(m["dx"] for m in h0["members"])
    shot0 = pg.screenshot(clip={"x": box[0], "y": box[1],
                                "width": max(8, box[2] - box[0]),
                                "height": max(8, box[3] - box[1])})

    # 加速跑一段（真实 ~22s × 8 ≈ 176 模拟秒）
    for _ in range(22):
        pg.wait_for_timeout(1000)

    # 重新挑同一类群（成员数相同则以跨度最大者定位，保证取到变化最明显的那个）
    herds = pg.evaluate("() => window.meadow.__herds()")
    same = [x for x in herds if x["kind"] == kind and x["n"] == h0["n"]] or herds
    h1 = max(same, key=lambda x: max(m["dx"] for m in x["members"]) - min(m["dx"] for m in x["members"]))
    xs = [screen_of(h1, m["dx"])[0] for m in h1["members"]]
    cx = sum(xs) / len(xs)
    cy = screen_of(h1, 0)[1]
    half = 190
    box1 = (int(max(0, cx - half)), int(max(0, cy - 34)),
            int(min(VW, cx + half)), int(min(VH, cy + 20)))
    span1 = max(m["dx"] for m in h1["members"]) - min(m["dx"] for m in h1["members"])
    shot1 = pg.screenshot(clip={"x": box1[0], "y": box1[1],
                                "width": max(8, box1[2] - box1[0]),
                                "height": max(8, box1[3] - box1[1])})
    b.close()

if errs:
    print("JS 报错:", errs[:1])
    sys.exit(1)

panels = []
for shot, label, span in ((shot0, "起步：按名次等距分层（间距 %d）" % span0, span0),
                          (shot1, "走过一段后：间距拉开到 %d（%.2f 倍）" % (span1, span1 / max(1, span0)), span1)):
    im = Image.open(io.BytesIO(shot)).convert("RGB")
    im = im.resize((im.width * ZOOM, im.height * ZOOM), Image.LANCZOS)
    panels.append((im, label))

W = max(im.width for im, _ in panels) + 24
H = sum(im.height + 40 for im, _ in panels) + 12
canvas = Image.new("RGB", (W, H), (18, 26, 34))
d = ImageDraw.Draw(canvas)
y = 8
for im, label in panels:
    d.text((12, y + 6), label, fill=(235, 242, 248), font=FONT)
    canvas.paste(im, (12, y + 26))
    y += im.height + 40

os.makedirs(os.path.dirname(OUT), exist_ok=True)
canvas.save(OUT, optimize=True)
print("已生成 %s" % OUT)
print("  %s：跨度 %d → %d（%.2f 倍）" % (kind, span0, span1, span1 / max(1, span0)))
print("  尺寸 %dx%d" % canvas.size)
