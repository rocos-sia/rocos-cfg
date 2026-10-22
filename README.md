# ROCOS Configurator

ROCOS 控制器的本地工程配置工具。采用 React、TypeScript 和 Vite，配置解析在本机完成，可部署到 GitHub Pages，也可通过静态离线包或 Tauri 桌面版运行。

当前处于开发测试阶段。已有双主站教学示例、工程创建、IgH PDO/SDO 表单与从站操作、EC-Master 启动配置、ENI 只读解析、URDF 树与引用同步、现有几何编辑、3D 拾取与姿态预览、硬件绑定、源码草稿、资源映射、依赖导出、编译期配置模块、模板与规则快照、`.rcproj` 归档、Tauri 原生文件适配及运行配置目录导出。**尚未完成设计方案全部验收**：真实历史版本迁移、完整桌面交付、实际 Safari/Pad 与跨电脑验收仍需完成，进度见 [验收记录](docs/ACCEPTANCE.md)。

机器人模型工作区可拖动或用键盘调整结构树、属性面板宽度，并收起属性；根据实际容器宽度切换三栏、双栏或单面板标签页。布局、滚动位置和预览状态保留在当前工作区会话中，重新打开工程时重置，不写入 `.rcproj`。

3D 场景铺满预览卡片，顶部居中图标视角栏在鼠标接近时渐显，离开后渐隐；键盘聚焦可见，触屏常显。底部可独立切换世界坐标轴、关节轴、Collision、Visual、网格和整体半透明显示；左下角 Gizmo 支持点击/拖动旋转，也可聚焦后按 X/Y/Z（Shift 反方向）。坐标轴使用加粗箭杆与箭头；旋转关节显示右手正方向弧形箭头，移动关节保留直线方向箭头。半透明关闭后恢复原材质。显示选项只保留在工作区会话中。下方源码提供“格式化 URDF”（两空格缩进），先生成草稿，再通过“应用修改”写入配置；旧 `<hardware>` 和有文本语义的扩展片段保留原文。

IgH 从站列表支持行末垃圾桶删除、拖动排序及上移/下移按钮；确认影响后同步调整 Hardware/关节绑定，支持撤销。React Flow 拓扑卡片随配置顺序更新；EC-Master 显示 ENI 从站顺序且只读，不推断物理端口分支。

一级导航可主动收放并保留本机偏好；手机上展开为导航覆盖层。窄窗顶栏通过“更多操作”访问恢复草稿、离线状态、主站版本、语言和主题，打开与保存保持可见。

主要配置页面已接入中英文切换，语言偏好不随工程归档；具体覆盖范围与剩余诊断翻译见 [界面语言](docs/I18N.md)。

首版各项验证入口与尚缺证据见 [验收跟踪](docs/ACCEPTANCE.md)。本轮按用户指令仅以 Chrome 浏览器功能、离线产物和内部测试提交收尾；其他浏览器、Tauri 本地部署和外部环境验收留作后续工作。

主站与 APP 原始共享结构的布局、私有映射进程间读写及首从站定位限制见 [共享内存契约验证](docs/ABI.md)。本机测试结果不替代实际控制器二进制与 SDK 验证。

工程格式仍为首版 v1。逐版本迁移基础设施、变更预览和首次另存保护已接入；当前没有更早的正式格式，具体边界及后续版本接入要求见 [工程模型迁移](docs/MIGRATIONS.md)。

新建 ROCOS-IGH 工程或新增从站时，可选择空白 PDO 或产品模板（Elmo/Talon、ZeroErr、XJC、AX58200 GPIO）。模板以 JSON 保存品牌、型号、配置变体、来源和 PDO，按设备类型分组并可搜索；所用快照随工程归档，详见 [模板库](templates/README.md)。

过程映像支持原始顺序和 Rx / Tx 分组查看，保留原始位偏移。PDO 信号由用户手动配置，空条目不再显示运行时发现提示；完整 APP 导出仍检查所需输入、输出信号。

启动页或工程总览可“打开示例”，体验包含模型、硬件、绑定、APP 和附件的两套完整教学工程。ECM 示例 ENI 仅供解析演示，机械参数默认待人工确认，详见 [示例说明](docs/EXAMPLES.md)。

## 开发与检查

需要 Node.js 22.12+（CI 使用 Node.js 24）。

