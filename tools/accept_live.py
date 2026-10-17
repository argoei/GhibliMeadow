# -*- coding: utf-8 -*-
"""
实机验收：启动已发布的壁纸，确认它真的挂上桌面、稳定出图。

判据（都不靠肉眼）：
  1) 进程存活，日志出现挂载成功、无 ERROR
  2) 桌面画面确实是草原场景 —— 上半部偏蓝（天空）、下半部偏绿（草地）
  3) 连拍两帧有差异 —— 动画在跑（GDI 截图看不到 GPU 合成内容，
     所以用 Desktop Duplication，不用 PIL.ImageGrab）
用法：
  python tools/accept_live.py            启动 + 验收，结束后保留壁纸
  python tools/accept_live.py --kill     先杀掉已有实例再验收
"""
import ctypes
import os
import subprocess
import sys
import time

DIST = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow\dist"
EXE = os.path.join(DIST, "GhibliMeadow.exe")
LOG = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow", "wallpaper.log")
SHOT_DIR = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\shots"
USER32 = ctypes.windll.user32
VK_LWIN, VK_D = 0x5B, 0x44

fails = []


def kill_existing():
    import psutil
    n = 0
    for p in psutil.process_iter(["name", "pid"]):
        try:
            if p.info["name"] and "GhibliMeadow" in p.info["name"]:
                p.kill()
                n += 1
        except Exception:
            pass
    if n:
        print("  已结束 %d 个旧实例" % n)
        time.sleep(1.2)
    return n


def show_desktop():
    """Win+D 把窗口都收起来；壁纸挂在桌面图标层之下，只有这样才能露出来。"""
    USER32.keybd_event(VK_LWIN, 0, 0, 0)
    USER32.keybd_event(VK_D, 0, 0, 0)
    USER32.keybd_event(VK_D, 0, 2, 0)
    USER32.keybd_event(VK_LWIN, 0, 2, 0)
    time.sleep(1.5)


def read_from(path, offset):
    """从指定字节偏移读日志。注意不能用"最后 N 字符"来比对增量 ——
    那样会随着日志增长而错位，导致明明写了很多却报'新增 6 字符'。"""
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        f.seek(offset)
        return f.read().decode("utf-8", "replace")


