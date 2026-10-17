using System;
using System.Threading;
using System.Windows.Forms;

namespace GhibliMeadow;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        /* --quiet：被自启 / 计划任务拉起时用。检测到已有实例就**静默退出**，
         * 不弹 MessageBox —— 自启与"崩溃自动拉起"都可能与已有实例撞车，
         * 每次登录弹一个"程序已经在运行了"的对话框是明显的引入问题。
         * 手动双击（不带该参数）仍然弹框，否则用户会以为"点了没反应"。 */
        bool quiet = false;
        foreach (var a in args)
        {
            if (string.Equals(a, "--quiet", StringComparison.OrdinalIgnoreCase)) quiet = true;
        }

        using var mutex = new Mutex(true, @"Local\GhibliMeadowWallpaper.SingleInstance", out bool isFirst);
        if (!isFirst)
        {
            if (quiet)
            {
                Log.Info("已有实例在运行，本次以 --quiet 启动，静默退出");
                return;
            }
            MessageBox.Show("壁纸程序已经在运行了（请查看系统托盘的花形图标）。",
                AppConfig.AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        /* 启动连击保护：只在 --quiet（无人值守）时生效。
         * 计划任务是"失败每 1 分钟重启"，若某次改动让进程必然非 0 退出，
         * 这里能把它掐断，避免连夜重启几百次。**手动双击永远放行** ——
         * 否则用户修好问题后连手动启动都被挡住，反而更难恢复。
         * 退出码保持 0：这是"主动放弃"，不是崩溃，不该再触发任务重启。 */
        if (quiet && !StartupGuard.AllowQuietStart())
        {
            Log.Error("本次以 --quiet 启动被连击保护拦下，静默退出");
            return;
        }

        // 全局异常一律记入日志，避免"界面没反应也查不到原因"
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Log.Fatal(e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString() ?? "unknown"));
        Application.ThreadException += (_, e) => Log.Fatal(e.Exception);

        // 每显示器 DPI 感知：多屏不同缩放比下画面才不会被系统拉伸
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            var app = new WallpaperApp(quiet);

            // 关键：初始化必须放在消息循环**之内**。
            // 若在 Application.Run 之前初始化，WinForms 还没装好同步上下文，
            // await 的续体会落到线程池线程上，导致窗口与非 STA 的 WebView2
            // 被创建在池线程里，线程一退出窗口即失效。
            EventHandler? once = null;
            once = (_, _) =>
            {
                Application.Idle -= once;
                app.Start();
            };
            Application.Idle += once;

            Application.Run(app);
        }
        catch (Exception ex)
        {
            Log.Fatal(ex);
            /* 无人值守启动时绝不弹模态框：否则配上开机自启，每次登录都会留下一个
             * 必须手动点掉、而且根本没人在看的对话框（任务还视其为成功、不会重试）。 */
            if (!quiet)
            {
                MessageBox.Show("启动失败：" + ex.Message + "\n\n详情见日志：\n" + Log.FilePath,
                    AppConfig.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        finally
        {
            GC.KeepAlive(mutex);
        }
    }
}
