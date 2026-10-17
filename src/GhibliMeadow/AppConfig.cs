using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GhibliMeadow;

/// <summary>用户配置，存放于 exe 同目录的 config.json。</summary>
internal sealed class AppConfig
{
    /// <summary>
    /// 程序显示名。消息框标题、托盘菜单标题与工具提示、日志抬头全部引用这一处 ——
    /// 之前这句话散落在 7 个地方，主题从"花卉草原"改成"天空与草原"后只改了一部分，
    /// 托盘工具提示仍在报旧名。**凡是同一句话出现两次以上，就要收敛成常量。**
    /// </summary>
    public const string AppName = "天空与草原 · 动态壁纸";

    /// <summary>短名，用于托盘工具提示前缀（<see cref="NotifyIcon.Text"/> 上限 63 字符）。</summary>
    public const string AppShortName = "天空与草原";

    /// <summary>目标帧率。30 足够顺滑且省电，60 更跟手但 4K 下对显卡有要求。</summary>
    public int Fps { get; set; } = 30;

    /// <summary>花与草的数量倍率（0.2 ~ 2.2）。</summary>
    public double Density { get; set; } = 1.0;

    /// <summary>风力强度倍率。</summary>
    public double Wind { get; set; } = 1.0;

    /// <summary>
    /// 上下光比强度（0 ~ 1.6）。动漫风**不做雾气、不做暗角**，这一项只控制极轻的
    /// 顶光与底部压暗；调 0 则画面完全平光。
    /// </summary>
    public double Veil { get; set; } = 1.0;

    /// <summary>相机漂移速度（像素/秒）。0 = 完全静止，适合图标对齐要求高的场景。</summary>
    public double Drift { get; set; } = 0.0;

    /// <summary>每世界单位对应的画布像素数。0 = 自动（按画布像素预算决定，不超采样）。</summary>
    public double RenderScale { get; set; } = 0.0;

    /// <summary>随机种子。改动它会得到完全不同的另一片草原。</summary>
    public int Seed { get; set; } = 20260923;

    /// <summary>
    /// 图标区柔和压暗强度（易读性）。桌面图标文字是白色带投影，压在浅蓝天空上的
    /// 对比度只有约 1.5:1，完全读不清。这一层把左列与上部的亮度压下来：
    /// 0 = 关闭，0.28 约 2.3:1，0.46（默认）约 3.3:1，0.60 约 4.0:1。
    /// </summary>
    public double IconScrim { get; set; } = 0.46;

    /// <summary>
    /// 地平线在屏幕上的高度比例。**值越大，地平线越低，天空越多、草地越少**；
    /// 值越小则草地越多。默认 0.55。
    /// </summary>
    public double Horizon { get; set; } = 0.55;

    // ---- 云 ----
    // 下面三项的默认值与夹取范围必须与页面侧 meadow.js 的 CFG 一致
    // （见 CFG.cloudLife / cloudDensity / cloudSpeed 的 qnum+clamp）。
    // 页面会对 URL 参数再夹一次，但这里也要夹，免得 config.json 里存下越界值。

    /// <summary>一朵云从生成到消散的总时长（秒），区间 20 ~ 400。</summary>
    public double CloudLife { get; set; } = 88;

    /// <summary>
    /// 云量倍率，区间 0 ~ 3。**注意下限**：页面生成量是
    /// <c>clamp(屏宽/240 × 1.2 × 本值, 2, 24)</c>，所以取 0 也仍有 2 朵云。
    /// 想要"天上没有云"，得改页面那个下限，不是把这个值调到 0。
    /// </summary>
    public double CloudDensity { get; set; } = 1.0;

    /// <summary>云速倍率，区间 0 ~ 4。不影响生命周期时长，只改飘动快慢。</summary>
    public double CloudSpeed { get; set; } = 1.0;

    /// <summary>天空中的客机与云迹。</summary>
    public bool Planes { get; set; } = true;

    /// <summary>客机平均出现间隔（秒），实际间隔在其 0.43~1.57 倍之间随机。</summary>
    public double PlaneInterval { get; set; } = 70;

    // ---- 牛羊 ----

    /// <summary>是否显示远景的牛羊。</summary>
    public bool Animals { get; set; } = true;

    /// <summary>牛羊群数倍率，区间 0 ~ 2.5。0 = 不出现（与 Animals=false 等效）。</summary>
    public double AnimalDensity { get; set; } = 1.0;

    /// <summary>
    /// 点击彩蛋总开关：点客机洒彩纸、点牛羊掀翻倒地、点白云分裂成两朵。
    /// </summary>
    public bool EasterEgg { get; set; } = true;

