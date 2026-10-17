"""看门狗专项回归：确认 IsStillAttached 接入后不会**误判**成"已脱离桌面层"而反复重建。

背景：看门狗原本只查"壁纸窗口是否存活"（`IsWindow(s.Handle)`），文档却写着它还查
`GetParent(hwnd)==host` —— 那个函数（DesktopHost.IsStillAttached）其实是死代码。
把它接进去之后，必须验证它**不会误报**：误报的表现是每 3 秒重建一次，
画面反复重排、日志里刷满"重建"。

判据：
  1. 观察窗口内挂载成功（日志出现「已挂到桌面层 … 可见=True」）；
  2. 观察窗口内**不出现**「壁纸窗口丢失或已脱离桌面层」；
  3. 进程仍存活，且日志里能看到持续的探针/统计上报（说明没卡在重建循环里）。
"""
import io
import os
import subprocess
import sys
import time

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
DIST = os.path.join(ROOT, "dist")
LOG = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow", "wallpaper.log")
WATCH = 40          # 秒；看门狗 3 秒一跳，40 秒足够暴露误报

fails = []


def kill():
    import psutil
    for p in psutil.process_iter(["name"]):
        try:
            if p.info["name"] and "GhibliMeadow" in p.info["name"]:
                p.kill()
        except Exception:
            pass
    time.sleep(1.2)


def alive():
    import psutil
    return [p.info["pid"] for p in psutil.process_iter(["name", "pid"])
            if p.info.get("name") and "GhibliMeadow" in p.info["name"]]


kill()
before = os.path.getsize(LOG) if os.path.exists(LOG) else 0

print("启动 %s" % os.path.join(DIST, "GhibliMeadow.exe"))
subprocess.Popen([os.path.join(DIST, "GhibliMeadow.exe")], cwd=DIST, close_fds=True)

print("观察 %d 秒（看门狗 3 秒一跳，会跳约 %d 次）…" % (WATCH, WATCH // 3))
time.sleep(WATCH)


def new_log():
    if not os.path.exists(LOG):
        return ""
    with io.open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(before)
        return f.read()


txt = new_log()
lines = txt.splitlines()

mounted = [l for l in lines if "已挂到桌面层" in l]
spurious = [l for l in lines if "壁纸窗口丢失或已脱离桌面层" in l or "桌面层已失效" in l]
layout = [l for l in lines if "显示器布局发生变化" in l]
probes = [l for l in lines if "探针" in l]

print()
print("  日志新增 %d 行" % len(lines))
print("  挂载成功      : %d 条" % len(mounted))
print("  脱离/失效告警  : %d 条  ← 应为 0（非 0 就是误报）" % len(spurious))
print("  布局变化重建   : %d 条  ← 应为 0" % len(layout))
print("  探针/统计上报  : %d 条" % len(probes))
if mounted:
    print("  · %s" % mounted[0].strip()[:150])

if not mounted:
    fails.append("观察窗口内没有出现「已挂到桌面层」")
if spurious:
    fails.append("出现 %d 次脱离/失效告警（看门狗误报）：%s"
                 % (len(spurious), spurious[0].strip()[:120]))
if layout:
    fails.append("出现 %d 次布局变化重建（观察期间不该动显示器）" % len(layout))
if not alive():
    fails.append("进程已退出")
if not probes:
    fails.append("没有探针上报，可能卡在重建循环里")

kill()

print()
print("=" * 70)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 看门狗在 %d 秒内 0 次误报，挂载稳定、持续上报" % WATCH)