```sh
npm ci
npm run dev
```

打开终端显示的本机地址。开发模式不注册 Service Worker。浏览器测试使用独立的 `127.0.0.1:5183` 服务，不复用 IDE 的开发服务；该端口需空闲。

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

EC-Master 启动配置加载器测试锁定 `e0e5e32`；允许该基线的后代提交，但参与核对的加载器文件必须保持基线字节且无本地修改。同样需要 `g++` 和 yaml-cpp：

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

两类主站与真实 Talon 的完整工程测试另见 [真实七轴工程回归](docs/REAL-PROJECTS.md)，覆盖约 53 MB 资源的编辑、归档、重开及运行导出。原始 IgH/APP 组合存在信号不匹配，测试保留问题工程并仅在测试副本中显式处理，不将其视为可部署配置。

## GitHub Pages

仓库 Settings → Pages 的 Source 选择 GitHub Actions，然后运行 **Deploy GitHub Pages** 工作流。工作流根据 Pages 的实际 base path 构建，上传 `dist/`。工作流目前由手动触发；源码编辑不会直接发布网站。

`.github/workflows/check.yml` 在 PR 和 main 推送时执行单元测试、构建、浏览器流程及子路径离线测试，并产出静态离线 ZIP。发布工作流与浏览器测试尚需在远端实际执行后才能确认仓库权限和 Pages 环境可用。

