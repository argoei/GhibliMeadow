using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace GhibliMeadow;

/// <summary>
/// 启动连击保护 —— 防止"崩溃 → 计划任务 1 分钟后拉起 → 又崩"变成无限循环。
///
/// 背景：开机自启用的是 Windows 计划任务，配置为「失败每 1 分钟重启、最多 999 次」。
/// 若某次改动让进程**必然**以非 0 退出（某个回调逃逸、WebView2 初始化异常等），
/// 就会每分钟重启一次、持续约 16 小时，期间不断写日志、抢 GPU，而用户只看到闪屏。
///
/// 判定与处置：
///   · 只看**紧挨着的重启**：两次启动间隔 &lt; 120 秒才算一次"连击"（正常手动重启不会这么密）；
///   · 连续 3 次判定为崩溃循环 → 进入 **1 小时冷却**，期间拒绝继续启动，并写一份
///     `last-failure.txt` 供排查；
///   · **只对 `--quiet`（无人值守）启动生效。手动双击永远放行** ——
///     否则用户修好问题后连手动启动都被挡住，反而更难恢复。
///   · 稳定运行满 <see cref="HealthyAfterSeconds"/> 秒后清零计数。
///
/// 所有读写都吞异常：守卫本身绝不能成为新的崩溃源。
/// </summary>
internal static class StartupGuard
{
    /// <summary>两次启动间隔小于该秒数，才算"崩溃后又被拉起"。</summary>
    private const int RapidWindowSeconds = 120;

    /// <summary>连续这么多次快速启动就认定是崩溃循环。</summary>
    private const int MaxRapidStarts = 3;

    /// <summary>判定为崩溃循环后，静默多久（秒）。</summary>
    private const int CooldownSeconds = 3600;

    /// <summary>稳定运行满该秒数即视为启动成功，清零计数。</summary>
    public const int HealthyAfterSeconds = 60;

    private static string StatePath => Path.Combine(Log.Dir, "startup-guard.txt");
    private static string FailurePath => Path.Combine(Log.Dir, "last-failure.txt");

    private static long Now => (long)(DateTime.UtcNow - DateTime.UnixEpoch).TotalSeconds;

    /// <summary>
    /// 无人值守（--quiet）启动时先问一句。返回 false 表示"认定在崩溃循环里，本次别启动了"。
    /// </summary>
    public static bool AllowQuietStart()
    {
        try
        {
            long lastAttempt = 0, failCount = 0, giveUpUntil = 0;
            try
            {
                if (File.Exists(StatePath))
                {
                    var parts = File.ReadAllText(StatePath).Split('|');
                    if (parts.Length >= 3)
                    {
                        long.TryParse(parts[0], out lastAttempt);
                        long.TryParse(parts[1], out failCount);
                        long.TryParse(parts[2], out giveUpUntil);
                    }
                }
            }
            catch { }

            long now = Now;

            if (now < giveUpUntil)
            {
                long left = giveUpUntil - now;
                Log.Error($"启动连击保护生效中：已连续 {MaxRapidStarts} 次启动后异常退出，" +
                          $"还剩约 {left / 60} 分钟才允许再试。若已修好问题，请**手动双击启动**（手动启动不受此限制）。");
                return false;
            }

            bool rapid = lastAttempt > 0 && (now - lastAttempt) < RapidWindowSeconds;
            long count = rapid ? failCount + 1 : 1;

            if (count > MaxRapidStarts)
            {
                giveUpUntil = now + CooldownSeconds;
                Write(now, count, giveUpUntil);
                Log.Error($"检测到启动崩溃循环（{count} 次快速启动）：暂停无人值守启动 {CooldownSeconds / 60} 分钟，" +
                          "避免无限重启。请查看日志与 last-failure.txt。手动双击启动不受此限制。");
                try
                {
                    File.WriteAllText(FailurePath,
                        $"时间: {DateTime.Now:yyyy-MM-dd HH:mm:ss}{Environment.NewLine}" +
                        $"现象: {MaxRapidStarts} 次以上的启动都在 {RapidWindowSeconds} 秒内异常退出（疑似崩溃循环）。{Environment.NewLine}" +
                        $"处置: 已暂停无人值守启动至 {DateTime.Now.AddSeconds(CooldownSeconds):yyyy-MM-dd HH:mm:ss}。{Environment.NewLine}" +
                        $"排查: 打开日志 {Log.FilePath} 查看 FATAL 行；修好后手动双击 GhibliMeadow.exe 即可（手动启动不受限制）。{Environment.NewLine}",
                        Encoding.UTF8);
                }
                catch { }
                return false;
            }

            Write(now, count, 0);
            Log.Info($"启动连击计数: {count}/{MaxRapidStarts}（间隔 {RapidWindowSeconds}s 内视为连击）");
            return true;
        }
        catch
        {
            return true;   // 守卫自身出错时一律放行，绝不阻挡正常启动
        }
    }

    /// <summary>稳定运行一段时间后调用：清零连击计数。</summary>
    public static void MarkHealthy()
    {
        try
        {
            Write(Now, 0, 0);
            Log.Info($"启动连击计数已清零（已稳定运行 {HealthyAfterSeconds} 秒）");
        }
        catch { }
    }

    private static void Write(long attempt, long count, long giveUpUntil)
    {
        try
        {
            Directory.CreateDirectory(Log.Dir);
            File.WriteAllText(StatePath,
                string.Format(CultureInfo.InvariantCulture, "{0}|{1}|{2}", attempt, count, giveUpUntil),
                Encoding.UTF8);
        }
        catch { }
    }
}
