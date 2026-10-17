using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;

namespace GhibliMeadow;

/// <summary>
/// 一个注册一次、可创建多个实例的原生窗口类，用来承载 WebView2。
///
/// 之所以不用 WinForms 的 Form：Form 认为自己是一个顶层窗口，被 SetParent 到
/// 别的进程的窗口之后，它的布局与定位逻辑会和我们的手工定位打架。裸 Win32 窗口
/// 完全可控，位置只由我们决定。
/// </summary>
internal static class RawWindow
{
    private const string ClassName = "GhibliMeadowWallpaperWnd";

    private static ushort _atom;
    // 必须持有委托引用，否则被 GC 回收后 WndProc 回调会崩溃
    private static Native.WndProcDelegate? _proc;

    /// <summary>显示器布局 / DPI 发生变化时抛出，交给上层整体重建。</summary>
    public static event Action? DisplayEnvironmentChanged;

    public static void EnsureRegistered()
    {
        if (_atom != 0) return;

        _proc = WndProc;
        var wc = new Native.WNDCLASSEX
        {
            cbSize = (uint)Marshal.SizeOf<Native.WNDCLASSEX>(),
            style = 0,
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
            cbClsExtra = 0,
            cbWndExtra = 0,
            hInstance = Native.GetModuleHandle(null),
            hIcon = IntPtr.Zero,
            hCursor = IntPtr.Zero,
            hbrBackground = IntPtr.Zero,   // 背景不刷，避免闪白
            lpszMenuName = null,
            lpszClassName = ClassName,
            hIconSm = IntPtr.Zero,
        };

        _atom = Native.RegisterClassEx(ref wc);
        if (_atom == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "RegisterClassEx 失败");
    }

    /// <summary>
    /// 建窗口时先放在屏幕外。窗口必须带 WS_VISIBLE（否则 Chromium 认为文档不可见、
    /// 会停下 rAF，首帧就一直等不到），但又不能让用户看见它 ——
    /// 放到 -32000 处两全。挂载时再移到目标显示器上。
    /// </summary>
    private const int OffScreen = -32000;

    public static IntPtr Create(Rectangle bounds)
    {
        EnsureRegistered();
        var h = Native.CreateWindowEx(
            0,
            ClassName,
            "GhibliMeadow",
            unchecked((uint)(Native.WS_POPUP | Native.WS_VISIBLE | Native.WS_CLIPCHILDREN)),
            OffScreen, OffScreen, bounds.Width, bounds.Height,
            IntPtr.Zero, IntPtr.Zero, Native.GetModuleHandle(null), IntPtr.Zero);

        if (h == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateWindowEx 失败");
        return h;
    }

    public static void Destroy(IntPtr hwnd)
    {
        if (hwnd != IntPtr.Zero && Native.IsWindow(hwnd))
            Native.DestroyWindow(hwnd);
    }

    private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        /* 整体兜底。这个函数是 **Windows 直接回调** 的（窗口类注册时传的就是它），
         * 异常会跨过原生栈帧逃逸出去 —— 那是极少数能让进程直接终止的路径之一，
         * 而且崩在 DPI 变化/尺寸变化这种"用户正在插拔显示器"的时刻，最难排查。
         * 宁可吞掉一次通知（下一次看门狗会补上重建），也不能让进程崩。 */
        try
        {
            switch (msg)
            {
                case Native.WM_ERASEBKGND:
                    return new IntPtr(1);              // 已声称擦除，抑制系统背景填充

                case Native.WM_MOUSEACTIVATE:
                    return new IntPtr(Native.MA_NOACTIVATE);   // 绝不抢焦点

                case Native.WM_DPICHANGED:
                    DisplayEnvironmentChanged?.Invoke();
                    break;

                case Native.WM_SIZE:
                    SizeChanged?.Invoke(hWnd, wParam, lParam);
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Fatal(ex);
        }
        return Native.DefWindowProc(hWnd, msg, wParam, lParam);
    }

    /// <summary>WM_SIZE 转发（子窗口在宿主变化时可能被调整尺寸）。</summary>
    public static event Action<IntPtr, IntPtr, IntPtr>? SizeChanged;
}
