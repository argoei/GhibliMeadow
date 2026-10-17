"""可移植性实测：验证 README 那句"成品，可直接整个拷走"是真的。

做法：把 dist 整体复制到一个全新目录，从**副本**启动，然后：
  ① 日志里的「程序目录」必须等于副本路径 —— 否则测的还是原地，等于没测；
  ② 必须挂到桌面层（可见=True）并开始出帧；
  ③ 不得有 ERROR；
  ④ 副本里的 config.json 若不存在，程序应自己生成默认配置（首次运行路径）。
跑完清理副本与进程。
"""
import io
import os
import shutil
import subprocess
import sys
import time

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
DIST = os.path.join(ROOT, "dist")
COPY = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\_portable_test"
LOG = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow", "wallpaper.log")

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


# 1) 复制副本，并刻意**删掉 config.json** —— 首次运行应当自己生成
kill()
if os.path.isdir(COPY):
    shutil.rmtree(COPY, ignore_errors=True)
shutil.copytree(DIST, COPY)
os.remove(os.path.join(COPY, "config.json"))
n_files = sum(len(f) for _, _, f in os.walk(COPY))
print("副本: %s（%d 个文件，已删掉 config.json 以测首次运行）" % (COPY, n_files))
print("副本 web/ 存在:", os.path.isdir(os.path.join(COPY, "web")))

# 2) 从副本启动
before = os.path.getsize(LOG) if os.path.exists(LOG) else 0
subprocess.Popen([os.path.join(COPY, "GhibliMeadow.exe")], cwd=COPY, close_fds=True)

txt = ""
deadline = time.time() + 30
while time.time() < deadline:
    time.sleep(1.0)
    if os.path.exists(LOG):
        with io.open(LOG, encoding="utf-8", errors="replace") as f:
            f.seek(before)
            txt = f.read()
    if "已挂到桌面层" in txt and "页面开始出帧" in txt:
        break

lines = txt.splitlines()
print()
print("  日志新增 %d 行" % len(lines))

# 3) 判据
exe_dir = [l for l in lines if "程序目录" in l]
mount = [l for l in lines if "已挂到桌面层" in l]
frames = [l for l in lines if "页面开始出帧" in l]
errs = [l for l in lines if "ERROR" in l.upper()]

if exe_dir:
    shown = exe_dir[0].split("程序目录:")[-1].strip()
    print("  程序目录: %s" % shown)
    if os.path.normcase(shown.rstrip("\\")) != os.path.normcase(COPY):
        fails.append("① 程序目录是 %s，不是副本路径 —— 测的不是副本" % shown)
    else:
        print("     ✓ 等于副本路径，确实在跑副本")
else:
    fails.append("① 日志里没有「程序目录」，无法确认跑的是哪一份")

if not mount:
    fails.append("② 没有挂到桌面层")
else:
    print("  挂载: %s" % mount[0].split("]")[-1].strip()[:90])
    if "可见=True" not in mount[0]:
        fails.append("② 挂载成功但窗口不可见")

if not frames:
    fails.append("③ 没有「页面开始出帧」")
else:
    print("  出帧: %s" % frames[0].split("]")[-1].strip()[:60])

if errs:
    fails.append("④ 出现 %d 条 ERROR：%s" % (len(errs), errs[0].strip()[:100]))
else:
    print("  错误: 0 条")

# 4) 首次运行应生成默认配置
gen = os.path.join(COPY, "config.json")
if os.path.exists(gen):
    sz = os.path.getsize(gen)
    print("  首次运行自动生成 config.json: 是（%d 字节）" % sz)
else:
    fails.append("⑤ 副本里没有生成 config.json —— 首次运行路径有问题")

kill()
shutil.rmtree(COPY, ignore_errors=True)
print()
print("  已清理副本:", not os.path.isdir(COPY))

print()
print("=" * 72)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — dist 副本在原目录之外独立运行成功：挂载、出帧、自动生成配置、0 错误")
