# 本地产物验证记录

本记录按版本保留本地验证结果，不代表正式发布或完整首版验收。产物位于本机 `artifacts/`，不随 Git 提交；后续源码修改不会自动更新这些包或本记录。无版本后缀的静态离线 ZIP 及 `test-results/` 会被后续构建/验证替换，应按哈希对应记录。

## 0.1.0-rc.12

2026-10-22，构建环境和方式同 rc.6。补齐 Visual/Collision 显示切换、展开视图及深色 3D 背景和网格；拾取、适应模型和包围框只使用可见几何。网页与桌面共用不移动 DOM 的覆盖层，保留同一画布，提供背景禁用、Escape、退出按钮、焦点循环及至少 44px 的视图按钮。选择器支持搜索；切页保留相机、姿态、选中节点、筛选及树展开/滚动状态。新工作区会话重置这些状态，不改变配置或工程格式。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.12-amd64.deb` | `58f62b3b6995cd9da433a603c4c81931d089da7adaaef38c58a8733001f7d3f5` |
| `artifacts/rocos-configurator-offline.zip` | `d7e8b2771dedad027fb8b0445db5a35086ed415e3f0803c2068a9e7d277a963a` |

- TypeScript 检查与最终 release deb 构建通过。消息模板与姿态单元测试 9 项通过；本轮未改配置领域、归档或 Rust 文件服务实现，未重复全量单元、C++ 消费端及 Rust 单元测试。
- 最终 Chrome 模型、输入、资源与导入回归 18 项通过。覆盖 STL/DAE 纹理、原始资源保真、新上下文重开、可见碰撞拾取、相机/姿态与切页恢复，以及 1440px、768px 和 390px 英文深色展开视图的键盘/触控仿真、弹层内下拉菜单、背景禁用/恢复、Tab 循环、Escape/按钮退出、画布身份/画面恢复及工程数据不变。
- 最终 Firefox/WebKit 对应回归共 36 项通过，覆盖相同显示、输入、资源与导出流程。
- 相机/姿态截图在滑块失焦、提示框关闭后比较完整画布，避免将覆盖在画布上的提示框算作场景变化。触控仿真不替代实际 Pad、软键盘或读屏验收。
- 最终生产构建的仓库子路径离线测试 3 项通过；实际静态 ZIP 的解压冷启动、编辑持久化、归档版本和文件哈希检查通过，验证时拒绝外部网络请求。
- 最终 deb 解包程序通过完整 Linux 原生流程，报告记录 21 项检查。新增显示切换、切页恢复、展开层菜单、Tab 循环、Escape/按钮退出及保存后全部工程载荷字节不变；工程 revision 和入口保持不变。原生 Tab 驱动逐次等待焦点确实移动，避免未处理的系统按键与后续操作重叠。`test-results/desktop/report.json` 中程序 SHA-256 为 `66573073971d1d49caec1c48ced4b2983f6448291952e7846777ac0aea71930d`。

## 0.1.0-rc.11

2026-10-22，构建环境和方式同 rc.6。本版本修复 3D 拾取后节点隐藏在折叠树或筛选中的问题，并保留普通属性编辑前的相机及兼容关节姿态；收紧限位时夹紧预览值。当前工作区暂存相机和姿态，以跨越大 URDF 后台解析造成的视图卸载；这些状态不写入工程，重新打开工程开始新会话。配置与归档契约不变。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.11-amd64.deb` | `0541ea2b254646007065c176876397fabc06debda70dd035c20565b63ff70343` |
| `artifacts/rocos-configurator-offline.zip` | `e564e4e767f2ee5bcf7962089d52904fe1017c37bbdeabb558d91dd8c3fe9a33` |

- TypeScript 检查与最终 release deb 构建通过。新增姿态保留/类型变更/无效数值单元测试 3 项通过；配置领域、归档及 Rust 文件服务实现未改动，未重复全量单元、C++ 消费端及 Rust 单元测试。
- 新增模型工作区用例 4 项，最终 Chrome、Playwright Firefox/WebKit 共 12 项通过：折叠路径定位、阻挡筛选清除及有效筛选保留、同步与后台解析后相机截图一致、姿态保留/夹紧/撤销/重置、同一工程重开会话隔离及预览不改工程数据。
- 原模型编辑/导出和多设备输入 5 项在 Chrome 通过；随后补充工作区会话保护后的最终 Firefox/WebKit 运行包含上述新增及既有用例，共 18 项通过。最终 Chrome 模型工作区截图已查看。
- 最终构建的仓库子路径离线测试 3 项，以及实际静态 ZIP 的解压冷启动、编辑持久化和归档哈希检查通过。
- 首次桌面验证发现大 URDF 修改限位仍归零；修复后台解析卸载时的工作区暂存后，已重新构建上表产物。最终 deb 解包程序通过完整原生流程，包括折叠树拾取定位、大 URDF 限位编辑/撤销/重置、备份与冲突保护、工程往返、恢复、目录/ZIP 字节一致性及双主站示例导出。`test-results/desktop/report.json` 共记录 19 项检查，程序 SHA-256 为 `e80a6eeb86d5f27b3794f8a8a8e583216ece645ef91a1e898c6b533dce2ff1c6`。

