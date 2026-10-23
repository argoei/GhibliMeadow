using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace GhibliMeadow;

/// <summary>
/// 一块显示器上的壁纸面：一个原生子窗口 + 一个 WebView2 控制器。
/// 每块显示器一个实例，各自渲染并以「虚拟桌面物理像素坐标」为世界原点，
/// 因此相邻屏幕的画面在同一坐标系下天然对齐。
/// </summary>
internal sealed class WallpaperSurface : IDisposable
{
    private readonly Screen _screen;
    private readonly AppConfig _cfg;
    private readonly string _webDir;
    private readonly CoreWebView2Environment _env;
    private readonly double _t0;

    private IntPtr _hwnd;
    private CoreWebView2Controller? _controller;
    private bool _disposed;
    private TaskCompletionSource<bool>? _ready;

    public Screen Screen => _screen;
    public IntPtr Handle => _hwnd;
    public int Fps { get; private set; }
    /// <summary>最近一帧里客机在本显示器内的坐标（没有客机时为 -1）。</summary>
    public double LastPlaneX { get; private set; } = -1;
    public double LastPlaneY { get; private set; } = -1;
    public CoreWebView2? WebView => _controller?.CoreWebView2;

    public WallpaperSurface(Screen screen, AppConfig cfg, string webDir, CoreWebView2Environment env, double t0)
    {
        _screen = screen;
        _cfg = cfg;
        _webDir = webDir;
        _env = env;
        _t0 = t0;
    }

    public async Task CreateAsync(IntPtr host)
    {
        var b = _screen.Bounds;
        Log.Info($"创建壁纸面 {_screen.DeviceName} 物理区域 {b.X},{b.Y} {b.Width}x{b.Height}");

        // 先在显示器位置上建一个普通顶层窗口，等 WebView2 渲染管线就绪、
        // 导航完成之后**再**把它挂到桌面层。顺序很重要：如果先挂载，
        // Chromium 的 DirectComposition 视觉会挂到跨进程父窗口的合成树上，
        // 画面能渲染但不会更新到屏幕（表现为壁纸静止不动）。
        _hwnd = RawWindow.Create(b);
        RawWindow.SizeChanged += OnSizeChanged;
        Log.Info($"{_screen.DeviceName}: 窗口 0x{_hwnd.ToInt64():X} 建立，位置 {WindowRect()}");

        _ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _controller = await _env.CreateCoreWebView2ControllerAsync(_hwnd);
        _controller.Bounds = new Rectangle(0, 0, b.Width, b.Height);
        /* 底色必须与场景顶部天空一致。原来用的是草地的深绿，
         * 页面还没绘制时就会先闪一下深绿再跳到蓝天。 */
        try { _controller.DefaultBackgroundColor = Color.FromArgb(0x1E, 0x79, 0xD2); } catch { }
        _controller.IsVisible = true;

        var wv = _controller.CoreWebView2;
        wv.ProcessFailed += (_, e) => Log.Error($"{_screen.DeviceName}: WebView2 进程异常 {e.ProcessFailedKind} {e.Reason}");
        wv.NavigationCompleted += (_, e) =>
            Log.Info($"{_screen.DeviceName}: 导航完成 ok={e.IsSuccess} {(e.IsSuccess ? "" : e.WebErrorStatus.ToString())}");
        wv.DOMContentLoaded += (_, _) => Log.Info($"{_screen.DeviceName}: DOM 就绪");

        var s = wv.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.AreDevToolsEnabled = _cfg.Debug;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;

        wv.SetVirtualHostNameToFolderMapping("meadow.local", _webDir, CoreWebView2HostResourceAccessKind.Allow);
        wv.WebMessageReceived += OnWebMessage;

        var navigated = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        wv.NavigationCompleted += (_, e) =>
        {
            Log.Info($"{_screen.DeviceName}: 导航完成 ok={e.IsSuccess} {(e.IsSuccess ? "" : e.WebErrorStatus.ToString())}");
            navigated.TrySetResult(e.IsSuccess);
        };
        wv.ProcessFailed += (_, e) => Log.Error($"{_screen.DeviceName}: WebView2 进程异常 {e.ProcessFailedKind} {e.Reason}");

        wv.Navigate(BuildUrl(b));
        Log.Info($"{_screen.DeviceName}: 已导航到 {BuildUrl(b)}");

        // 等首帧内容就绪，再挂载
        var ok = await Task.WhenAny(navigated.Task, Task.Delay(20000)) == navigated.Task && navigated.Task.Result;
        if (!ok) Log.Warn($"{_screen.DeviceName}: 导航超时或失败，仍尝试挂载");

        /* 再等页面把**第一帧画面**画出来。窗口在这之前一直待在屏幕外，
         * 所以用户看不到任何空窗、底色或闪烁，桌面是被"直接替换"的。 */
        if (_ready != null)
        {
            var t0 = DateTime.UtcNow;
            await Task.WhenAny(_ready.Task, Task.Delay(4000));
            Log.Info($"{_screen.DeviceName}: 首帧就绪，等待 {(DateTime.UtcNow - t0).TotalMilliseconds:0} ms");
        }

        _attachedAt = DateTime.UtcNow;
        if (!DesktopHost.Attach(_hwnd, host, b))
            Log.Warn($"{_screen.DeviceName}: 挂载到桌面层失败，画面可能不可见");
        Log.Info($"{_screen.DeviceName}: 已挂到桌面层 0x{host.ToInt64():X}，位置 {WindowRect()} 可见={Native.IsWindowVisible(_hwnd)}");

        /* 挂载完再让页面收走起始遮罩，并多留 350ms 给合成器把首帧真正呈现出来。
         * 否则会出现"先一片纯底色、再跳成完整画面"的两段式切换。 */
        await Task.Delay(350);
        try { await wv.ExecuteScriptAsync("window.meadow && window.meadow.reveal()"); } catch { }

        await Task.Delay(4000);
        await ProbeAsync("挂载后 4 秒");

        if (_cfg.SelfTest)
        {
            await Task.Delay(8000);
            Log.Info($"{_screen.DeviceName}: 自检 —— 画面切换为纯品红");
            await wv.ExecuteScriptAsync(
                "document.getElementById('scene').style.display='none';" +
                "document.body.style.background='#FF00FF';");
        }
    }

