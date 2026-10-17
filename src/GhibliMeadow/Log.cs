using System;
using System.IO;
using System.Text;

namespace GhibliMeadow;

/// <summary>极简日志，写到 %LOCALAPPDATA%\GhibliMeadow\wallpaper.log，便于排查实机问题。</summary>
internal static class Log
{
    private static readonly object Gate = new();
    private static string? _path;

    public static string Dir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GhibliMeadow");

    public static string FilePath
    {
        get
        {
            if (_path == null) _path = Path.Combine(Dir, "wallpaper.log");
            return _path;
        }
    }

    public static void Info(string msg) => Write("INFO ", msg);
    public static void Warn(string msg) => Write("WARN ", msg);
    public static void Error(string msg) => Write("ERROR", msg);

    public static void Fatal(Exception ex) => Write("FATAL", ex.ToString());

    /// <summary>超过 2 MB 就把当前日志挪成 .1，再开新的 —— 长时间挂机不会把磁盘写满。</summary>
    private static void Roll()
    {
        try
        {
            var fi = new FileInfo(FilePath);
            if (!fi.Exists || fi.Length < 2 * 1024 * 1024) return;
            var bak = FilePath + ".1";
            if (File.Exists(bak)) File.Delete(bak);
            File.Move(FilePath, bak);
        }
        catch { }
    }

    private static void Write(string level, string msg)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Dir);
                Roll();
                var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {msg}{Environment.NewLine}";
                File.AppendAllText(FilePath, line, Encoding.UTF8);
            }
        }
        catch
        {
            // 日志失败绝不能影响壁纸本身
        }
    }
}