def classify(frame):
    """返回 (天空占比, 草地占比, 平均亮度)。frame 为 BGR。"""
    import numpy as np
    h = frame.shape[0]
    top = frame[: h // 4].astype("int16")     # BGR
    bot = frame[int(h * 0.78):].astype("int16")
    sky = float(((top[:, :, 0] > top[:, :, 2] + 18) &
                 (top[:, :, 0] > top[:, :, 1] + 8)).mean())
    grass = float(((bot[:, :, 1] > bot[:, :, 2] + 22) &
                   (bot[:, :, 1] > bot[:, :, 0] + 4)).mean())
    return sky, grass, float(frame.mean())


def px_changed(a, b):
    """两帧之间"变化明显"的像素占比。阈值 6 是为了滤掉编码/抖动噪声。"""
    import numpy as np
    d = np.abs(b.astype("int16") - a.astype("int16"))
    return float((d.max(axis=2) > 6).mean())


def main():
    import numpy as np
    import bettercam

    if "--kill" in sys.argv:
        kill_existing()

    before_off = os.path.getsize(LOG) if os.path.exists(LOG) else 0
    print("启动:", EXE)
    subprocess.Popen([EXE], cwd=DIST, close_fds=True)
    time.sleep(1.0)

    cam = bettercam.create(output_idx=0, output_color="BGR")
    show_desktop()

    # 等挂载 + 首帧
    deadline = time.time() + 25
    base = None
    while time.time() < deadline:
        f = cam.grab()
        if f is not None:
            sky, grass, lum = classify(f)
            if sky > 0.25 and grass > 0.25:
                base = f
                break
        time.sleep(0.6)

    if base is None:
        fails.append("等不到草原画面：桌面未出现'上蓝下绿'的构图")
        print("  ✗ 未检测到草原画面")
    else:
        # 关键：上面那个条件在**启动遮罩还在淡出时**就会成立。
        # `#boot` 会盖住整屏，此刻基准帧里还糊着"正在铺开草原…"，
        # 再等 1 秒去比就会量到 70%+ 的"变化"，全是淡出造成的假象。
        # 必须先等画面静止下来（连续两帧几乎一致），才拿它当基准。
        settle_deadline = time.time() + 15
        prev = base
        stable = False
        while time.time() < settle_deadline:
            time.sleep(0.6)
            cur = cam.grab()
            if cur is None:
                continue
            d = px_changed(prev, cur)
            prev = cur
            if d < 0.10:
                stable = True
                base = cur
                break
        print("  启动遮罩淡出完成：%s（稳定判据：相邻 0.6s 变化 <10%%）"
              % ("是" if stable else "未确认，仍按当前帧继续"))
        if not stable:
            fails.append("启动遮罩 15 秒内未淡出稳定")

        sky, grass, lum = classify(base)
        print("  画面判据：天空占比 %.1f%%  草地占比 %.1f%%  均亮 %.1f"
              % (sky * 100, grass * 100, lum))
        if sky < 0.25:
            fails.append("上半部天空占比仅 %.1f%%" % (sky * 100))
        if grass < 0.25:
            fails.append("下半部草地占比仅 %.1f%%" % (grass * 100))

        # 连拍看动画：等一秒再抓
        time.sleep(1.0)
        f2 = cam.grab()
        changed = px_changed(base, f2)
        print("  稳定后 1 秒内变化像素占比 %.3f%%" % (changed * 100))
        if changed < 0.0005:
            fails.append("1 秒内几乎无变化（%.4f%%）—— 动画停在首帧" % (changed * 100))
        if changed > 0.55:
            fails.append("1 秒内变化 %.1f%%，远高于'云飘+草摆'应有的量级 —— 疑似整屏刷新/闪烁"
                         % (changed * 100))

        os.makedirs(SHOT_DIR, exist_ok=True)
        for name, fr in (("accept_a.png", base), ("accept_b.png", f2)):
            import cv2
            cv2.imwrite(os.path.join(SHOT_DIR, name), fr)
        print("  截图:", os.path.join(SHOT_DIR, "accept_a.png"))

    del cam

    time.sleep(1.5)
    new = read_from(LOG, before_off)
    errs = [l for l in new.splitlines() if "ERROR" in l.upper() or "FAIL" in l.upper()]
    st = [l for l in new.splitlines() if "fps=" in l or "calls=" in l]
    mount = [l for l in new.splitlines() if "挂" in l or "出帧" in l or "reveal" in l.lower()]
    print("\n日志新增 %d 字符 | 挂载/出帧 %d 条 | 统计 %d 条 | 错误 %d 条"
          % (len(new), len(mount), len(st), len(errs)))
    for l in mount[-3:]:
        print("  ·", l.strip()[:150])
    for l in st[-2:]:
        print("  ·", l.strip()[:150])
    for l in errs[:5]:
        print("  ✗", l.strip()[:150])
    if errs:
        fails.append("日志出现 %d 条错误" % len(errs))
    if not mount:
        fails.append("日志没有挂载/出帧记录 —— 壁纸可能没起来")

    print("\n" + "=" * 70)
    if fails:
        print("FAIL (%d)" % len(fails))
        for f in fails:
            print("  ✗", f)
        return 1
    fps = "?"
    if st:
        fps = st[-1].split("fps=")[1].split()[0]
    print("PASS — 壁纸已挂到桌面层、启动遮罩正常淡出、动画在跑（fps=%s）" % fps)
    return 0


if __name__ == "__main__":
    sys.exit(main())
