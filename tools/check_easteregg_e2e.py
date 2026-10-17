# -*- coding: utf-8 -*-
"""实机端到端验证彩蛋：从日志读客机坐标 → 真实鼠标点击 → 确认命中。"""
import ctypes, re, time, os, subprocess
u = ctypes.windll.user32
LOG = r"C:/Users/byted/AppData/Local/GhibliMeadow/wallpaper.log"
EXE = r"C:/Users/byted/WorkBuddy/2026-09-23-21-59-33/GhibliMeadow/dist/GhibliMeadow.exe"

def log_text():
    try: return open(LOG, encoding='utf-8-sig', errors='replace').read()
    except Exception: return ""

for p in __import__('psutil').process_iter(['name']):
    if p.info['name'] == 'GhibliMeadow.exe':
        try: p.kill()
        except Exception: pass
time.sleep(3)
open(LOG, 'w').close()
subprocess.Popen([EXE], cwd=os.path.dirname(EXE))
u.keybd_event(0x5B,0,0,0); u.keybd_event(0x44,0,0,0)
u.keybd_event(0x44,0,2,0); u.keybd_event(0x5B,0,2,0)
print("启动中…")
time.sleep(18)

def plane():
    m = re.findall(r'客机@(-?\d+),(-?\d+)', log_text())
    if not m: return None
    x, y = m[-1]
    x, y = int(x), int(y)
    return (x, y) if x >= 0 else None

def click(x, y):
    u.SetCursorPos(int(x), int(y))
    time.sleep(0.025)
    u.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.085)
    u.mouse_event(0x0004, 0, 0, 0, 0)

hits = 0
t_end = time.time() + 75
while time.time() < t_end and hits == 0:
    p0 = plane()
    if not p0:
        time.sleep(1.0); continue
    px, py = p0
    # 客机每秒约移动 130px，日志最多滞后 5 秒 → 先按最坏情况横扫一整行
    for x in range(60, 1880, 55):
        click(x, py)
        if '彩蛋命中' in log_text():
            hits += 1
            print("命中：点击 (%d, %d)，日志客机位置 %s" % (x, py, p0))
            break
    if hits: break
    print("一轮未命中，日志客机位置", p0, " 继续…")
    time.sleep(1.5)

print("命中次数:", hits)
rec = re.findall(r'彩蛋命中[^\n]*', log_text())
print("命中日志:", rec[:3])
st = re.findall(r'状态 fps=[^\n]*', log_text())
print("末尾状态:", st[-1][24:120] if st else "(无)")
