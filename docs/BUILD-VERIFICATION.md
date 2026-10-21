# 本地产物验证记录

本记录按版本保留本地验证结果，不代表正式发布或完整首版验收。产物位于本机 `artifacts/`，不随 Git 提交；后续源码修改不会自动更新这些包或本记录。无版本后缀的静态离线 ZIP 及 `test-results/` 会被后续构建/验证替换，应按哈希对应记录。

## 0.1.0-rc.8

2026-10-22，构建环境和方式同 rc.6。本版本补齐资源映射、源码草稿、模块及运行导出错误的消息模板，并让现有通知随语言更新；通知的原计时、原始错误详情和数据保持不变。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.8-amd64.deb` | `afe3213576dfbebf76f1a22ae8b6d0c8bb862515f1d825c06e8744bb88be88a4` |
| `artifacts/rocos-configurator-offline.zip` | `930d2ec9aaf101710af9ee973b59b2896331d866d621e5036b43e0344230e213` |

- TypeScript 检查与 release deb 构建通过。
- 单元测试 165 项通过，149 项外部 C++ 消费端测试因本轮未设置源码路径而跳过；未将跳过项记作通过。本轮 Rust 文件服务实现未改动，未重复其单元测试。
- 通知及确认弹窗交互检查：Chrome 11 项，Playwright Firefox/WebKit 22 项通过。验证通知身份、切换语言前后的原倒计时、源码编辑器保留、失败后草稿/文件字节不变，以及第三方错误和用户文本保真。
- 实际 rc.8 deb 解包程序通过完整 Linux 桌面流程，覆盖已有备份通知中英文切换、覆盖备份、外部修改保护、浏览器往返、损坏恢复、关闭确认及目录/ZIP 字节一致性。`test-results/desktop/report.json` 核对版本与程序 SHA-256 `5ab8bf6dc8c38b3b6181674ae5370bd3c760a7e6e76a0e8dc63af608d6c544d9`。
- 390px 英文错误通知检查：Chrome、Firefox/WebKit 已验证窗口边界，Chrome 截图已查看，完整文本可见。
- 生产构建仓库子路径的 2 项离线缓存测试通过；实际静态 ZIP 的解压冷启动、编辑持久化、归档版本和文件哈希检查通过，测试拒绝外部网络请求。

## 0.1.0-rc.7

2026-10-22，构建环境和方式同下述 rc.6。此版本修复操作确认弹窗的即时语言切换，保持原操作、焦点、展开详情和异步状态，并补充资源外部依赖及模型删除选择的工作区会话保护。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.7-amd64.deb` | `744684c0919524ea46db0e12c4515442b4b5531d0329bf6b5d6b712cd9fe8e45` |
| `artifacts/rocos-configurator-offline.zip` | `7c443de059d4e17f335019683ca5bf3e2c7310d1e0e4b74e1bf984e6c77ff7f8` |

- TypeScript 检查与 release deb 构建通过。
- `modal-language.spec.ts`：Chrome 7 项、Playwright Firefox/WebKit 14 项通过。检查真实确认/取消、导出字节、详情展开、焦点、窄窗页脚及相同 UUID/revision 的工作区替换保护。首次兼容运行未设置已有浏览器安装路径，浏览器未启动；设置 `PLAYWRIGHT_BROWSERS_PATH=/tmp/rocos-browser-tools` 和该目录 sysroot 的 `LD_LIBRARY_PATH` 后通过。
- 生产构建的仓库子路径离线测试 2 项通过：未访问页面的完整缓存、断网编辑与工程往返、缓存缺项检测。
- 实际静态 ZIP 解压冷启动、编辑持久化及文件哈希验证通过，测试期间拒绝外部网络请求。
- 从 rc.7 deb 解包的实际 Linux 程序通过完整原生流程，新增关闭确认和目录导出成功弹窗的即时中英文切换检查。原生保存、备份、冲突保护、浏览器往返、损坏恢复及 ZIP/目录字节一致性仍通过。`test-results/desktop/report.json` 记录版本 `0.1.0-rc.7` 和程序 SHA-256 `82c95d7243ee8a17a90d939769ea3b9ccd02aaef7c4d358d0dfc6bb252aac20c`。
- 本轮未改动领域算法、归档契约或 Rust 服务实现，未重复执行单元和外部 C++ 消费端测试；其上一版本记录保留在下文。

## 0.1.0-rc.6 历史记录

### 构建环境与产物

验证日期：2026-10-22。构建环境为 Ubuntu 22.04.5 LTS、x86_64、Node.js 24.22.0、Rust 1.99.1。桌面构建使用 `tauri build --bundles deb` 的 release 配置，前端使用相对路径 `--base ./`；Linux 开发库来自本地 sysroot。无系统安装操作。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.6-amd64.deb` | `79da271a33734bc413ea7f6d81a7e6c276167f2011e76c8ba406ca5154108cbf` |
| `artifacts/rocos-configurator-offline.zip` | `249375a2e2b7d3970bfe78af4bb8643c0275e71296e5103bf9e15dfa5e7bf6ea` |

deb 声明依赖 `libwebkit2gtk-4.1-0`、`libgtk-3-0`。本次验证从 deb 解出的程序，不是系统安装测试，也不证明单个 deb 包含目标电脑缺少的全部系统依赖。

### 已执行的验证

- 前端单元测试：159 项通过。149 项外部 C++ 消费端测试本轮未设置源码路径而明确跳过；其此前执行记录不能替代修改对应契约后的复验。
- Rust 原生文件和目录服务：14 项通过，覆盖真实临时文件上的备份、外部修改拒绝覆盖、取消、分块与哈希校验、能力授权、目录导出和消息序列化。
- 真实桌面程序：在隔离 Xvfb/Openbox 显示中使用 WebKitWebDriver、tauri-driver 和 GTK 文件对话框执行 `scripts/verify-desktop.mjs`，核对界面及归档版本。流程包含首次保存、覆盖备份、中英文冲突原因及磁盘差异、另存为、目录导入、副本/新工程身份、浏览器往返、后台模型解析、取消未保存关闭、损坏恢复与原包保护，以及运行目录清单、文件哈希、ZIP 逐字节一致性和原保存目标保留。
- 静态离线 ZIP：实际解压到无 `node_modules` 的临时目录，启动包内服务，拒绝外部网络请求后验证冷启动、通信周期修改持久化、归档版本和每项文件长度/SHA-256。

桌面测试日志及截图位于 `test-results/desktop/`；最终完整复跑成功，并输出 `report.json`，记录实际程序路径、SHA-256、版本、检查范围和未执行项。解包程序 SHA-256 为 `3f6714e052c9b58119447e32d1aefae2dcc7165b2908a1b74bf85727b9929f77`。首次尝试因本地 sysroot 的 Openbox 主题搜索路径缺失而退出；补齐 `XDG_DATA_DIRS` 与 `XDG_CONFIG_DIRS` 后，同一 deb 的测试通过。补充验证报告时，两次复跑在通知消失后的 WebKitWebDriver 截图请求超时，DOM 和文件保护断言已通过；该截图改用 ImageMagick `import` 捕获真实 X11 应用窗口，功能断言保留。以上调整均未修改安装包或应用行为。

## 尚未取得的证据

未验证 Windows 构建/断网安装、独立离线电脑、实际 Safari、GitHub Pages 远端发布、磁盘满或断电恢复，以及 SDK 和实机。原始共享结构的无硬件验证范围另见 [ABI.md](ABI.md)。现有结果不代表以上事项完成，也不代表配置可安全驱动真实机器人。总体要求与缺口以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
