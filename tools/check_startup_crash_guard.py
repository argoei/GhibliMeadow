"""验证「启动阶段异常 → 进程退干净」这条守卫真的生效。

做法：在 StartCore() 里、BuildTray() 之前注入一个必然异常，构建、启动，断言：
  · 日志出现 FATAL 与「启动阶段异常，进程将退出」
  · **进程从任务管理器消失**（不是留下"无托盘、无定时器、却占着单实例互斥量"的僵尸）
  · 退出码为 0（避免被计划任务反复拉起）
然后还原并重新构建，双向断言源码干净。

注入/还原的守卫（本项目踩过"备份本身是脏的"）：注入前断言源码干净，
还原后断言既无 TEMP-BREAK、StartCore 结构又回来了。
"""
import io
import os
import shutil
import subprocess
import sys
import time

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
SRC = os.path.join(ROOT, "src", "GhibliMeadow", "WallpaperApp.cs")
BAK = SRC + ".bak"
DIST = os.path.join(ROOT, "dist")
LOG = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow", "wallpaper.log")
PY = r"C:\Users\byted\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

ANCHOR = "        AssertDensityPresets();\n        BuildTray();"
INJECT = ("        /*TEMP-BREAK 启动阶段必然异常*/\n"
          "        if (Environment.GetEnvironmentVariable(\"GHIBLI_CRASH_TEST\") == \"1\")\n"
          "            throw new InvalidOperationException(\"TEMP-BREAK 启动阶段注入异常\");\n"
          "        AssertDensityPresets();\n        BuildTray();")

fails = []


def build():
    r = subprocess.run(["cmd.exe", "/c", "build.cmd"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    bad = [l for l in (r.stdout or "").splitlines() if "error" in l.lower() or "警告" in l]
    return r.returncode, bad[:3]


def kill():
    import psutil
    for p in psutil.process_iter(["name"]):
        try:
            if p.info["name"] and "GhibliMeadow" in p.info["name"]:
                p.kill()
        except Exception:
            pass
    time.sleep(1.5)


def alive():
    import psutil
    return [p.info["pid"] for p in psutil.process_iter(["name", "pid"])
            if p.info.get("name") and "GhibliMeadow" in p.info["name"]]


def log_tail(off):
    if not os.path.exists(LOG):
        return ""
    with io.open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(off)
        return f.read()


# ---------- 注入（注入前先确认源码干净）----------
s = io.open(SRC, encoding="utf-8").read()
assert "TEMP-BREAK" not in s, "源码里已有 TEMP-BREAK，先修源码再跑"
assert s.count(ANCHOR) == 1, "锚点命中 %d 次" % s.count(ANCHOR)
shutil.copy(SRC, BAK)
io.open(SRC, "w", encoding="utf-8").write(s.replace(ANCHOR, INJECT))
print("已注入启动阶段异常（由环境变量 GHIBLI_CRASH_TEST=1 触发，默认不影响正常启动）")

rc, bad = build()
print("注入后构建 RC=%d %s" % (rc, bad or ""))
if rc != 0:
    fails.append("注入后构建失败")

# ---------- 触发 ----------
kill()
off = os.path.getsize(LOG) if os.path.exists(LOG) else 0
env = dict(os.environ)
env["GHIBLI_CRASH_TEST"] = "1"
print()
print("以 GHIBLI_CRASH_TEST=1 启动（应当走守卫并退出）…")
p = subprocess.Popen([os.path.join(DIST, "GhibliMeadow.exe")], cwd=DIST, env=env, close_fds=True)
try:
    code = p.wait(timeout=60)
except subprocess.TimeoutExpired:
    code = None
    p.kill()
print("  退出码 = %s" % code)
txt = log_tail(off)
alive_after = alive()
print("  进程残留 = %s" % (alive_after or "无 ✓"))
print("  日志含 FATAL = %s ；含「进程将退出」= %s"
      % ("是" if "FATAL" in txt else "否", "是" if "进程将退出" in txt else "否"))

if code is None:
    fails.append("进程 60 秒内没退出 —— 守卫没生效（正是「僵尸进程」的表现）")
elif code != 0:
    fails.append("退出码 %s ≠ 0 —— 会被计划任务当崩溃反复拉起" % code)
if alive_after:
    fails.append("进程仍在（PID %s）—— 守卫没生效" % alive_after)
if "FATAL" not in txt:
    fails.append("日志里没有 FATAL")
if "进程将退出" not in txt:
    fails.append("日志里没有「进程将退出」")

# ---------- 对照：不带环境变量应当正常启动 ----------
print()
print("对照：不带 GHIBLI_CRASH_TEST 启动（应当正常运行，证明守卫不误伤正常路径）…")
kill()
off2 = os.path.getsize(LOG) if os.path.exists(LOG) else 0
subprocess.Popen([os.path.join(DIST, "GhibliMeadow.exe")], cwd=DIST, close_fds=True)
# 注意：不能"等进程出现"就去读日志 —— 进程 2 秒内就有了，但「已挂到桌面层」要等
# WebView2 初始化 + 导航 + 首帧握手（实测 6~10 秒）。要等**日志**，不是等进程。
txt2 = ""
deadline = time.time() + 45
while time.time() < deadline:
    time.sleep(1.5)
    txt2 = log_tail(off2)
    if "已挂到桌面层" in txt2:
        break
ok_alive = alive()
print("  进程 = %s ；日志含「已挂到桌面层」= %s"
      % (ok_alive or "无（**误伤正常路径**）", "是" if "已挂到桌面层" in txt2 else "否"))
if not ok_alive:
    fails.append("不带注入变量时进程没能启动 —— 守卫误伤正常路径")
if "已挂到桌面层" not in txt2:
    fails.append("不带注入变量时没有挂载成功")

# ---------- 还原并双向断言 ----------
kill()
shutil.copy(BAK, SRC)
os.remove(BAK)
s2 = io.open(SRC, encoding="utf-8").read()
assert "TEMP-BREAK" not in s2, "还原后仍有 TEMP-BREAK！"
assert "private void StartCore()" in s2 and "StartCore();" in s2, "还原后 StartCore 结构不见了！"
rc, bad = build()
print()
print("已还原并重新构建 RC=%d %s" % (rc, bad or ""))
if rc != 0:
    fails.append("还原后构建失败")

print()
print("=" * 72)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 启动阶段异常时进程退干净（退出码 0、无残留）；正常路径不受影响；源码已还原为干净状态")
