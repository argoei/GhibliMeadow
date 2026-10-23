# 天空与草原 · 动漫风动态桌面壁纸

一片会呼吸的吉卜力风格草原，安静地铺在你的 Windows 桌面上。

蓝天积云缓缓左移，野花沿一道看不见的波前依次张开又合上，远处的牛羊在吃草和踱步之间切换，偶尔有客机拖着云迹划过。

![预览](docs/images/preview.png)

---

## 安装

程序拆成**主程序包**和**依赖包**两个文件发布。

| 包 | 文件名 | 体积 | 内容 |
| --- | --- | --- | --- |
| 主程序 | `GhibliMeadow-Setup-1.1.0.exe` | **2.7 MB** | 壁纸本体 |
| 依赖包 | `GhibliMeadow-Deps-8.0.32-win-x64.zip` | **58 MB** | .NET 8 Desktop Runtime + WebView2 Bootstrapper |

**首次安装**：

1. 从 [Releases](../../releases/latest) 把两个文件都下载下来
2. 解压依赖包，把里面的两个安装器**与主程序放到同一目录**
3. 双击 `GhibliMeadow-Setup-1.1.0.exe`

安装器会先检测依赖：缺失时提示并自动调用同目录的安装器，装完继续装主程序；已装则直接跳过。

**机器上已有 .NET 8 Desktop Runtime**（装过 Visual Studio 或其它 .NET 8 应用）时，只需下载 2.4 MB 的主程序。

装完会自动启动。程序没有主窗口，请在**系统托盘**找那个花形图标。

**便携版**：下载 `GhibliMeadow-v1.1.0-win-x64.zip`，解压到任意目录，双击 `启动壁纸.cmd`（同样需要 .NET 8 运行时）。

---

## 它做了什么

| | |
| --- | --- |
| **真·桌面层** | 挂到 explorer 的 `WorkerW` 之下，画面在桌面图标**后面**，不是盖在桌面上的窗口 |
| **多显示器** | 每块屏幕独立窗口 + 独立 WebView2 实例，按物理像素对齐；插拔、改缩放比会自动重建 |
| **水平无缝** | 草坡周期整除瓦片宽度，横向无限平铺，看不出接缝 |
| **开花波** | 每朵花按自身世界坐标落在同一个横扫的相位上，像一道光带掠过草地，而不是各自随机开合 |
| **活的云** | 云有「生成 → 生长 → 维持 → 消散」的独立生命周期；越靠地平线越淡、越小 |
| **牛羊状态机** | 吃草 14~34 秒 ↔ 走动 8~18 秒；个体按名次带速度差，群内间距会慢慢拉开 |
| **三个彩蛋** | 点飞机洒彩纸、点牛羊翻倒、点云分裂成两朵 |
| **低空双翼机** | 红色双翼螺旋桨飞机贴着地平线低空掠过，随机出现、至多一架；点中它触发飞行员跳伞（出舱 → 开伞 → 飘落 → 落地收伞站起 → 渐隐），飞机无人驾驶继续飞走 |
| **图标可读性** | 白云进图标区渐隐 + 左列/顶部柔和压暗，白色图标文字的对比度从 1.5:1 提到 3.3:1 |
| **不打扰** | 检测到全屏程序自动暂停；电池供电自动降帧 |

![云分裂](docs/images/cloud-split.png)

![低空双翼机与飞行员跳伞](docs/images/biplane.png)

---

## 使用

启动后右键托盘图标：

| 菜单项 | 说明 |
| --- | --- |
| 暂停动态效果 | 也可以双击托盘图标切换 |
| 花朵密度 | 稀疏 / 正常 / 繁茂 |
| 帧率 | 24 / 30 / 60 |
| 图标文字对比度 | 关闭 / 弱 / 标准 / 强 |
| 地平线高低 | 天空多一些 / 均衡 / 草地多一些 |
| 天空中的客机 | 显示 / 不显示 |
| 低空双翼机 | 显示 / 不显示（点它触发跳伞彩蛋） |
| 彩蛋 | 开启 / 关闭 |
| 重新加载配置 | 改完 `config.json` 后即时生效 |
| 换一片草原 | 换一个随机种子 |
| 打开配置文件夹 / 打开日志 | — |
| 开机自动启动 | 写当前用户的 `Run` 键，不需要管理员 |
| 退出 | — |

**停止壁纸**：托盘菜单 → 退出，或双击程序目录里的 `停止壁纸.cmd`。

配置文件是程序目录下的 `config.json`，首次运行自动生成。全部字段说明见 [技术文档](TECHNICAL.md)。

---

## 系统要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10 1809（17763）及以上 / Windows 11 |
| 架构 | x64 |
| .NET 运行时 | **必需**：.NET 8 Desktop Runtime 8.0.0+（依赖包提供 8.0.32） |
| 渲染引擎 | Microsoft Edge WebView2 Runtime（Windows 11 预装；Windows 10 缺失时由依赖包安装） |
| 磁盘 | 约 2 MB（主程序）+ 约 130 MB（运行时） |