    private DateTime _attachedAt = DateTime.MinValue;

    private string WindowRect()
    {
        if (!Native.GetWindowRect(_hwnd, out var r)) return "?";
        return $"{r.Left},{r.Top} {r.Right - r.Left}x{r.Bottom - r.Top}";
    }

    private void OnSizeChanged(IntPtr hwnd, IntPtr wParam, IntPtr lParam)
    {
        if (hwnd != _hwnd || _controller == null) return;
        int w = (int)(lParam.ToInt64() & 0xFFFF);
        int h = (int)((lParam.ToInt64() >> 16) & 0xFFFF);
        if (w > 0 && h > 0)
        {
            try { _controller.Bounds = new Rectangle(0, 0, w, h); } catch { }
        }
    }

    /// <summary>把页面内部状态回读到日志，便于排查"画面不动"这类问题。</summary>
    public async Task ProbeAsync(string tag)
    {
        var wv = WebView;
        if (wv == null) return;
        try
        {
            var r = await wv.ExecuteScriptAsync(
                "(function(){try{var s=window.meadow?window.meadow.stats():null;" +
                "return JSON.stringify({vis:document.visibilityState,hidden:document.hidden," +
                "running:window.meadow?window.meadow.running():null,stats:s," +
                "w:innerWidth,h:innerHeight,dpr:devicePixelRatio,cv:(document.getElementById('scene')||{}).width});" +
                "}catch(e){return 'ERR '+e}})()");
            Log.Info($"[探针 {tag}] {r}");
        }
        catch (Exception ex)
        {
            Log.Warn($"[探针 {tag}] 失败: {ex.Message}");
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.WebMessageAsJson;
            if (string.IsNullOrEmpty(json)) return;
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("type", out var ty) &&
                ty.ValueKind == JsonValueKind.String && ty.GetString() == "ready")
            {
                _ready?.TrySetResult(true);
                return;
            }
            if (doc.RootElement.TryGetProperty("fps", out var f) && f.TryGetInt32(out var fps))
            {
                if (Fps == 0 && fps > 0) Log.Info($"{_screen.DeviceName}: 页面开始出帧，fps={fps}");
                Fps = fps;
            }
            if (doc.RootElement.TryGetProperty("planeX", out var px) && px.TryGetDouble(out var pxv))
            {
                LastPlaneX = pxv;
                if (doc.RootElement.TryGetProperty("planeY", out var py) && py.TryGetDouble(out var pyv))
                    LastPlaneY = pyv;
            }
        }
        catch
        {
            // 页面消息不作为关键路径，解析失败忽略
        }
    }

    /// <summary>拼接页面入参：世界原点、物理尺寸、以及全部效果开关。</summary>
    private string BuildUrl(Rectangle b)
    {
        var q = new StringBuilder("https://meadow.local/index.html?");
        void Add(string k, string v) => q.Append(k).Append('=').Append(Uri.EscapeDataString(v)).Append('&');
        void AddI(string k, long v) => Add(k, v.ToString(CultureInfo.InvariantCulture));
        void AddD(string k, double v) => Add(k, v.ToString("0.####", CultureInfo.InvariantCulture));
        void AddB(string k, bool v) => Add(k, v ? "1" : "0");

        // 世界原点 = 该显示器在虚拟桌面中的物理像素坐标
        AddI("ox", b.X);
        AddI("oy", b.Y);
        AddI("pw", b.Width);
        AddI("ph", b.Height);

        AddI("fps", _cfg.Fps);
        AddD("density", _cfg.Density);
        AddD("wind", _cfg.Wind);
        AddD("veil", _cfg.Veil);
        AddD("drift", _cfg.Drift);
        AddD("renderScale", _cfg.RenderScale);
        AddI("seed", _cfg.Seed);
        AddD("scrim", _cfg.IconScrim);
        AddD("horizon", _cfg.Horizon);
        /* 云与牛羊这两组此前漏传：页面侧 CFG 早就支持并夹取，只是宿主没接线，
         * 于是在 config.json 里改它们不生效（一直是页面默认值）。补齐。 */
        AddD("cloudLife", _cfg.CloudLife);
        AddD("cloudDensity", _cfg.CloudDensity);
        AddD("cloudSpeed", _cfg.CloudSpeed);
        AddB("planes", _cfg.Planes);
        AddD("planeInterval", _cfg.PlaneInterval);
        AddB("biplane", _cfg.Biplane);
        AddD("biplaneInterval", _cfg.BiplaneInterval);
        AddB("egg", _cfg.EasterEgg);
        AddB("animals", _cfg.Animals);
        AddD("animalDensity", _cfg.AnimalDensity);
        AddI("t0", (long)_t0);
        AddI("budget", _cfg.PixelBudget);
        if (_cfg.Debug) AddI("debug", 1);

        return q.ToString().TrimEnd('&');
    }

    /// <summary>把新配置推给页面。渲染尺寸以外的参数都可以热更新。</summary>
    public async Task ApplyConfigAsync(AppConfig cfg, int fpsOverride)
    {
        var wv = WebView;
        if (wv == null) return;
        var o = new Dictionary<string, object>
        {
            ["fps"] = fpsOverride > 0 ? fpsOverride : cfg.Fps,
            ["density"] = cfg.Density,
            ["wind"] = cfg.Wind,
            ["veil"] = cfg.Veil,
            ["drift"] = cfg.Drift,
            ["scrim"] = cfg.IconScrim,
            ["horizon"] = cfg.Horizon,
            /* 与 BuildUrl 保持同一份字段清单：页面 set() 对这几项走 rebuildScene 一级 */
            ["cloudLife"] = cfg.CloudLife,
            ["cloudDensity"] = cfg.CloudDensity,
            ["cloudSpeed"] = cfg.CloudSpeed,
            ["planes"] = cfg.Planes,
            ["planeInterval"] = cfg.PlaneInterval,
            ["biplane"] = cfg.Biplane,
            ["biplaneInterval"] = cfg.BiplaneInterval,
            ["egg"] = cfg.EasterEgg,
            ["animals"] = cfg.Animals,
            ["animalDensity"] = cfg.AnimalDensity,
        };
        var json = JsonSerializer.Serialize(o);
        try
        {
            await wv.ExecuteScriptAsync($"window.meadow && window.meadow.set({json})");
        }
        catch (Exception ex)
        {
            Log.Warn("下发配置失败: " + ex.Message);
        }
    }

    /// <summary>把一次鼠标左键点击转发给页面（坐标为显示器内的物理像素）。</summary>
    public async Task ClickAtAsync(double x, double y)
    {
        var wv = WebView;
        if (wv == null) return;
        try
        {
            var r = await wv.ExecuteScriptAsync(
                string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "window.meadow && window.meadow.click({{x:{0:0.#},y:{1:0.#}}})", x, y));
            var kind = r == null ? "" : r.Trim('"');
            if (kind == "plane") Log.Info($"{_screen.DeviceName}: 点中客机 → 投放彩纸 @ {x:0},{y:0}");
            else if (kind == "biplane") Log.Info($"{_screen.DeviceName}: 点中双翼机 → 飞行员跳伞 @ {x:0},{y:0}");
            else if (kind == "cow" || kind == "sheep")
                Log.Info($"{_screen.DeviceName}: 点中{(kind == "cow" ? "牛" : "羊")} → 掀翻倒地 @ {x:0},{y:0}");
            else if (kind == "cloud") Log.Info($"{_screen.DeviceName}: 点中云 → 分裂 @ {x:0},{y:0}");
            else if (kind == "cloud-small") Log.Info($"{_screen.DeviceName}: 点中云，但已小于分裂阈值 @ {x:0},{y:0}");
        }
        catch { }
    }

    public async Task SetPausedAsync(bool paused)
    {
        var wv = WebView;
        if (wv == null) return;
        try
        {
            await wv.ExecuteScriptAsync(paused
                ? "window.meadow && window.meadow.pause()"
                : "window.meadow && window.meadow.resume()");
        }
        catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        RawWindow.SizeChanged -= OnSizeChanged;
        try { _controller?.Close(); } catch { }
        _controller = null;
        RawWindow.Destroy(_hwnd);
        _hwnd = IntPtr.Zero;
    }
}

/// <summary>WebView2 运行环境（所有显示器共用一个）。</summary>
internal static class WebViewRuntime
{
    private static CoreWebView2Environment? _env;

    public static string? AvailableVersion()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch { return null; }
    }

    public static string CurrentArgs = AppConfig.DefaultBrowserArgs;

    public static async Task<CoreWebView2Environment> GetAsync()
    {
        if (_env != null) return _env;

        var args = CurrentArgs;

        var options = new CoreWebView2EnvironmentOptions(args);
        Log.Info("WebView2 附加参数: " + args);
        var dataDir = Path.Combine(Log.Dir, "WebView2");
        Directory.CreateDirectory(dataDir);

        _env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
        return _env;
    }
}
