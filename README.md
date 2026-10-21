# ROCOS Configurator

ROCOS 控制器的本地工程配置工具。采用 React、TypeScript 和 Vite，配置解析在本机完成，可部署到 GitHub Pages，也可通过静态离线包或 Tauri 桌面版运行。

当前处于开发测试阶段。已有双主站教学示例、工程创建、IgH PDO/SDO 表单与从站操作、EC-Master 启动配置、ENI 只读解析、URDF 树与引用同步、现有几何编辑、3D 拾取与姿态预览、硬件绑定、源码草稿、资源映射、依赖导出、编译期配置模块、模板与规则快照、`.rcproj` 归档、Tauri 原生文件适配及运行配置目录导出。**尚未完成设计方案全部验收**：真实历史版本迁移、完整桌面交付、实际 Safari/Pad 与跨电脑验收仍需完成，进度见 [验收记录](docs/ACCEPTANCE.md)。

主要配置页面已接入中英文切换，语言偏好不随工程归档；具体覆盖范围与剩余诊断翻译见 [界面语言](docs/I18N.md)。

首版各项验证入口与尚缺证据见 [验收跟踪](docs/ACCEPTANCE.md)。

主站与 APP 原始共享结构的布局、私有映射进程间读写及首从站定位限制见 [共享内存契约验证](docs/ABI.md)。本机测试结果不替代实际控制器二进制与 SDK 验证。

工程格式仍为首版 v1。逐版本迁移基础设施、变更预览和首次另存保护已接入；当前没有更早的正式格式，具体边界及后续版本接入要求见 [工程模型迁移](docs/MIGRATIONS.md)。

启动页或工程总览可“打开示例”，体验包含模型、硬件、绑定、APP 和附件的两套完整教学工程。ECM 示例 ENI 仅供解析演示，机械参数默认待人工确认，详见 [示例说明](docs/EXAMPLES.md)。

## 开发与检查

需要 Node.js 22.12+（CI 使用 Node.js 24）。

```sh
npm ci
npm run dev
```

打开终端显示的本机地址。开发模式不注册 Service Worker。

```sh
npm run typecheck
npm test
npm run build
npm run test:ui
```

浏览器测试默认使用已安装的 Google Chrome。也可安装 Playwright Chromium 并设置 `PLAYWRIGHT_CHANNEL=chromium`。首次安装浏览器需要联网；应用本身运行不依赖 Playwright。

Firefox 与 WebKit 使用独立兼容性配置，执行相同的浏览器用例：

```sh
npx playwright install --with-deps firefox webkit
npm run test:compat -- --workers=2
```

这里的 WebKit 是 Playwright 提供的测试引擎，不能替代 macOS/iOS 上实际 Safari 的验收。

本机兼容性验证使用 Chrome 155.0.8059.84、Playwright Firefox 157.0 和 WebKit 27.2；浏览器文件、归档恢复、表单、3D 资源与后台任务流程已有自动化覆盖。远端 CI 配置同时包含 Firefox/WebKit 任务。

```sh
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:ui
PAGES_BASE=/rocos-configurator/ npm run build
PLAYWRIGHT_CHANNEL=chromium npm run test:offline
```

离线测试会在 `/rocos-configurator/` 下启动构建产物，完成缓存后断网，打开未访问的配置页面，并编辑、校验、下载及重新打开工程。测试服务只监听 `127.0.0.1`。

IgH 消费端契约测试可使用本机的 `rocos-igh` 源码运行，当前锁定提交 `3c92f2a`，需要 `g++` 和 `yaml-cpp` 开发库：

```sh
ROCOS_IGH_SOURCE=/path/to/rocos-igh npm test
```

该测试仅编译原生文件加载器，核对有效/无效配置与 64 位 SDO 编码，不连接 EtherCAT、共享内存或设备。未设置 `ROCOS_IGH_SOURCE` 时，消费端测试明确跳过；其余单元测试照常执行。

EC-Master 启动配置加载器测试锁定 `e0e5e32`，同样需要 `g++` 和 yaml-cpp：

```sh
ROCOS_ECM_SOURCE=/path/to/rocos-ecm npm test -- tests/consumer/ecm.test.ts
```

测试直接编译 `Main/Common/EcConfig.cpp`，覆盖原生整数/布尔转换、默认值、可选服务的 null/缺省状态、字段限制、路径解析，以及编辑/导出后的值保真；不链接 EC-Master SDK，不启动主站。ENI 在该加载器中只检查文件可读性，其 SDK 语义仍需独立验证。相对 ENI 与日志路径的最终长度取决于部署目录，必须满足消费端缓冲区限制。

APP 的 Hardware/JointBinding 原始加载器测试锁定 `7093bcd`，需要 `g++`、`nm`、yaml-cpp、KDL、Eigen 和目标源码中的 spdlog 头文件：

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app npm test -- tests/consumer/app.test.ts
```

测试只使用无硬件解析入口，不构造 Hardware 或启动 APP。未设置环境变量时明确跳过。硬件字段、默认位置控制完整性要求、IO 通道限制和解析检查的边界见 [Hardware 与 Joint Binding 配置](docs/HARDWARE.md)。

APP 启动配置另用原始 `AppConfig::load` 验证，无需构造 Robot：

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app npm test -- tests/consumer/app-startup.test.ts
```