    /// <summary>检测到全屏程序（游戏 / 播放器）时暂停渲染，省电且避免干扰。</summary>
    public bool PauseOnFullscreen { get; set; } = true;

    /// <summary>使用电池时降帧。</summary>
    public bool PauseOnBattery { get; set; } = false;

    /// <summary>使用电池时采用的帧率。</summary>
    public int BatteryFps { get; set; } = 15;

    /// <summary>只在指定的显示器上显示（显示器设备名，例如 "\\.\DISPLAY1"）。留空 = 所有显示器。</summary>
    public string[] Monitors { get; set; } = Array.Empty<string>();

    /// <summary>画布总像素上限，用于在 4K 上限制填充率开销。</summary>
    public long PixelBudget { get; set; } = 4700000;

    /// <summary>开启 WebView2 开发者工具（调试用）。</summary>
    public bool Debug { get; set; } = false;

    /// <summary>
    /// 额外传给 WebView2 的命令行开关。默认值关闭了 Chromium 的窗口遮挡检测 ——
    /// 壁纸窗口位于桌面图标层之下，会被误判为"完全被遮挡"而挂起画面合成。
    /// 若画面出现静止，可在此增删参数排查，不必重新编译。
    /// </summary>
    public string BrowserArgs { get; set; } = DefaultBrowserArgs;

    public const string DefaultBrowserArgs =
        // 关闭窗口遮挡检测：壁纸窗口位于桌面图标层之下，会被误判为"完全被遮挡"而挂起画面合成
        "--disable-features=CalculateNativeWinOcclusion,WinOcclusionTracking,msWebOOUI,msPdfOOUI " +
        // 同理，避免后台节流导致动画卡顿
        "--disable-backgrounding-occluded-windows " +
        "--disable-renderer-backgrounding " +
        "--disable-background-timer-throttling " +
        // 只为渲染一张画布，关掉无关能力
        "--disable-component-update --no-first-run --no-default-browser-check " +
        "--disable-sync --disable-breakpad --disable-domain-reliability " +
        "--autoplay-policy=no-user-gesture-required " +
        "--enable-gpu-rasterization " +
        "--ignore-gpu-blocklist";

    /// <summary>启动自检：挂载后把画面切成纯色，用于确认合成是否在更新。</summary>
    public bool SelfTest { get; set; } = false;

    // --------------------------------------------------------------- 持久化

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static AppConfig Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var cfg = JsonSerializer.Deserialize<AppConfig>(json, Options);
                if (cfg != null)
                {
                    cfg.Normalize();
                    Log.Info("已载入配置: " + path);
                    return cfg;
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error("读取配置失败，改用默认值: " + ex.Message);
        }

        var def = new AppConfig();
        def.Normalize();
        try { def.Save(path); Log.Info("已生成默认配置: " + path); }
        catch (Exception ex) { Log.Error("写入默认配置失败: " + ex.Message); }
        return def;
    }

    public void Save(string path)
    {
        var json = JsonSerializer.Serialize(this, Options);
        File.WriteAllText(path, json);
    }

    public void Normalize()
    {
        Fps = Math.Clamp(Fps, 5, 240);
        Density = Math.Clamp(Density, 0.2, 2.2);
        Wind = Math.Clamp(Wind, 0, 3);
        Veil = Math.Clamp(Veil, 0, 1.6);
        Drift = Math.Clamp(Drift, 0, 60);
        if (RenderScale < 0) RenderScale = 0;
        BatteryFps = Math.Clamp(BatteryFps, 3, 120);
        IconScrim = Math.Clamp(IconScrim, 0.0, 0.70);
        Horizon = Math.Clamp(Horizon, 0.30, 0.75);
        PlaneInterval = Math.Clamp(PlaneInterval, 2, 600);
        /* 以下四项的区间必须与页面侧 meadow.js 的 CFG 完全一致：
         * cloudLife [20,400] / cloudDensity [0,3] / cloudSpeed [0,4] / animalDensity [0,2.5] */
        CloudLife = Math.Clamp(CloudLife, 20, 400);
        CloudDensity = Math.Clamp(CloudDensity, 0, 3);
        CloudSpeed = Math.Clamp(CloudSpeed, 0, 4);
        AnimalDensity = Math.Clamp(AnimalDensity, 0, 2.5);
        PixelBudget = Math.Clamp(PixelBudget, 500_000, 20_000_000);
        Monitors ??= Array.Empty<string>();
    }

    public AppConfig Clone() => (AppConfig)MemberwiseClone();
}
