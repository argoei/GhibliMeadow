using System;
using System.Drawing;
using System.Runtime.InteropServices;

namespace GhibliMeadow;

/// <summary>
/// 桌面层（WorkerW）定位与挂载。
///
/// 原理：explorer 的桌面由 Progman 与若干 WorkerW 组成，其中承载图标的是持有
/// SHELLDLL_DefView 子窗口的那一层，**位于它之后的那个 WorkerW 就是专门用来
/// 放壁纸的底层窗口**。把我们的窗口 SetParent 成它的子窗口，就会被桌面图标
/// 盖住，从而真正"贴"在桌面上。
/// </summary>
internal static class DesktopHost
{
    /// <summary>探测壁纸宿主窗口；找不到时回退到 Progman。</summary>
    public static IntPtr Find()
    {
        var progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero)
        {
            Log.Warn("未找到 Progman 窗口");
            return IntPtr.Zero;
        }

        // 让 explorer 生成 WorkerW。Win10 / Win11 各版本对 wParam 的处理不同，
        // 两种参数都发一次最稳妥。
        Native.SendMessageTimeout(progman, Native.WM_SPAWN_WORKER, IntPtr.Zero, IntPtr.Zero,
            Native.SMTO_NORMAL, 1500, out _);
        Native.SendMessageTimeout(progman, Native.WM_SPAWN_WORKER, new IntPtr(0xD), new IntPtr(0x1),
            Native.SMTO_NORMAL, 1500, out _);

        IntPtr worker = IntPtr.Zero;
        Native.EnumWindows((hwnd, _) =>
        {
            if (Native.FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            {
                // 图标层之后（z 序更低）的第一个 WorkerW 即壁纸层
                var w = Native.FindWindowEx(IntPtr.Zero, hwnd, "WorkerW", null);
                if (w != IntPtr.Zero)
                {
                    worker = w;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);

        if (worker == IntPtr.Zero)
        {
            Log.Warn("未找到 WorkerW，回退到 Progman");
            return progman;
        }
        return worker;
    }

    /// <summary>把窗口挂到桌面层，并修正样式与位置。</summary>
    public static bool Attach(IntPtr hwnd, IntPtr host, Rectangle screenBounds)
    {
        if (!Native.IsWindow(host) || !Native.IsWindow(hwnd)) return false;

        // 先把窗口改成真正的子窗口：去掉弹出式与边框，加上 CHILD。
        long style = Native.GetWindowLongPtr(hwnd, Native.GWL_STYLE).ToInt64();
        style &= ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME);
        style |= Native.WS_CHILD | Native.WS_VISIBLE | Native.WS_CLIPCHILDREN | Native.WS_CLIPSIBLINGS;
        Native.SetWindowLongPtr(hwnd, Native.GWL_STYLE, new IntPtr(style));

        long ex = Native.GetWindowLongPtr(hwnd, Native.GWL_EXSTYLE).ToInt64();
        ex |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW;
        ex &= ~Native.WS_EX_APPWINDOW;
        Native.SetWindowLongPtr(hwnd, Native.GWL_EXSTYLE, new IntPtr(ex));

        // SetParent 成功时返回旧父窗口；原本就是顶层窗口时旧父为空，
        // 因此不能用返回值判断成败，只能靠随后的 SetWindowPos 与 IsStillAttached 校验。
        Native.SetParent(hwnd, host);

        // SetParent 之后坐标变成相对宿主的客户区，用 ScreenToClient 换算，
        // 这样无论 WorkerW 铺在虚拟桌面的哪个位置都能放对。
        var pt = new Native.POINT { X = screenBounds.Left, Y = screenBounds.Top };
        Native.ScreenToClient(host, ref pt);

        bool ok = Native.SetWindowPos(hwnd, IntPtr.Zero, pt.X, pt.Y, screenBounds.Width, screenBounds.Height,
            Native.SWP_NOACTIVATE | Native.SWP_NOZORDER | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);

        if (!ok)
        {
            Log.Warn($"SetWindowPos 失败: {Marshal.GetLastWin32Error()}");
            return false;
        }
        return true;
    }

    /// <summary>窗口是否仍挂在有效的桌面层下（explorer 重启后宿主会失效）。</summary>
    public static bool IsStillAttached(IntPtr hwnd, IntPtr host)
    {
        if (!Native.IsWindow(hwnd)) return false;
        if (!Native.IsWindow(host)) return false;
        return Native.GetParent(hwnd) == host;
    }
}