## 0.1.0-rc.10

2026-10-22，构建环境和方式同 rc.6。本版本为硬件列表增加带设备名称的原生单选入口，支持方向键切换、44×44px 命中区及主题焦点反馈；为机器人结构树提供名称及可见焦点。修复英文硬件属性卡片超出工作区导致操作按钮裁切的问题。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.10-amd64.deb` | `3e471155e7072be7bcfd963a988847865c7102d6f25eea5b9d508f31b9a36be0` |
| `artifacts/rocos-configurator-offline.zip` | `4d7178b0d88690cf5a550dc607524a212a78c94c8a0c9e8df146e4a02a6cb0bb` |

- TypeScript 检查与 release deb 构建通过。领域算法、配置/归档契约及 Rust 文件服务实现未改动，本轮未重复执行单元、C++ 消费端或 Rust 单元测试；上一版本 324 项测试结果保留在下文。
- 新增复杂输入用例 3 项，在 Chrome、Playwright Firefox/WebKit 共 9 项通过：设备顺序与从站/关节不同，键盘及触控选择不改工程数据，编辑隔离、确认失效及撤销恢复、归档字节保真、分支树折叠/展开/筛选与预览联动、语言切换保留节点身份。
- 本轮共享键盘驱动后，原双主站示例输入回归在 Chrome 4 项、Firefox/WebKit 8 项通过。之后的英文卡片布局修正再次通过上述 9 项复杂输入检查，包含右侧卡片边界及删除按钮可见性。英文深色焦点截图已查看。
- 最终构建的仓库子路径离线测试 3 项及实际静态 ZIP 的解压冷启动、编辑持久化、归档哈希检查通过。
- 最终 rc.10 deb 解包程序通过完整原生流程，新增真实按键切换设备、只编辑第二个 Driver 并读取实际保存归档核对其余参数的检查。报告程序 SHA-256 为 `c453df46c3abc1013f0db9fe623469918389c3682a23a00b63b571c409a54a12`。
- 键盘测试使用真实 Tab/Shift+Tab、方向键和 Enter/Space；触控为本机 Pad 仿真，不替代实际设备、软键盘或读屏软件验收。

## 0.1.0-rc.9

2026-10-22，构建环境和方式同 rc.6。新增两个自包含教学示例，提供完整主站、单轴几何模型、Hardware/Binding、APP 与附件，并留存版本化模板快照。示例 ENI 是本项目编写的解析教学数据，未经过 SDK 或实机验证。默认保留机械复核门槛。

| 产物 | SHA-256 |
| --- | --- |
| `artifacts/rocos-configurator-0.1.0-rc.9-amd64.deb` | `a7f579ee3b12776edc3cb0e46f3c0358a0f85c4781a8a61b7568e1942de1fde3` |
| `artifacts/rocos-configurator-offline.zip` | `b2bd3758561dada9a7495996585a594b4a0bd7513c89cab3b5b36a586ba087a8` |

- TypeScript 检查与 release deb 构建通过。
- 双主站示例的键盘及触控仿真完整流程：Chrome 4 项、Playwright Firefox/WebKit 8 项通过。覆盖主站周期、Joint origin、APP 端口、机械换算、人工确认、工程存档、全新存储上下文重开及运行包导出。键盘使用真实 Tab/Shift+Tab、方向键和 Enter/Space；最初的单向 Tab 驱动未覆盖 Firefox 从滚动工作区起始的焦点顺序，最终双向导航通过。
- 实际 rc.9 deb 解包程序通过完整原生流程，新增两套示例的原生存档、运行导出及 ENI 字节一致性检查；报告记录程序 SHA-256 `721d57605048c6945e0a76a68b577048ec4b9a6f3bcbc4e582ab15b8656818ba`。
- 本轮设置三套消费端源码路径，全部 324 项测试通过，无跳过项。新增示例由原始 IgH/ECM YAML 加载器、APP 启动、Hardware/Binding、Model 加载器检查；共享结构测试仍使用私有临时映射，不连接实际主站。ECM 加载器仅检查 ENI 可读性，SDK 对 ENI 的语义验证未执行。
- 生产仓库子路径离线测试 3 项通过，包括完整缓存后断网重载，打开并编辑两类示例，存档与运行导出，ECM ENI 字节不变。
- 实际静态 ZIP 的解压冷启动、编辑持久化及归档哈希验证通过，测试拒绝外部网络请求。

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