### 依赖清单与版本对应

| 依赖 | 必需性 | 最低版本 | 随包分发 | 检测方式 |
| --- | --- | --- | --- | --- |
| `Microsoft.WindowsDesktop.App` | 必需 | 8.0.0 | **8.0.32** | `%ProgramFiles%\dotnet\shared\Microsoft.WindowsDesktop.App\8.*` |
| `Microsoft.Web.WebView2`（NuGet） | 必需 | 1.0.2903.40 | 随主程序 | 编译期打包 |
| Microsoft Edge WebView2 Runtime | 必需 | Evergreen 最新 | Bootstrapper 1.78 MB | 注册表 `EdgeUpdate\Clients\{F3017226-…}` |

**版本对应关系**：

| 主程序版本 | 目标框架 | 需要的运行时 | 已验证的运行时 |
| --- | --- | --- | --- |
| 1.1.0 | `net8.0-windows` | .NET 8 Desktop Runtime ≥ 8.0.0 | 8.0.31（开发机）、8.0.32（随包） |
| 1.0.1 | `net8.0-windows` | .NET 8 Desktop Runtime ≥ 8.0.0 | 8.0.31（开发机）、8.0.32（随包） |

规则说明：

- **只认 8.0.x。** 目标框架是 `net8.0-windows`，装 .NET 6/7 或 9 都不满足；8.0.x 的后续补丁可直接运行，不需要重新编译。
- **Desktop Runtime 已内含 `Microsoft.NETCore.App`**，不需要再单独装 .NET Runtime。
- 依赖包里的 8.0.32 是 2026-10-13 的安全更新版本；目标机若已有更高的 8.0.x，安装器检测通过，不会降级覆盖。
- 体积主要在 runtime 安装器（56 MB）；WebView2 走 Evergreen Bootstrapper，安装时按需拉取最新版。

---

## 从源码构建

需要 .NET 8 SDK。

```bash
build.cmd      # 框架依赖发布到 dist/（开发用，约 11 秒）
package.cmd    # 再打成便携 zip
```

生成主程序安装包（需要 Inno Setup 6）：

```bash
dotnet publish src/GhibliMeadow -c Release -r win-x64 --self-contained false -o release/app
cp assets/*.cmd assets/*.ps1 release/app/
ISCC.exe installer/GhibliMeadow.iss
```

依赖分发包用 `package-deps.cmd` 生成。产物都在 `release/`。

> 想改回自包含单包（不依赖运行时、约 48 MB）：把 `--self-contained false` 改成 `true`、输出目录换成 `release/selfcontained`，并同步改 `.iss` 里 `[Files]` 的 `Source`。

---

## 项目结构

```
GhibliMeadow/
├─ src/GhibliMeadow/       C# 宿主：桌面层挂载、多显示器、托盘、看门狗
│  └─ web/                 渲染器（纯 Canvas 2D，无构建步骤）
├─ assets/                 启动与自启脚本模板
├─ deps/                   依赖安装器（不进版本库，从官方地址下载）
├─ installer/              Inno Setup 安装脚本
├─ docs/images/            文档配图
├─ tools/                  回归与量测脚本（截图、性能、交互时序）
├─ build.cmd               重新构建
├─ package.cmd             打成便携 zip
├─ package-deps.cmd        打成依赖分发包
└─ TECHNICAL.md            完整技术文档：实现细节、全部参数、验收流程
```

---

## 常见问题

**桌面是黑的，没有画面**
先看 `%LOCALAPPDATA%\GhibliMeadow\wallpaper.log` 里有没有「已挂到桌面层」。没有的话通常是 explorer 未就绪，程序每 3 秒会自动重试。

**截图工具截不到壁纸**
正常现象。这层内容由 GPU 合成，GDI 截图（多数截图软件的 `BitBlt` 路径）抓不到，需要用桌面复制 API 的录屏工具。

**换分辨率或插拔显示器后错位**
程序每 3 秒比对一次显示器布局并自动重建；也可以点托盘菜单的「重新加载配置」。

**怎么彻底恢复原来的背景**
退出程序即可。桌面层是独立子窗口，销毁后系统壁纸自动恢复。

更多排查项见 [技术文档](TECHNICAL.md)。

---

## 已知限制

- **崩溃后不会自动拉起。** 原方案依赖计划任务的「失败重启」，但指向未签名程序的计划任务会被系统策略拦截（[排查记录](任务计划拦截-排查记录.md)）。后续计划用 `RegisterApplicationRestart` 补上。
- **主要在单机验证。** 多显示器、混合 DPI、Win10/Win11 的兼容性结论来自开发机实测，其他环境建议先看日志再反馈。

---

## 许可证

[MIT](LICENSE)
