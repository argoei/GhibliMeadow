using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Win32;

namespace GhibliMeadow;

/// <summary>
/// 应用主控。没有可见的主窗口，一切通过托盘菜单操作。
/// 负责：装配各显示器的壁纸面、桌面层看门狗、全屏/电池暂停、托盘菜单与配置热加载。
/// </summary>
internal sealed class WallpaperApp : ApplicationContext
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "GhibliMeadowWallpaper";

    private readonly string _exeDir;
    private readonly string _webDir;
    private readonly string _configPath;

    private AppConfig _cfg;
    private readonly List<WallpaperSurface> _surfaces = new();
    private IntPtr _host = IntPtr.Zero;

    private NotifyIcon? _tray;
    private System.Windows.Forms.Timer? _watchdog;
    private System.Windows.Forms.Timer? _stateTimer;
    private System.Windows.Forms.Timer? _mouseTimer;
    private bool _mouseWasDown;
    private DateTime _lastStatsLog = DateTime.UtcNow;

    /// <summary>所有显示器实例共享的启动时刻，用于对齐开花相位。</summary>
    private readonly double _t0 = (DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds;

    private bool _building;
    private bool _rebuildAgain;
    private bool _pausedByUser;

    /// <summary>无人值守启动（--quiet，来自自启/计划任务）。此模式下**一律不弹模态框**。</summary>
    private readonly bool _quiet;

    /// <summary>正在关停：Dispose 时置位，重建流程在每个 await 之后检查并放弃，
    /// 避免"退出的一瞬间还在建 WebView2"把窗口和进程漏在外面。</summary>
    private bool _shuttingDown;

    /// <summary>连击守卫是否已上报过"稳定运行"。</summary>
    private bool _guardMarked;
    private bool _pausedApplied;
    private string _layoutSignature = "";

    private ToolStripMenuItem? _statusItem;
    private ToolStripMenuItem? _pauseItem;
    private ToolStripMenuItem? _autoStartItem;

    public WallpaperApp(bool quiet)
    {
        _quiet = quiet;
        _exeDir = AppContext.BaseDirectory;
        _webDir = Path.Combine(_exeDir, "web");
        _configPath = Path.Combine(_exeDir, "config.json");
        _cfg = new AppConfig();
    }

    /* ================================================================== 启动 */

    /// <summary>
    /// 启动入口。**只负责兜底**：真正的初始化在 <see cref="StartCore"/> 里。
    ///
    /// 为什么要兜这一层：Start 是在 `Application.Idle` 里被调用的，**异常会逃进消息循环**。
    /// 而托盘与三个定时器是在 Start 的后半段才创建的（见 StartCore）—— 若在托盘图标创建
    /// （GDI+ 可能因资源耗尽抛 `ExternalException`）或 `Rebuild` 之间抛异常，异常被
    /// `Application.ThreadException` 记下来之后，**进程会带着"没有托盘、没有定时器、
    /// 却占着单实例互斥量"的状态继续活着**：用户既看不到壁纸，也没有任何界面可以退出它，
    /// 再启动还会被告知"程序已经在运行了"，只能去任务管理器杀。
    /// 配上开机自启更糟 —— 每次登录都留下一个这样的僵尸。
    ///
    /// 所以启动阶段任何异常都必须**让进程退干净**。退出码保持 0，避免被计划任务当成
    /// 崩溃而反复拉起（反复拉一个必然失败的进程没有意义）。
    /// </summary>
    public void Start()
    {
        try
        {
            StartCore();
        }
        catch (Exception ex)
        {
            Log.Fatal(ex);
            Log.Error("启动阶段异常，进程将退出（退出码 0，避免自启反复拉起）");
            try { if (_tray != null) _tray.Visible = false; } catch { }
            ExitThread();
        }
    }

    private void StartCore()
    {
        Log.Info($"=== {AppConfig.AppName} 启动 ===");
        Log.Info("程序目录: " + _exeDir);

        var version = WebViewRuntime.AvailableVersion();
        if (version == null)
        {
            Log.Error("未检测到 WebView2 运行时");
            /* 无人值守时不弹框：否则配了开机自启的机器每次登录都会弹一个
             * 没人点、却挡住后续启动的模态框（任务还视其为成功、不会重试）。 */
            if (!_quiet)
            {
                MessageBox.Show(
                    "未检测到 Microsoft Edge WebView2 运行时，无法渲染壁纸。\n\n" +
                    "Windows 11 通常已预装；若缺失，请到微软官网下载\n" +
                    "「Evergreen Standalone Installer」安装后重试。",
                    AppConfig.AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            ExitThread();
            return;
        }
        Log.Info("WebView2 运行时: " + version);

        if (!Directory.Exists(_webDir))
        {
            Log.Error("缺少 web 资源目录: " + _webDir);
            if (!_quiet)
            {
                MessageBox.Show("缺少 web 资源目录：" + _webDir, AppConfig.AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            ExitThread();
            return;
        }

        _cfg = AppConfig.Load(_configPath);

        RawWindow.EnsureRegistered();
        RawWindow.DisplayEnvironmentChanged += OnDisplayEnvironmentChanged;

        AssertDensityPresets();
        BuildTray();
        RefreshChoiceChecks();
        Rebuild();

        _watchdog = new System.Windows.Forms.Timer { Interval = 3000 };
        _watchdog.Tick += (_, _) => WatchdogTick();
        _watchdog.Start();

        _stateTimer = new System.Windows.Forms.Timer { Interval = 1600 };
        _stateTimer.Tick += (_, _) => StateTick();
        _stateTimer.Start();

        /* 彩蛋取点击：轮询全局左键状态。20ms 一次，人手最短的点击也有 60ms 以上，
         * 不会漏；而且只读不吞，桌面原有的点击行为不受任何影响。 */
        _mouseTimer = new System.Windows.Forms.Timer { Interval = 20 };
        _mouseTimer.Tick += (_, _) => MouseTick();
        _mouseTimer.Start();
    }

    /* ============================================================ 托盘菜单 */

    private void BuildTray()
    {
        var menu = new ContextMenuStrip { ShowImageMargin = false };

        _statusItem = new ToolStripMenuItem("正在启动…") { Enabled = false };
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());

        _pauseItem = new ToolStripMenuItem("暂停动态效果", null, (_, _) => TogglePause())
        {
            CheckOnClick = false,
            Checked = false,
        };
        menu.Items.Add(_pauseItem);

        var density = new ToolStripMenuItem("花朵密度");
        foreach (var (label, value) in DensityPresets)
        {
            double v = value;
            AddChoice(density, label, () => SetDensity(v), () => IsDensity(v));
        }
        menu.Items.Add(density);

        var fps = new ToolStripMenuItem("帧率");
        AddChoice(fps, "24 帧（最省电）", () => SetFps(24), () => _cfg.Fps == 24);
        AddChoice(fps, "30 帧（推荐）", () => SetFps(30), () => _cfg.Fps == 30);
        AddChoice(fps, "60 帧（最顺滑）", () => SetFps(60), () => _cfg.Fps == 60);
        menu.Items.Add(fps);

        var scrim = new ToolStripMenuItem("图标文字对比度");
        AddChoice(scrim, "关闭（画面最亮）", () => SetScrim(0.0), () => _cfg.IconScrim < 0.02);
        AddChoice(scrim, "弱", () => SetScrim(0.28), () => Math.Abs(_cfg.IconScrim - 0.28) < 0.01);
        AddChoice(scrim, "标准（推荐）", () => SetScrim(0.46), () => Math.Abs(_cfg.IconScrim - 0.46) < 0.01);
        AddChoice(scrim, "强", () => SetScrim(0.60), () => Math.Abs(_cfg.IconScrim - 0.60) < 0.01);
        menu.Items.Add(scrim);

        /* horizon 是地平线的屏幕高度比例：值越大 → 地平线越低 → 天空越多。
         * 这里三个档位都按下表取值，别再把方向搞反。 */
        var horizon = new ToolStripMenuItem("地平线高低");
        AddChoice(horizon, "天空多一些", () => SetHorizon(0.68), () => _cfg.Horizon > 0.62);
        AddChoice(horizon, "均衡（推荐）", () => SetHorizon(0.55), () => Math.Abs(_cfg.Horizon - 0.55) < 0.02);
        AddChoice(horizon, "草地多一些", () => SetHorizon(0.42), () => _cfg.Horizon < 0.50);
        menu.Items.Add(horizon);

        var planes = new ToolStripMenuItem("天空中的客机");
        AddChoice(planes, "不显示", () => SetPlanes(false), () => !_cfg.Planes);
        AddChoice(planes, "显示（推荐）", () => SetPlanes(true), () => _cfg.Planes);
        menu.Items.Add(planes);

        var biplane = new ToolStripMenuItem("低空双翼机（点它触发跳伞）");
        AddChoice(biplane, "不显示", () => SetBiplane(false), () => !_cfg.Biplane);
        AddChoice(biplane, "显示（推荐）", () => SetBiplane(true), () => _cfg.Biplane);
        menu.Items.Add(biplane);

        /* 三个点击彩蛋共用同一个开关 */
        var egg = new ToolStripMenuItem("彩蛋（点飞机洒彩纸 / 点牛羊翻倒 / 点云分裂）");
        AddChoice(egg, "开启", () => SetEasterEgg(true), () => _cfg.EasterEgg);
        AddChoice(egg, "关闭", () => SetEasterEgg(false), () => !_cfg.EasterEgg);
        menu.Items.Add(egg);

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("重新加载配置", null, (_, _) => ReloadConfig()));
        menu.Items.Add(new ToolStripMenuItem("换一片草原（重新播种）", null, (_, _) => Reseed()));
        menu.Items.Add(new ToolStripMenuItem("打开配置文件夹", null, (_, _) => OpenFolder()));
        menu.Items.Add(new ToolStripMenuItem("打开日志", null, (_, _) => OpenLog()));

        _autoStartItem = new ToolStripMenuItem("开机自动启动", null, (_, _) => ToggleAutoStart())
        {
            Checked = IsAutoStartEnabled(),
        };
        menu.Items.Add(_autoStartItem);

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("退出", null, (_, _) => Shutdown()));

        _tray = new NotifyIcon
        {
            Icon = TrayIconFactory.Create(),
            Text = AppConfig.AppName,
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => TogglePause();
    }

    /// <summary>菜单项的勾选判定器，点任意一项后统一刷新 —— 否则勾永远停在初始状态。</summary>
    private readonly List<(ToolStripMenuItem Item, Func<bool> Test)> _choices = new();

    private void AddChoice(ToolStripMenuItem parent, string text, Action onClick, Func<bool> isChecked)
    {
        var item = new ToolStripMenuItem(text, null, (_, _) =>
        {
            onClick();
            RefreshChoiceChecks();
        });
        item.Checked = isChecked();
        _choices.Add((item, isChecked));
        parent.DropDownItems.Add(item);
    }

    /// <summary>按各选项的判定条件重新打勾。</summary>
    private void RefreshChoiceChecks()
    {
        foreach (var (item, test) in _choices)
        {
            try { item.Checked = test(); } catch { }
        }
    }

    private void SetStatus(string text)
    {
        if (_statusItem != null) _statusItem.Text = text;
        if (_tray != null)
        {
            var t = AppConfig.AppShortName + " · " + text;
            if (t.Length > 63) t = t.Substring(0, 63);
            _tray.Text = t;
        }
    }

    /* ========================================================== 装配壁纸面 */

    private IEnumerable<Screen> TargetScreens()
    {
        var all = Screen.AllScreens;
        if (_cfg.Monitors == null || _cfg.Monitors.Length == 0) return all;
        var want = all.Where(s => _cfg.Monitors.Contains(s.DeviceName, StringComparer.OrdinalIgnoreCase)).ToArray();
        return want.Length > 0 ? want : all;
    }

    private string LayoutSignature()
    {
        return string.Join("|", Screen.AllScreens.Select(s =>
            $"{s.DeviceName}:{s.Bounds.X},{s.Bounds.Y},{s.Bounds.Width},{s.Bounds.Height}"));
    }

    private async void Rebuild()
    {
        if (_building) { _rebuildAgain = true; return; }
        _building = true;
        try
        {
            do
            {
                _rebuildAgain = false;
                DisposeSurfaces();

                _host = DesktopHost.Find();
                if (_host == IntPtr.Zero)
                {
                    Log.Warn("找不到桌面层（Progman / WorkerW），稍后重试");
                    SetStatus("等待桌面层");
                    return;
                }

                WebViewRuntime.CurrentArgs = string.IsNullOrWhiteSpace(_cfg.BrowserArgs)
                    ? AppConfig.DefaultBrowserArgs : _cfg.BrowserArgs;
                var env = await WebViewRuntime.GetAsync();
                if (_shuttingDown) return;      // 退出的一瞬间别继续建窗口

                foreach (var screen in TargetScreens())
                {
                    var surface = new WallpaperSurface(screen, _cfg, _webDir, env, _t0);
                    try
                    {
                        await surface.CreateAsync(_host);
                        /* await 期间用户可能已经点了"退出"：此时必须放弃把这面加进去，
                         * 否则刚建好的 WebView2 与窗口没人回收（进程随即退出，属泄漏）。 */
                        if (_shuttingDown) { surface.Dispose(); return; }
                        _surfaces.Add(surface);
                    }
                    catch (Exception ex)
                    {
                        Log.Fatal(ex);
                        surface.Dispose();
                    }
                }

                _layoutSignature = LayoutSignature();
                _pausedApplied = false;

                if (_surfaces.Count > 0)
                {
                    var total = string.Join(" + ", _surfaces.Select(s =>
                        $"{s.Screen.Bounds.Width}×{s.Screen.Bounds.Height}"));
                    SetStatus($"运行中 · {_surfaces.Count} 块屏幕 · {total}");
                    Log.Info($"装配完成：{_surfaces.Count} 块屏幕，宿主 0x{_host.ToInt64():X}");
                }
                else
                {
                    SetStatus("未能创建壁纸面");
                }
            } while (_rebuildAgain);
        }
        catch (Exception ex)
        {
            Log.Fatal(ex);
            SetStatus("初始化失败，详见日志");
        }
        finally
        {
            _building = false;
        }
    }

    private void DisposeSurfaces()
    {
        foreach (var s in _surfaces) s.Dispose();
        _surfaces.Clear();
    }

    /* ============================================================ 定时巡检 */

    private void WatchdogTick()
    {
        if (_building) return;

        // explorer 重启、显示设置变化都会让宿主窗口失效，此时整体重建
        if (_host == IntPtr.Zero || !Native.IsWindow(_host))
        {
            Log.Info("桌面层已失效，重建壁纸面");
            Rebuild();
            return;
        }
        if (_surfaces.Count == 0 ||
            _surfaces.Any(s => !DesktopHost.IsStillAttached(s.Handle, _host)))
        {
            // IsStillAttached 同时验 IsWindow(窗口)、IsWindow(宿主) 与 GetParent(窗口)==宿主，
            // 比只看窗口存活更严：窗口被别的程序抢走父级时也能发现。
            Log.Info("壁纸窗口丢失或已脱离桌面层，重建");
            Rebuild();
            return;
        }
        if (LayoutSignature() != _layoutSignature)
        {
            Log.Info("显示器布局发生变化，重建壁纸面");
            Rebuild();
        }
    }

    private void StateTick()
    {
        if (_building) return;

        bool wantPause = _pausedByUser;
        string reason = _pausedByUser ? "已暂停" : "运行中";

        if (!wantPause && _cfg.PauseOnFullscreen && IsFullscreenAppActive())
        {
            wantPause = true;
            reason = "全屏程序运行中，已暂停";
        }
        if (!wantPause && _cfg.PauseOnBattery && IsOnBattery())
        {
            wantPause = true;
            reason = "电池供电，已降载";
        }

        if (wantPause != _pausedApplied)
        {
            _pausedApplied = wantPause;
            foreach (var s in _surfaces) _ = s.SetPausedAsync(wantPause);
            Log.Info($"渲染状态切换: {(wantPause ? "暂停" : "恢复")}");
        }

        /* 稳定运行满 StartupGuard.HealthyAfterSeconds 秒 → 上报"启动成功"、清零连击计数。
         * 判据刻意取"**已有存活的壁纸面** + 已过 N 秒"，而不是"进程起来了" ——
         * 后者在崩溃循环里每次也都成立，等于没判。 */
        if (!_guardMarked && !_building && _surfaces.Count > 0)
        {
            double upSec = ((DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds - _t0) / 1000.0;
            if (upSec >= StartupGuard.HealthyAfterSeconds)
            {
                _guardMarked = true;
                StartupGuard.MarkHealthy();
            }
        }

        if (!_building && _surfaces.Count > 0)
        {
            int fps = _surfaces.Max(s => s.Fps);
            SetStatus(wantPause ? reason : $"运行中 · {fps} FPS");
            /* 每 15 秒记一行紧凑状态：排查用户反馈时有据可查 */
            if ((DateTime.UtcNow - _lastStatsLog).TotalSeconds >= 5)
            {
                _lastStatsLog = DateTime.UtcNow;
                var s0 = _surfaces[0];
                Log.Info($"状态 fps={fps} 客机@{s0.LastPlaneX:0},{s0.LastPlaneY:0} 彩蛋={(_cfg.EasterEgg ? "开" : "关")}");
            }
        }
    }

    private static bool IsFullscreenAppActive()
    {
        try
        {
            if (Native.SHQueryUserNotificationState(out int state) != 0) return false;
            var q = (Quns)state;
            return q == Quns.RunningD3DFullScreen || q == Quns.PresentationMode || q == Quns.Busy;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsOnBattery()
    {
        try { return SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline; }
        catch { return false; }
    }

    /// <summary>轮询全局左键：检测按下沿，换算成显示器内坐标后转发给页面。</summary>
    private void MouseTick()
    {
        if (_surfaces.Count == 0 || !_cfg.EasterEgg || _building || _shuttingDown)
        {
            _mouseWasDown = false;
            return;
        }
        bool down = (Native.GetAsyncKeyState(Native.VK_LBUTTON) & 0x8000) != 0;
        bool rising = down && !_mouseWasDown;
        _mouseWasDown = down;
        if (!rising) return;
        if (!Native.GetCursorPos(out var pt)) return;

        foreach (var s in _surfaces)
        {
            var b = s.Screen.Bounds;
            if (pt.X < b.Left || pt.X >= b.Right || pt.Y < b.Top || pt.Y >= b.Bottom) continue;
            _ = s.ClickAtAsync(pt.X - b.Left, pt.Y - b.Top);
            break;
        }
    }

    private void OnDisplayEnvironmentChanged()
    {
        Log.Info("收到 DPI / 显示环境变化通知");
        Rebuild();
    }

    /* ============================================================ 菜单动作 */

    private void TogglePause()
    {
        _pausedByUser = !_pausedByUser;
        if (_pauseItem != null) _pauseItem.Checked = _pausedByUser;
        _pausedApplied = !_pausedByUser;   // 强制下一拍下发
        StateTick();
    }

    /// <summary>
    /// 密度档位表 —— 单一数据源。
    /// 注意取值必须落在 AppConfig.Normalize 的允许区间 [0.2, 2.2] 内：
    /// 曾经有过 2.4 的档位，被 Normalize 夹成 2.2 之后判定条件永远为假，
    /// 勾选状态就再也打不上了。现在由 AssertDensityPresets 在启动时兜底校验。
    /// </summary>
    private static readonly (string Label, double Value)[] DensityPresets =
    {
        ("稀疏", 0.6),
        ("正常", 1.0),
        ("繁茂", 1.7),
    };

    /// <summary>把待设值与实际生效值对齐后再比较，避免"设进去被夹住"导致勾打不上。</summary>
    private bool IsDensity(double v) => Math.Abs(_cfg.Density - Math.Clamp(v, 0.2, 2.2)) < 0.005;

    private static void AssertDensityPresets()
    {
        foreach (var (label, value) in DensityPresets)
        {
            if (Math.Abs(value - Math.Clamp(value, 0.2, 2.2)) > 1e-9)
                Log.Warn($"密度档位「{label}」= {value} 超出允许区间 [0.2, 2.2]，勾选状态将无法显示");
        }
    }

    private void SetDensity(double d)
    {
        double before = _cfg.Density;
        _cfg.Density = d;
        _cfg.Normalize();
        if (Math.Abs(_cfg.Density - before) < 0.0005)
        {
            /* 值没变就什么都不做。否则用户每点一次就重建一次窗口 = 闪一次，
             * 而在勾选状态正常之前，用户会反复点。 */
            SetStatus($"花朵密度 {DensityLabel(_cfg.Density)}（约 {EstimateFlowers()} 株）");
            return;
        }
        SaveConfig();
        _ = PushLiveConfig();   // 页面内部重建元素表，不销毁窗口
        SetStatus($"花朵密度 {DensityLabel(_cfg.Density)}（约 {EstimateFlowers()} 株）");
        Log.Info($"花朵密度 → {_cfg.Density:0.##}（约 {EstimateFlowers()} 株）");
    }

    private string DensityLabel(double d)
    {
        foreach (var (label, value) in DensityPresets)
            if (Math.Abs(d - Math.Clamp(value, 0.2, 2.2)) < 0.005) return label;
        return d.ToString("0.##");
    }

    /// <summary>页面按 983 株 / density=1 生成，这里给个量级估算作为即时反馈。</summary>
    private int EstimateFlowers() => (int)Math.Round(983 * _cfg.Density);

    private void SetFps(int fps)
    {
        _cfg.Fps = fps;
        _cfg.Normalize();
        SaveConfig();
        _ = PushLiveConfig();
    }

    private void SetScrim(double v)
    {
        double before = _cfg.IconScrim;
        _cfg.IconScrim = v;
        _cfg.Normalize();
        SetStatus($"图标文字对比度 {_cfg.IconScrim:0.00}");
        if (Math.Abs(_cfg.IconScrim - before) < 0.0005) return;
        SaveConfig();
        _ = PushLiveConfig();
    }

    private void SetHorizon(double v)
    {
        double before = _cfg.Horizon;
        _cfg.Horizon = v;
        _cfg.Normalize();
        /* 文案必须和实际渲染一致：v 越大天空越多 */
        SetStatus($"地平线 {(v > 0.62 ? "天空多一些" : v < 0.50 ? "草地多一些" : "均衡")}" +
                  $"（天空 {_cfg.Horizon * 100:0}% / 草地 {100 - _cfg.Horizon * 100:0}%）");
        if (Math.Abs(_cfg.Horizon - before) < 0.0005) return;
        SaveConfig();
        _ = PushLiveConfig();
    }

    private void SetEasterEgg(bool on)
    {
        SetStatus(on ? "彩蛋已开启：点飞机洒彩纸、点牛羊翻倒、点云分裂" : "彩蛋已关闭");
        if (_cfg.EasterEgg == on) return;
        _cfg.EasterEgg = on;
        SaveConfig();
        _ = PushLiveConfig();
    }

    private void SetPlanes(bool on)
    {
        SetStatus(on ? "已开启天空中的客机" : "已关闭天空中的客机");
        if (_cfg.Planes == on) return;
        _cfg.Planes = on;
        SaveConfig();
        _ = PushLiveConfig();
    }

    private void SetBiplane(bool on)
    {
        SetStatus(on ? "已开启低空双翼机（点它触发跳伞）" : "已关闭低空双翼机");
        if (_cfg.Biplane == on) return;
        _cfg.Biplane = on;
        SaveConfig();
        /* needScene：关闭时把屏上已有的双翼机与跳伞中的飞行员一并清掉 */
        _ = PushLiveConfig();
    }

    private void Reseed()
    {
        _cfg.Seed = Random.Shared.Next(1, int.MaxValue);
        _cfg.Normalize();
        SaveConfig();
        Rebuild();
    }

    private void ReloadConfig()
    {
        _cfg = AppConfig.Load(_configPath);
        RefreshChoiceChecks();
        _ = PushLiveConfig();
        Rebuild();
        SetStatus("配置已重新加载");
    }

    private async System.Threading.Tasks.Task PushLiveConfig()
    {
        int fps = _cfg.PauseOnBattery && IsOnBattery() ? _cfg.BatteryFps : _cfg.Fps;
        foreach (var s in _surfaces)
        {
            try { await s.ApplyConfigAsync(_cfg, fps); } catch { }
        }
    }

    private void SaveConfig()
    {
        try { _cfg.Save(_configPath); }
        catch (Exception ex) { Log.Error("保存配置失败: " + ex.Message); }
    }

    private void OpenFolder()
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + _configPath + "\"") { UseShellExecute = true }); }
        catch (Exception ex) { Log.Error(ex.Message); }
    }

    private void OpenLog()
    {
        try
        {
            if (!File.Exists(Log.FilePath)) File.WriteAllText(Log.FilePath, "");
            Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true });
        }
        catch (Exception ex) { Log.Error(ex.Message); }
    }

    /* ---------------------------------------------------------- 开机自启 */

    private static bool IsAutoStartEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            return key?.GetValue(RunValue) != null;
        }
        catch { return false; }
    }

    private void ToggleAutoStart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
            if (key == null) return;
            if (IsAutoStartEnabled())
            {
                key.DeleteValue(RunValue, false);
                if (_autoStartItem != null) _autoStartItem.Checked = false;
                Log.Info("已取消开机自启");
            }
            else
            {
                /* 带上 --quiet：登录自启时若已有实例（比如计划任务也装了），
                 * 静默退出而不是弹一个"程序已经在运行了"的框。 */
                key.SetValue(RunValue, "\"" + Path.Combine(_exeDir, "GhibliMeadow.exe") + "\" --quiet");
                if (_autoStartItem != null) _autoStartItem.Checked = true;
                Log.Info("已设置开机自启");
            }
        }
        catch (Exception ex)
        {
            Log.Error("设置开机自启失败: " + ex.Message);
        }
    }

    /* ============================================================ 退出清理 */

    private void Shutdown()
    {
        Log.Info("退出");
        /* 顺序与兜底都很关键。原先是「_tray.Visible = false; ExitThread();」——
         * 托盘一旦抛异常（explorer 重启后通知区已被回收时很容易抛 ObjectDisposed /
         * InvalidOperation），ExitThread 就永远执行不到，表现为**点了"退出"没反应**；
         * 配上开机自启还会被任务再拉回来，用户只能去任务管理器杀进程。
         * 所以：先停定时器 → 再收托盘（出错忽略）→ **无论如何都退出**。 */
        try
        {
            _watchdog?.Stop(); _stateTimer?.Stop(); _mouseTimer?.Stop();
            if (_tray != null) _tray.Visible = false;
        }
        catch (Exception ex)
        {
            Log.Warn("退出清理时出错（忽略，继续退出）: " + ex.Message);
        }

        try
        {
            ExitThread();
        }
        catch (Exception ex)
        {
            /* 最后兜底：连消息循环都没能结束的话，直接退出进程。
             * 仍然用退出码 0 —— 这是"用户主动退出"，不是崩溃，不该被计划任务拉起。 */
            Log.Fatal(ex);
            Environment.Exit(0);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            /* 先置位：Rebuild 可能正停在某个 await 上，它随后会看到这个标记并放弃。 */
            _shuttingDown = true;
            _watchdog?.Stop(); _watchdog?.Dispose();
            _stateTimer?.Stop(); _stateTimer?.Dispose();
            _mouseTimer?.Stop(); _mouseTimer?.Dispose();
            RawWindow.DisplayEnvironmentChanged -= OnDisplayEnvironmentChanged;
            DisposeSurfaces();
            _tray?.Dispose();
        }
        base.Dispose(disposing);
    }
}
