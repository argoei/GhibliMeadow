"""启动连击保护回归。

计划任务是「失败每 1 分钟重启」，所以"崩溃 → 拉起 → 又崩"能演变成整夜重启。
本脚本验证三件事，缺一条这套防护就不成立：

  A **拦得住**：连续 4 次快速 --quiet 启动 → 第 4 次必须被拒（不挂载、立即退出），
    并留下 last-failure.txt；
  B **手动能自救**：冷期内以非 --quiet 启动 → **必须正常挂载**
    （若这条不成立，用户修好问题后连手动启动都被挡住，反而更难恢复）；
  C **成功会清零**：--quiet 启动并稳定运行满 60 秒 → 计数归零。

跑完清理状态文件，让交付状态是干净的。
"""
import io
import os
import subprocess
import sys
import time

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
DIST = os.path.join(ROOT, "dist")
EXE = os.path.join(DIST, "GhibliMeadow.exe")
APPDIR = os.path.join(os.environ["LOCALAPPDATA"], "GhibliMeadow")
LOG = os.path.join(APPDIR, "wallpaper.log")
STATE = os.path.join(APPDIR, "startup-guard.txt")
FAILFILE = os.path.join(APPDIR, "last-failure.txt")

fails = []
ROUNDS = 4            # 第 4 次应当被拦
MOUNT_TIMEOUT = 40


def procs():
    import psutil
    return [p.info["pid"] for p in psutil.process_iter(["name", "pid"])
            if p.info.get("name") and "GhibliMeadow" in p.info["name"]]


def kill():
    import psutil
    for p in psutil.process_iter(["name"]):
        try:
            if p.info["name"] and "GhibliMeadow" in p.info["name"]:
                p.kill()
        except Exception:
            pass
    time.sleep(1.5)


def logsize():
    return os.path.getsize(LOG) if os.path.exists(LOG) else 0


def logsince(off):
    if not os.path.exists(LOG):
        return ""
    with io.open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(off)
        return f.read()


def state():
    """返回 (attempt, count, giveUpUntil)。

    注意用 utf-8-sig：.NET 的 `File.WriteAllText(..., Encoding.UTF8)` **会写 BOM**，
    按 utf-8 读出来第一个字段会带 \\ufeff，`int()` 直接抛错 → 返回 None →
    下游"C 段计数是否归零"那条断言会被 `if st_after and ...` 悄悄跳过（**静默空跑**）。
    这个坑真的踩过：日志显示清零成功，但状态读取全是 None。"""
    if not os.path.exists(STATE):
        return None
    try:
        p = io.open(STATE, encoding="utf-8-sig").read().strip().split("|")
        return (int(p[0]), int(p[1]), int(p[2]))
    except Exception:
        return None


def clean():
    kill()
    for f in (STATE, FAILFILE):
        try:
            os.remove(f)
        except Exception:
            pass


# ══════════════════════════════ A 拦得住
print("═" * 74)
print("A 段：连续 %d 次快速 --quiet 启动（模拟崩溃后被反复拉起）" % ROUNDS)
clean()
refused = False
counts = []
for i in range(1, ROUNDS + 1):
    off = logsize()
    subprocess.Popen([EXE, "--quiet"], cwd=DIST, close_fds=True)
    # 等它挂载（或被守卫直接拒绝）
    txt = ""
    deadline = time.time() + MOUNT_TIMEOUT
    while time.time() < deadline:
        time.sleep(1.5)
        txt = logsince(off)
        if "已挂到桌面层" in txt or "被连击保护拦下" in txt:
            break
    mounted = "已挂到桌面层" in txt
    blocked = "被连击保护拦下" in txt
    st = state()
    counts.append(st[1] if st else None)
    print("  第 %d 次: 挂载=%-5s 被拦=%-5s 状态=%s" % (i, mounted, blocked, st))
    if st is None:
        fails.append("A: 第 %d 次读不到状态文件 —— 后面的计数断言会静默空跑，不算验证过" % i)
    if i < ROUNDS and not mounted:
        fails.append("A: 第 %d 次本应正常启动，却没有挂载（防护过早生效）" % i)
    if i == ROUNDS:
        refused = blocked and not mounted
        if not refused:
            fails.append("A: 第 %d 次没有被拦下（连击防护失效）" % i)
    if blocked:
        break
    kill()

print()
print("  连击计数序列: %s（应为 %s）" % (counts, list(range(1, ROUNDS + 1))))
if counts != list(range(1, ROUNDS + 1)):
    fails.append("A: 连击计数序列 %s 不等于 %s —— 计数逻辑与预期不符"
                 % (counts, list(range(1, ROUNDS + 1))))
print("  被拦后的状态文件: %s" % (state(),))
if os.path.exists(FAILFILE):
    print("  last-failure.txt 已写出（前 2 行）:")
    for ln in io.open(FAILFILE, encoding="utf-8").read().splitlines()[:2]:
        print("    " + ln)
else:
    fails.append("A: 没有写出 last-failure.txt")

# ══════════════════════════════ B 手动能自救
print()
print("─" * 74)
print("B 段：冷却期内**手动**启动（不带 --quiet）必须正常放行")
off = logsize()
subprocess.Popen([EXE], cwd=DIST, close_fds=True)
txt = ""
deadline = time.time() + MOUNT_TIMEOUT + 20
while time.time() < deadline:
    time.sleep(1.5)
    txt = logsince(off)
    if "已挂到桌面层" in txt:
        break
ok = "已挂到桌面层" in txt
print("  手动启动挂载成功 = %s" % ("是 ✓" if ok else "否（**用户将无法自救**）"))
if not ok:
    fails.append("B: 冷却期内手动启动也被挡住 —— 用户无法自救（这条比拦不住更糟）")

# ══════════════════════════════ C 成功会清零
print()
print("─" * 74)
print("C 段：稳定运行满 60 秒后计数应清零（当前进程已挂载，等它跑够）")
st_before = state()
print("  等待前状态: %s" % (st_before,))
deadline = time.time() + 90
cleared = False
while time.time() < deadline:
    time.sleep(5)
    txt = logsince(off)
    if "启动连击计数已清零" in txt:
        cleared = True
        break
st_after = state()
print("  日志出现「启动连击计数已清零」= %s ；状态 = %s" % ("是" if cleared else "否", st_after))
if not cleared:
    fails.append("C: 稳定运行后没有清零连击计数")
if st_after and st_after[1] != 0:
    fails.append("C: 计数没有归零（实际 %s）" % (st_after[1],))

# ══════════════════════════════ 清理
clean()
print()
print("已清理状态文件:", not os.path.exists(STATE) and not os.path.exists(FAILFILE))

print()
print("=" * 74)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — 连击防护拦得住崩溃循环、手动启动仍可自救、稳定运行会清零")
