"""自启（Run 键方案）回归。

背景：计划任务方案在这台机器上被系统/安全策略拦死 —— 注册「动作指向**未签名程序或脚本**」
的任务会被拒（HRESULT 0x80004005），只有已签名的系统二进制才放行。Run 键是另一套机制，
不受该拦截影响，所以改用 Run 键。

本脚本验证：
  A 安装脚本写入的 Run 值内容**正确**（带引号的 exe 路径 + --quiet），
    且值名与程序内部一致（否则托盘勾选状态会永远对不上）；
  B 卸载脚本能删掉；
  C 卸载脚本可重入（没有条目时也返回 0，不报错）；
  D 最后装回去（交付状态 = 已开启自启）。
"""
import io
import os
import subprocess
import sys
import winreg

ROOT = r"C:\Users\byted\WorkBuddy\2026-09-23-21-59-33\GhibliMeadow"
DIST = os.path.join(ROOT, "dist")
EXE = os.path.join(DIST, "GhibliMeadow.exe")
RUNKEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE = "GhibliMeadowWallpaper"        # 必须与 WallpaperApp.RunValue 一致

fails = []


def run_script(name):
    r = subprocess.run(["cmd.exe", "/c", os.path.join(DIST, name)], cwd=DIST,
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       stdin=subprocess.DEVNULL, timeout=120)
    return r.returncode, ((r.stdout or "") + (r.stderr or ""))


def read_run_value():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUNKEY) as k:
            v, _ = winreg.QueryValueEx(k, VALUE)
            return v
    except OSError:
        return None


def delete_run_value():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUNKEY, 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, VALUE)
    except OSError:
        pass


src = io.open(os.path.join(ROOT, "src", "GhibliMeadow", "WallpaperApp.cs"), encoding="utf-8").read()
same = ('"' + VALUE + '"') in src
print("值名与程序内部一致（RunValue）: %s" % same)
if not same:
    fails.append("程序里找不到 RunValue = %s —— 脚本与程序不一致" % VALUE)

print()
print("=" * 72)
print("A 段：安装脚本")
delete_run_value()
rc, out = run_script("安装自启.cmd")
val = read_run_value()
print("  脚本退出码 %d" % rc)
for ln in out.strip().splitlines():
    if ln.strip():
        print("    | " + ln.strip()[:100])
print("  Run 值 = %s" % (val if val is not None else "**未写入**"))
if rc != 0:
    fails.append("A: 安装脚本退出码 %d" % rc)
if val is None:
    fails.append("A: 没有写入 Run 值")
else:
    ok_exe = os.path.normcase(EXE) in os.path.normcase(val)
    ok_quiet = "--quiet" in val
    ok_quote = val.strip().startswith('"')
    print("  含正确 exe 路径 = %s ；带 --quiet = %s ；路径带引号 = %s" % (ok_exe, ok_quiet, ok_quote))
    if not ok_exe:
        fails.append("A: Run 值里的路径不对：%r" % val)
    if not ok_quiet:
        fails.append("A: Run 值没带 --quiet（自启时会弹框）：%r" % val)
    if not ok_quote:
        fails.append("A: 路径没加引号，带空格时会启动失败：%r" % val)

print()
print("-" * 72)
print("B 段：卸载脚本")
rc, out = run_script("卸载自启.cmd")
val = read_run_value()
print("  脚本退出码 %d ；Run 值 = %s" % (rc, val if val is not None else "已删除 ✓"))
if rc != 0:
    fails.append("B: 卸载脚本退出码 %d" % rc)
if val is not None:
    fails.append("B: 卸载后 Run 值仍在")

print()
print("-" * 72)
print("C 段：卸载脚本可重入（没有条目时也应正常返回 0）")
rc, out = run_script("卸载自启.cmd")
print("  脚本退出码 %d ；输出含「Nothing to do」= %s"
      % (rc, "是" if "Nothing to do" in out else "否"))
if rc != 0:
    fails.append("C: 重复卸载退出码 %d（应为 0）" % rc)

print()
print("-" * 72)
print("D 段：装回去（交付状态 = 已开启自启）")
rc, _ = run_script("安装自启.cmd")
val = read_run_value()
print("  退出码 %d ；Run 值 = %s" % (rc, val))
if val is None:
    fails.append("D: 重新安装失败")

print()
print("=" * 72)
if fails:
    print("FAIL (%d)" % len(fails))
    for f in fails:
        print("  ✗", f)
    sys.exit(1)
print("PASS — Run 键式自启可用：写入内容正确（带引号 + --quiet）、卸载可重入、已装回")
