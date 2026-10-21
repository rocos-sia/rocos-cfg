# 本地产物验证记录

本记录对应内部测试版本 **0.1.0-rc.6**，不是正式发布或完整首版验收。产物位于本机 `artifacts/`，不随 Git 提交；后续源码修改不会自动更新这些包或本记录。

## 构建环境与产物

验证日期：2026-10-22。构建环境为 Ubuntu 22.04.5 LTS、x86_64、Node.js 24.22.0、Rust 1.99.1。桌面构建使用 `tauri build --bundles deb` 的 release 配置，前端使用相对路径 `--base ./`；Linux 开发库来自本地 sysroot。无系统安装操作。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.6-amd64.deb` | `79da271a33734bc413ea7f6d81a7e6c276167f2011e76c8ba406ca5154108cbf` |
| `artifacts/rocos-configurator-offline.zip` | `249375a2e2b7d3970bfe78af4bb8643c0275e71296e5103bf9e15dfa5e7bf6ea` |

deb 声明依赖 `libwebkit2gtk-4.1-0`、`libgtk-3-0`。本次验证从 deb 解出的程序，不是系统安装测试，也不证明单个 deb 包含目标电脑缺少的全部系统依赖。

## 已执行的验证

- 前端单元测试：159 项通过。149 项外部 C++ 消费端测试本轮未设置源码路径而明确跳过；其此前执行记录不能替代修改对应契约后的复验。
- Rust 原生文件和目录服务：14 项通过，覆盖真实临时文件上的备份、外部修改拒绝覆盖、取消、分块与哈希校验、能力授权、目录导出和消息序列化。
- 真实桌面程序：在隔离 Xvfb/Openbox 显示中使用 WebKitWebDriver、tauri-driver 和 GTK 文件对话框执行 `scripts/verify-desktop.mjs`，核对界面及归档版本。流程包含首次保存、覆盖备份、中英文冲突原因及磁盘差异、另存为、目录导入、副本/新工程身份、浏览器往返、后台模型解析、取消未保存关闭、损坏恢复与原包保护，以及运行目录清单、文件哈希、ZIP 逐字节一致性和原保存目标保留。
- 静态离线 ZIP：实际解压到无 `node_modules` 的临时目录，启动包内服务，拒绝外部网络请求后验证冷启动、通信周期修改持久化、归档版本和每项文件长度/SHA-256。

桌面测试日志及截图位于 `test-results/desktop/`；最终完整复跑成功，并输出 `report.json`，记录实际程序路径、SHA-256、版本、检查范围和未执行项。解包程序 SHA-256 为 `3f6714e052c9b58119447e32d1aefae2dcc7165b2908a1b74bf85727b9929f77`。首次尝试因本地 sysroot 的 Openbox 主题搜索路径缺失而退出；补齐 `XDG_DATA_DIRS` 与 `XDG_CONFIG_DIRS` 后，同一 deb 的测试通过。补充验证报告时，两次复跑在通知消失后的 WebKitWebDriver 截图请求超时，DOM 和文件保护断言已通过；该截图改用 ImageMagick `import` 捕获真实 X11 应用窗口，功能断言保留。以上调整均未修改安装包或应用行为。

## 尚未取得的证据

未验证 Windows 构建/断网安装、独立离线电脑、实际 Safari、GitHub Pages 远端发布、磁盘满或断电恢复，以及 SDK 和实机。原始共享结构的无硬件验证范围另见 [ABI.md](ABI.md)。现有结果不代表以上事项完成，也不代表配置可安全驱动真实机器人。总体要求与缺口以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
