GhibliMeadow 依赖分发包
========================

版本：8.0.32
适用主程序：GhibliMeadow 1.0.0（目标框架 net8.0-windows）
架构：x64
适用系统：Windows 10 1809+ / Windows 11

内容
----
1. windowsdesktop-runtime-8.0.32-win-x64.exe
   .NET 8 Desktop Runtime（必需），56 MB。
   来源：https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.32/windowsdesktop-runtime-8.0.32-win-x64.exe
   签名：CN=.NET, O=Microsoft Corporation

2. MicrosoftEdgeWebview2Setup.exe
   Microsoft Edge WebView2 Runtime 的 Evergreen Bootstrapper（必需），1.8 MB。
   来源：https://go.microsoft.com/fwlink/p/?LinkId=2124703
   签名：CN=Microsoft Corporation

3. install-deps.cmd
   一键静默安装上面两个。双击即可，纯 ASCII 批处理。

怎么用
------
方式 A（推荐）
  把本目录里的两个 .exe 复制到主程序安装包所在目录，双击主程序安装包。
  安装器会检测依赖，缺失时自动调用同目录的安装器。

方式 B
  先双击本目录的 install-deps.cmd 装好依赖，再双击主程序安装包。

方式 C（手动）
  windowsdesktop-runtime-8.0.32-win-x64.exe /install /quiet /norestart
  MicrosoftEdgeWebview2Setup.exe /silent /install

版本对应
--------
- 主程序目标框架是 net8.0-windows，必须 .NET 8；装 .NET 6/7/9 都不满足。
- 8.0.x 的任意补丁都能运行，不需要重新编译主程序。
- 本包为 8.0.32（2026-10-13 安全更新）。
- Desktop Runtime 已内含 Microsoft.NETCore.App，不需要再单独装 .NET Runtime。
- 目标机若已有更高的 8.0.x（如 8.0.40），安装器检测通过，不会降级覆盖。

卸载依赖
--------
本依赖包本身只是个安装器集合，不需要卸载。
已安装的运行时可在「设置 → 应用」里卸载，或执行：
  windowsdesktop-runtime-8.0.32-win-x64.exe /uninstall /quiet

注意：卸载 .NET 8 Desktop Runtime 会影响这台机器上其它依赖 .NET 8 的应用，
      请确认后再操作。