该测试核对默认值、整数和字符串转换、无效参数，以及运行包搬到新目录后不依赖工作目录的路径解析。表单、控制链和资源依赖共用这套默认值；保存工程不会主动补写缺省字段。模型重命名会同步实际使用的 Base/Tip，包括原先省略、由 APP 默认值提供的名称。原生加载器将字符串字段中的 YAML null 解释为文字 `null`，界面按该行为显示；它不会被当作禁用路径，缺少对应资源仍会报错。

模型契约测试直接编译原始 APP Model、KDL parser 和 TRAC-IK，并核对实际 Talon 的七关节顺序；旧消费端对 `hardware.limit` 的处理与配置器忽略旧扩展的策略分别记录，详见 [模型限位与测试依赖](docs/HARDWARE.md)。可单独运行真实模型的浏览器测试：

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app npm test -- tests/consumer/model.test.ts
ROCOS_APP_SOURCE=/path/to/rocos-app npm run test:ui -- tests/browser/talon.spec.ts
```

Talon 浏览器测试从指定源码目录读取 URDF 和八个 STL，检查实际三角形绘制、结构树、旧扩展不参与解析及工程往返后的文件哈希。模型资产不复制到本仓库或公开应用包；未提供源码路径时此测试明确跳过。

## GitHub Pages

仓库 Settings → Pages 的 Source 选择 GitHub Actions，然后运行 **Deploy GitHub Pages** 工作流。工作流根据 Pages 的实际 base path 构建，上传 `dist/`。工作流目前由手动触发；源码编辑不会直接发布网站。

`.github/workflows/check.yml` 在 PR 和 main 推送时执行单元测试、构建、浏览器流程及子路径离线测试，并产出静态离线 ZIP。发布工作流与浏览器测试尚需在远端实际执行后才能确认仓库权限和 Pages 环境可用。

路由使用 Hash；应用资源、manifest 和 Service Worker 均限定在当前站点路径。构建路径遵循 [Vite 的 GitHub Pages 部署说明](https://vite.dev/guide/static-deploy.html#github-pages)。

## 离线运行

网页端提供两种离线方式：

- **已有浏览器缓存**：首次联网打开生产构建，等顶部显示“已可离线使用”，之后可断网使用。此状态会检查当前构建所有页面和资源，不只检查已访问的页面。浏览器清除资源后可联网点击“修复缓存”。
- **首次离线启动**：联网构建机运行 `npm run package:offline`，将 `artifacts/rocos-configurator-offline.zip` 复制到离线电脑并解压。离线电脑预先准备 Node.js 和浏览器，执行 `node scripts/serve-static.mjs`，访问 `http://127.0.0.1:4173/`。也可使用预装 Python 3 在 `dist` 目录执行 `python3 -m http.server 4173 --bind 127.0.0.1`。无需在离线电脑安装 npm 依赖。构建机可运行 `npm run test:package` 检查实际 ZIP 的解压冷启动、编辑和工程下载。

