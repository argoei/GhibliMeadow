# -*- coding: utf-8 -*-
"""启动瞬间连拍，检查是否还会闪出深绿色（旧底色 #4E7534 / 旧页面底色 #6E9A4A）。"""
import subprocess, os, time, sys, ctypes
import numpy as np
from PIL import Image
import bettercam

EXE = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow\dist\GhibliMeadow.exe"
D = os.path.dirname(EXE)

# 先停掉已有实例
import psutil
for p in psutil.process_iter(['name']):
    if p.info['name'] == 'GhibliMeadow.exe':
        try: p.kill()
        except Exception: pass
time.sleep(3)

cam = bettercam.create(output_idx=0, output_color="RGB")
cam.start(target_fps=30, video_mode=True)
time.sleep(1.0)
subprocess.Popen([EXE], cwd=D)

# 立刻切到桌面，否则壁纸被前台的编辑器窗口挡着，什么都看不到
u = ctypes.windll.user32
u.keybd_event(0x5B, 0, 0, 0); u.keybd_event(0x44, 0, 0, 0)
u.keybd_event(0x44, 0, 2, 0); u.keybd_event(0x5B, 0, 2, 0)

# 抓 10 秒，每 200ms 取一帧
frames = []
t0 = time.time()
while time.time() - t0 < 10.0:
    f = cam.get_latest_frame()
    if f is not None:
        frames.append((time.time() - t0, np.asarray(f).copy()))
    time.sleep(0.20)
cam.stop()

OLD_BG = np.array([0x4E, 0x75, 0x34], dtype=np.int16)   # 旧 DefaultBackgroundColor
OLD_PAGE = np.array([0x6E, 0x9A, 0x4A], dtype=np.int16)  # 旧 body/#boot 底色

print("时刻(s)  平均色        深绿像素占比   旧草绿像素占比")
worst = 0.0
for ts, fr in frames:
    s = fr[::8, ::8].astype(np.int16)
    d1 = np.abs(s - OLD_BG).max(axis=2) < 10
    d2 = np.abs(s - OLD_PAGE).max(axis=2) < 10
    r1, r2 = 100.0 * d1.mean(), 100.0 * d2.mean()
    worst = max(worst, r1, r2)
    mean = s.reshape(-1, 3).mean(axis=0).astype(int)
    flag = "  <== 绿色帧" if max(r1, r2) > 5 else ""
    print("  %4.2f   %3d,%3d,%3d    %5.1f%%        %5.1f%%%s"
          % (ts, mean[0], mean[1], mean[2], r1, r2, flag))
print("\n过程内最大绿色占比 = %.1f%%  →  %s" % (worst, "仍然闪绿" if worst > 5 else "未出现闪绿"))
Image.fromarray(frames[-1][1]).save(
    r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\shots\final_desktop.png")