路由使用 Hash；应用资源、manifest 和 Service Worker 均限定在当前站点路径。构建路径遵循 [Vite 的 GitHub Pages 部署说明](https://vite.dev/guide/static-deploy.html#github-pages)。

## 离线运行

网页端提供两种离线方式：

- **已有浏览器缓存**：首次联网打开生产构建，等顶部显示“已可离线使用”，之后可断网使用。此状态会检查当前构建所有页面和资源，不只检查已访问的页面。浏览器清除资源后可联网点击“修复缓存”。
- **首次离线启动**：联网构建机运行 `npm run package:offline`，将 `artifacts/rocos-configurator-offline.zip` 复制到离线电脑并解压。离线电脑预先准备 Node.js 和浏览器，执行 `node scripts/serve-static.mjs`，访问 `http://127.0.0.1:4173/`。也可使用预装 Python 3 在 `dist` 目录执行 `python3 -m http.server 4173 --bind 127.0.0.1`。无需在离线电脑安装 npm 依赖。构建机可运行 `npm run test:package` 检查实际 ZIP 的解压冷启动、编辑和工程下载。

静态离线包不附带 Node.js、Python 或浏览器。请勿直接双击 `file://index.html`。Service Worker 使用 HTTPS 或 localhost 安全上下文，参见 [MDN Service Worker 说明](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。

界面字体随包分发，四个字重合计约 20.8 MiB，全部纳入离线缓存；不需要电脑预装字体，也没有运行时字体 CDN 请求。来源和验证范围见[本地字体分发](docs/FONTS.md)。项目代码采用 MIT 许可；第三方字体遵循其[独立声明](THIRD_PARTY_NOTICES.md)。

新版本完成缓存后显示更新提示；先下载工程，再关闭所有应用窗口，重新打开使用新版本。应用不会强制刷新正在编辑的页面。

## 桌面离线版

桌面版支持原生打开、保存、另存为、导出副本和资源目录导入；覆盖前检查外部变化并保留备份。Linux 已能构建 deb，Windows 提供带离线 WebView 安装器的 NSIS 构建配置，仍需实机验收。构建命令、文件语义与验证边界见 [桌面离线版](docs/DESKTOP.md)。

## 工程与配置文件

1. 创建工程并选择 ROCOS-IGH 或 ROCOS-ECM，可选择空白模型或带参数的双关节演示模板。
2. 编辑主站配置；EC-Master 需导入 ENI，原始 ENI 保持只读。
3. 配置 URDF；在硬件页明确选择从站和关节，预览生成带 URDF 限位及唯一 PDO 候选的草稿，补齐机械参数并核对绑定。再配置 APP 参数；在 APP 配置页导入资源或目录，设置文件、目录及 `package://` 映射。
4. 下载 `.rcproj` 保存工程。未应用或存在语法错误的源码草稿也可以随工程留存。
5. 校验后查看导出计划，确认路径改写及文件清单，再下载运行包。阻塞错误修复前不能导出完整运行包。

机器人模型页点击“导入URDF”，先选择 URDF，再选择其所在目录。程序按 Mesh 文件名（忽略引用中的路径，解码 URI 转义并区分大小写）搜索同级及子目录；同名文件多于一个时手动选择，缺失资源可稍后补充。浏览器必须由用户选择目录后才能读取其中的文件，也可仅导入 URDF。导入预览确认后一次应用，URDF 原文与资源目录结构保留，匹配关系随工程保存；纹理等其他依赖仍可通过 APP 资源管理补充。

新建 ROCOS-IGH 工程选择设备模板，或向空总线添加首个从站时，默认开启该从站的 DC 参考开关。后续新增/复制从站默认关闭，导入、打开工程及排序不重新设置参考从站；总线 `master.dc` 仍由主站配置独立控制。DC 开关与相邻输入框居中对齐，说明 Tooltip 紧邻标签。

模型树与 3D 拾取联动：选中模型会展开并定位相应树路径；只有筛选挡住所选节点时才清除筛选。普通属性编辑保留相机及兼容关节的预览姿态，限位收紧时夹紧预览值；重命名或改变类型的关节回到中立位置。

URDF 结构非法时，树仍保留每个 Link / Joint，缺失父节点、多个根、重名或空名称等内容归入“未连接节点 / 冲突节点”，重复父节点和环用引用行表示。选中引用可定位原节点；名称有歧义时提供文件内序号及源码定位，避免改错同名对象。源码定位不会覆盖未应用草稿。修复源码或通过表单重挂接后刷新结构，修改可撤销；残留 `<hardware>` 中的节点仍视为不透明内容。

关节选择支持按名称搜索。可切换 Visual / Collision 显示，拾取和适应模型只使用当前可见几何；没有碰撞几何时显示提示。展开视图保留同一画布，支持退出按钮、Escape 和键盘焦点循环。3D 背景跟随浅色/深色主题。

选中关节时，橙色箭头显示随当前姿态变换的运动轴，蓝线连接父 Link 原点与当前关节坐标系。平面关节显示法向，固定和浮动关节不显示单一运动轴。模型没有可见几何时，适应模型使用运动链坐标原点。

缺失、损坏或暂不支持预览的 Mesh 使用 0.08 m 橙色线框占位，仅用于定位，不代表实际尺寸。资源问题列表保留所有检测到的 Mesh / 纹理问题及来源，可定位到对应 Link 的 Visual / Collision；导入或映射资源后重新检查。DAE 缺纹理时保留几何并使用替代颜色，预览不请求外部资源。URDF 残留的 `<hardware>` 保持原样，不参与解析或资源检查；硬件关联以 `hardware_config.yaml` 为准。预览及定位操作不改写工程配置。

切换配置页面后保留相机、姿态、选中节点、搜索和树展开状态。这些视图状态只在当前工作区会话中保留，不写入工程文件。

导入配置会先展示预览。同一批出现多个主站、URDF 等候选时，必须选择活动配置，其他候选文件仍留在工程中。目录与 ZIP 保留相对结构；单独替换同类活动配置时沿用原工程路径。覆盖前显示文件及源码草稿影响，草稿连同原基线保留，基线变化后不能直接应用。整次导入可撤销。替换主站或 ENI 会列出从站/信号差异及 ENI 哈希，保留 Hardware 原引用并要求重新确认绑定。

运行包只收集活动主站、APP 及其依赖，包含目录资源、DAE 图片和 glTF buffers/images。路径仅在导出副本中改为相对路径；原配置、工程内映射和 ENI 原始字节不受影响。确由目标环境提供的非核心资源可显式标记，清单写入包内 `ROCOS-DEPLOYMENT.txt`。脚本、网页及其他附件的动态依赖暂不解析，按映射目录原样携带。3D 预览支持 STL / DAE；glTF 当前只做文件及依赖保留，不提供模型预览。

诊断表显示字段/对象路径，可定位到对应设备、主站参数、PDO/SDO、资源映射或源码。旧结果过期后须重新校验；定位不改写未应用草稿，ENI 源码保持只读。行为及验证入口见 [诊断定位](docs/DIAGNOSTICS.md)。

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