静态离线包不附带 Node.js、Python 或浏览器。请勿直接双击 `file://index.html`。Service Worker 使用 HTTPS 或 localhost 安全上下文，参见 [MDN Service Worker 说明](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。

新版本完成缓存后显示更新提示；先下载工程，再关闭所有应用窗口，重新打开使用新版本。应用不会强制刷新正在编辑的页面。

## 桌面离线版

桌面版支持原生打开、保存、另存为、导出副本和资源目录导入；覆盖前检查外部变化并保留备份。Linux 已能构建 deb，Windows 提供带离线 WebView 安装器的 NSIS 构建配置，仍需实机验收。构建命令、文件语义与验证边界见 [桌面离线版](docs/DESKTOP.md)。

## 工程与配置文件

1. 创建工程并选择 IgH 或 EC-Master，可选择空白模型或带参数的双关节演示模板。
2. 编辑主站配置；EC-Master 需导入 ENI，原始 ENI 保持只读。
3. 配置 URDF；在硬件页明确选择从站和关节，预览生成带 URDF 限位及唯一 PDO 候选的草稿，补齐机械参数并核对绑定。再配置 APP 参数；在 APP 配置页导入资源或目录，设置文件、目录及 `package://` 映射。
4. 下载 `.rcproj` 保存工程。未应用或存在语法错误的源码草稿也可以随工程留存。
5. 校验后查看导出计划，确认路径改写及文件清单，再下载运行包。阻塞错误修复前不能导出完整运行包。

导入配置会先展示预览。同一批出现多个主站、URDF 等候选时，必须选择活动配置，其他候选文件仍留在工程中。目录与 ZIP 保留相对结构；单独替换同类活动配置时沿用原工程路径。覆盖前显示文件及源码草稿影响，草稿连同原基线保留，基线变化后不能直接应用。整次导入可撤销。替换主站或 ENI 会列出从站/信号差异及 ENI 哈希，保留 Hardware 原引用并要求重新确认绑定。

运行包只收集活动主站、APP 及其依赖，包含目录资源、DAE 图片和 glTF buffers/images。路径仅在导出副本中改为相对路径；原配置、工程内映射和 ENI 原始字节不受影响。确由目标环境提供的非核心资源可显式标记，清单写入包内 `ROCOS-DEPLOYMENT.txt`。脚本、网页及其他附件的动态依赖暂不解析，按映射目录原样携带。3D 预览支持 STL / DAE；glTF 当前只做文件及依赖保留，不提供模型预览。

“校验与导出”提供两种工程副本：**导出工程副本**保留工程 UUID；**复制为新工程**生成新的 UUID 和初始 revision，可打开后独立维护。两者均保持当前工作区与保存目标；同 UUID 的另一份工程打开前会提示快照和 revision 差异。

顶部“本机恢复草稿”按打开会话分别缓存工程，同 UUID 的多份副本和多个浏览器标签页使用不同缓存槽位。可选择恢复或清除旧草稿；恢复先校验，失败保留缓存。首次读取兼容早期的单槽位草稿。缓存受浏览器配额与清理策略限制，写入失败会提示保存工程备份。

`.rcproj` 是包含 manifest、配置原文、资源、编辑状态和 SHA-256 清单的 ZIP 容器。工程下载不等于原文件已被覆盖；请保留下载文件。浏览器 IndexedDB 恢复草稿与离线应用缓存均不能代替工程备份。静态检查通过也不代表已通过 SDK 或实机验证。

工程文件的打开校验、保存打包、损坏包检查、跨文件校验和运行包生成在独立 Worker 中执行，显示计算进度并支持取消。取消终止该计算，保留工作区与原文件；保存使用操作开始时的快照，期间继续编辑不会被旧快照的完成状态覆盖。运行包计划生成后若工程已变化，需重新生成计划。

总线与 URDF 视图共用派生结果，解析输入超过 256 KiB 时使用 Worker。结果绑定工程 UUID、revision 和工作区会话；输入变化或切换工程时取消旧任务，不显示旧模型。仅在所有解析输入字节、编码和目标规则均相同时复用结果，编辑未应用草稿不会重复解析或打断输入焦点。Worker 随应用分发和缓存。导入预览、结构修改事务、部分属性解析与 3D 场景创建仍在界面线程执行，大型模型的整体性能仍需继续验证。

## 附加配置与工程兼容

工程总览显示当前主站和 APP 规则版本、已核对的规则快照，以及模板参数与覆盖值。创建工程和新增 IgH 从站会保留实际使用的 JSON 模板快照；重新打开工程不会重新套用模板。规则与当前适配器不一致时阻止运行导出，可保留原文并显式选择受支持的规则重新校验。模板与规则的维护约定见 [模板库](templates/README.md)。

APP 配置页的“附加配置模块”支持创建并关联末端负载文件，编辑质量和质心，保留源文档注释与额外字段。模块可有多个文件实例，运行包只携带活动依赖。新增配置类型通过编译期模块注册接入；开发契约和实例说明见 [配置模块开发](docs/MODULES.md)。

未知可选模块的原文件、工具状态、声明和元数据会随工程保留，界面保持只读；它参与运行依赖时阻止运行导出。未知必需模块或较新的工程格式只展示摘要，并提供“复制原始工程包”，当前工作区保持不变。复制使用收到的原始字节，不经过当前序列化器重新打包。当前仅有 v1 格式；迁移框架尚无真实历史版本转换，详见 [工程模型迁移](docs/MIGRATIONS.md)。

完整性检查失败时可复制原始工程包，或显式检查可恢复文件。恢复同时检查 ZIP CRC、manifest 长度与 SHA-256，只将通过检查的文件放入新 UUID 工程；损坏、缺失、未登记文件列入报告。原 manifest 和可读取的编辑状态原文随新工程留存，不完整模块的残留文件只读隔离，不能作为已验证模块参与运行导出；人工确认状态全部重置。

中央目录被截断时，仅尝试恢复具有完整本地文件头、明确长度和 CRC 的条目；无法确定数据描述符边界时停止扫描。manifest 不可验证、未知必需模块、不受支持的格式、非法路径或超限时不创建恢复工程。哈希一致不等于作者可信。恢复与损坏范围说明见 [工程恢复](docs/RECOVERY.md)。

## 设计与版本

- [软件设计方案](docs/ROCOS%20Configurator%20软件设计文档.md)
- [视觉与交互规范](DESIGN.md)
- [项目版本维护技能](.agents/skills/rocos-version/SKILL.md)

应用版本统一读取根目录 `VERSION`，并同步 npm、Cargo 和 Tauri 清单。每次创建 Git 提交按技能确定 `X.Y.Z-rc.N` 内部版本或正式版本；正式发布创建 `vX.Y.Z` tag，内部 rc 不自动打 tag。文档修订号与应用版本独立。
