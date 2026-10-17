"""生成「牛脖子修复前后」对比图：同姿态、同配色，上排修复后 / 下排修复前。

做法：用页面导出的 `__cowPng(head, ct, z, real)` 单独把一头牛画出来
（场景里的牛只有十几像素高，直接截场景看不清脖子细节），
把修复前的实现临时注入进来再画一遍。

两个必须注意的点：
  ① **Playwright 只启动一次。** 在同一进程里反复 `sync_playwright()` 启动/关闭
     会让这个脚本被莫名终止（实测两次都在无输出状态下被 SIGTERM）。
     改成一次启动、每轮新建 context。
  ② **注入/还原必须双向校验。** 脚本靠"备份→改→还原"工作，一旦某次运行被中途打断，
     下一次会把**已经脏了的文件**当成好版本备份，还原时把脏状态又写回去 ——
     结果是"看起来还原成功、其实源码留着缺陷"。所以注入前断言源码干净，
     还原后断言既无 TEMP-BREAK、新实现又回来了。
"""
import base64
import io
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
JS = os.path.join(ROOT, "src", "GhibliMeadow", "web", "meadow.js")
BACK = JS + ".bak"
URL = ("file:///C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/"
       "GhibliMeadow/src/GhibliMeadow/web/index.html")
OUT = os.path.join(ROOT, "预览图", "牛脖子-修复前后.png")
NODE = r"C:\Users\byted\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
POSES = [(0.94, "走路（抬头）"), (0.05, "吃草（低头）")]

NEW = """  const ax = Math.cos(ang), ay = Math.sin(ang) * ct;
  const alen = Math.hypot(ax, ay) || 1e-6;
  const px = -ay / alen, py = ax / alen;
  const rBase = hs * 0.48, rTip = hs * 0.28;      // 颈根 / 靠头处的半厚
  g.fillStyle = col.head;
  g.beginPath();
  g.moveTo(shx - px * rBase, shy - py * rBase);
  g.lineTo(hx - px * rTip, hy - py * rTip);
  g.lineTo(hx + px * rTip, hy + py * rTip);
  g.lineTo(shx + px * rBase, shy + py * rBase);
  g.closePath();
  g.fill();"""

OLD = """  g.fillStyle = col.head;   /*TEMP-BREAK 旧实现：固定横/竖偏移*/
  g.beginPath();
  g.moveTo(shx - 0.05 * L, shy - hs * 0.28);
  g.lineTo(hx - 0.01 * L, hy - hs * 0.24);
  g.lineTo(hx + 0.02 * L, hy + hs * 0.24);
  g.lineTo(shx + 0.05 * L, shy + hs * 0.32);
  g.closePath();
  g.fill();"""


def check_syntax():
    r = subprocess.run([NODE, "--check", JS], capture_output=True, text=True)
    assert r.returncode == 0, "语法错误：" + r.stderr[:300]


def inject_old():
    s = io.open(JS, encoding="utf-8").read()
    assert "TEMP-BREAK" not in s, "源码里已有 TEMP-BREAK —— 上次注入没还原，先修源码再跑"
    assert s.count(NEW) == 1, "源码不是预期的（新实现）版本，拒绝注入：命中 %d 次" % s.count(NEW)
    io.open(JS, "w", encoding="utf-8").write(s.replace(NEW, OLD))
    check_syntax()


def restore():
    shutil.copy(BACK, JS)
    os.remove(BACK)
    s = io.open(JS, encoding="utf-8").read()
    assert "TEMP-BREAK" not in s, "还原后仍有 TEMP-BREAK，源码是脏的！"
    assert s.count(NEW) == 1, "还原后新实现不见了，源码是脏的！"
    check_syntax()
    print("  还原并通过双向校验", flush=True)


print("启动浏览器（只启动一次）…", flush=True)
shutil.copy(JS, BACK)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge",
                              args=["--disable-features=CalculateNativeWinOcclusion"])

        def shoot(tag):
            # 每轮新建 context：注入后必须让浏览器重新取 meadow.js，否则会命中缓存
            ctx = b.new_context(viewport={"width": 1280, "height": 720})
            pg = ctx.new_page()
            pg.goto(URL)
            pg.wait_for_function("() => window.meadow && window.meadow.__cowPng", timeout=30000)
            pg.wait_for_timeout(600)
            row = []
            for hd, _ in POSES:
                d = pg.evaluate("(h) => window.meadow.__cowPng(h, 1, 5, true)", hd)
                assert d.startswith("data:image/png;base64,"), "探针没返回 PNG：" + d[:60]
                row.append(Image.open(io.BytesIO(base64.b64decode(d.split(",")[1]))).convert("RGB"))
            ctx.close()
            print("  取到 %d 张（%s）" % (len(row), tag), flush=True)
            return row

        print("取「修复后」…", flush=True)
        after = shoot("after")
        print("注入旧实现…", flush=True)
        inject_old()
        print("取「修复前」…", flush=True)
        before = shoot("before")
        b.close()
finally:
    restore()

imgs = after + before
cols, rows = len(POSES), 2
w, h = imgs[0].width, imgs[0].height
pad, lab = 16, 32
W = cols * w + (cols + 1) * pad
H = rows * (h + lab) + (rows + 1) * pad
canvas = Image.new("RGB", (W, H), (18, 26, 34))
d = ImageDraw.Draw(canvas)
titles = ["修复后：沿颈轴给垂直厚度（颈厚/体高 = 0.370，且与俯仰角无关）",
          "修复前：固定横/竖偏移（颈厚/体高 = 0.239 / 0.217，且随俯仰角变化）"]
for ri in range(rows):
    y = pad + ri * (h + lab + pad)
    d.text((pad, y + 4), titles[ri],
           fill=(120, 230, 170) if ri == 0 else (255, 150, 150), font=FONT)
    for ci in range(cols):
        x = pad + ci * (w + pad)
        canvas.paste(imgs[ri * cols + ci], (x, y + lab))
        d.text((x + 8, y + lab + 8), POSES[ci][1], fill=(210, 224, 236), font=FONT)
canvas.save(OUT, optimize=True)
print("已生成 %s（%dx%d）" % (OUT, canvas.size[0], canvas.size[1]))
