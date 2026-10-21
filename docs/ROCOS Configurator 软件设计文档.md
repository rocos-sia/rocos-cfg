# ROCOS Configurator 软件设计文档

**项目名称：** ROCOS Configurator\
**中文名称：** ROCOS 机器人控制系统可视化配置工具\
**文档版本：** V1.2\
**文档日期：** 2026-10-21\
**项目状态：** 方案设计阶段，本文描述目标能力，不表示功能已实现

## 1. 项目定位与设计范围

ROCOS Configurator 是独立运行的离线工程配置工具，面向控制系统开发人员、系统集成人员和调试工程师。用户先确定 EtherCAT 主站类型和总线配置，再配置 ROCOS APP 使用的机器人模型、硬件、关节绑定和启动文件，最终导出相互一致的配置包。

| 软件 | 职责 | 与本工具的关系 |
| --- | --- | --- |
| rocos-igh | 基于 IgH 的 EtherCAT 主站 | 编辑主站、从站、PDO、SDO，生成 `igh.yaml` |
| rocos-ecm | 基于 Acontis EC-Master 的 EtherCAT 主站 | 编辑启动参数，读取 ENI，生成 `ecm.yaml` 并携带原始 ENI |
| rocos-app | 机器人模型、硬件、运动控制和上层通信 | 生成 URDF、Hardware、Joint Binding、APP 启动配置等文件 |
| ROCOS HMI | 状态监控、示教和运行操作 | 共享视觉规范；不属于配置工具的运行依赖 |

### 1.1 本次修订的核心决策

1. **Web 优先、桌面共用核心**：GitHub Pages 上的静态网站必须独立完成完整配置闭环；桌面离线版复用同一业务核心。
2. **先主站、再 APP**：导航、创建向导、依赖校验和开发计划均遵循此顺序。
3. **兼容两类主站**：统一上层总线视图，分别保留 IgH 与 ECM 的配置语义，不互相套用文件格式。
4. **ENI 始终只读**：解析、展示、检查和引用，不生成、修改或重新序列化 ENI；需要调整网络时使用外部 ENI 工具并重新导入。
5. **URDF 可编辑、可导出**：树、属性面板和 3D 预览联动，支持结构及参数修改，导出实际更新后的 URDF。
6. **配置模块可扩展**：通过注册表、Schema、版本适配器和文件依赖接口接入后续配置文件。
7. **遵循 [DESIGN.md](../DESIGN.md)**：沿用 ROCOS 工业工作台的主题、字体、组件和响应式规范，按配置任务调整界面内容。
8. **单文件工程留存**：使用 `.rcproj` 压缩工程保存配置、模型资源、关联与编辑草稿，支持跨电脑打开和继续编辑；与运行配置导出分开。
9. **结构化模板优先**：模板数据进入统一工程模型，配置由文档模型序列化；Python/Jinja 仅作为后续批量工具或报告生成的可选辅助。

### 1.2 首版边界

首版支持一个工程选择一个活动主站后端：`igh` 或 `ecm`。“兼容两种主站”不等于同一工程同时启动两个主站；多主站、多机器人属于后续扩展。创建另一套后端配置可通过复制工程完成。

首版不要求控制器在线，不执行 EtherCAT 扫描、SDO 写入、驱动器使能或机器人运动，不负责生成完整 ENI 或通用 Xacro 执行环境。配置导出与部署、静态校验与实机验证是不同操作。

## 2. 使用流程与文件职责

### 2.1 主流程

```text
新建 / 打开 .rcproj / 导入已有配置
  → 选择目标 APP 版本、主站类型及版本
  → 配置主站
      ├─ IgH：主站参数 → 从站 → PDO / SDO
      └─ ECM：启动参数 → 导入 ENI → 只读查看与兼容检查
  → 建立统一总线信号目录
  → 导入 / 编辑 URDF，选择 Base / Tip 和控制关节链
  → 配置 hardware_config.yaml，关联总线信号
  → 配置 joint_binding.yaml
  → 配置 APP config.yaml、payload 等资源
  → 随时保存 / 导出 .rcproj 工程文件（含未完成草稿）
  → 跨文件校验 → 文件差异预览 → 导出运行配置
```

主站页先于 APP 页，但允许一次导入完整工程及提前浏览模型。主站未就绪时，用户仍可编辑草稿；依赖主站的 PDO 自动关联显示“等待主站配置”，不产生虚构的有效绑定。只有目标版本可确定且必要依赖满足后，才能导出通过校验的运行配置包。

### 2.2 文件职责与可编辑性

| 文件 | 内容来源 | 编辑方式 | 导出规则 |
| --- | --- | --- | --- |
| `master/igh.yaml` | IgH 配置 / 模板 | 表单、表格及高级 YAML 编辑 | IgH 原生格式，含 `version`、`master`、`slaves` |
| `master/ecm.yaml` | ECM 启动配置 | 表单及高级 YAML 编辑 | ECM 原生顶层字段，`eni` 指向 ENI 文件 |
| `master/eni.xml` | 外部 ENI 工具 | 只读结构、表格、XML 查看 | 原始字节复制，可保留原文件名如 `eni7.xml` |
| `models/robot.urdf` | 导入 / 新建模型 | 树、属性及高级 XML 编辑 | 导出修改后的 URDF |
| `app/hardware_config.yaml` | 总线目录、模型与用户输入 | 按硬件类型编辑 | 使用 APP 对应版本的原生字段 |
| `app/joint_binding.yaml` | 控制关节与驱动器绑定 | 绑定表 | 显式绑定配置 |
| `app/config.yaml` | APP 启动设置和资源引用 | 表单及高级 YAML 编辑 | 仅包含 APP 支持的启动字段 |
| `app/payload.yaml` 等 | 导入 / 扩展模块 | 原文件保留或专用编辑器 | 按模块能力输出，不臆造目标格式 |
| `rocos-project.json` | 工具内部工程描述 | 工程设置 | `.rcproj` 根 manifest，不供 ROCOS 运行程序读取 |
| `proj1.rcproj` | 工程归档服务 | 保存、打开、另存为、导出副本 | ZIP 容器，完整保留配置、资源与必要编辑状态 |

`ecm.yaml` 与 `igh.yaml` 是本工具的标准导出名称，不是对控制程序默认文件名的修改。ECM 当前默认读取可执行文件相邻的 `../config/config.yaml`，但支持 `--config <path>`；IgH 启动必须指定 `--config <path>`。因此标准交付可分别使用：

```bash
rocos_ecm --config /path/to/robot-project/master/ecm.yaml
rocos_igh_master --config /path/to/robot-project/master/igh.yaml
```

以上是二选一的部署说明，不由工具自动执行。旧 ECM 部署可选择将 `ecm.yaml` 导出为其原有 `config/config.yaml`，同时保留正确的 ENI 相对路径。APP 的 `app/config.yaml` 与 ECM 的旧 `config.yaml` 始终按用途和目录区分，不能仅凭文件名识别类型。

## 3. 运行形态与部署设计

### 3.1 三种运行形态

| 形态 | 定位 | 文件操作 | 离线条件 |
| --- | --- | --- | --- |
| GitHub Pages Web | 首要交付形式，打开网址即可使用 | 选择文件 / ZIP 导入，下载文件 / ZIP 导出；支持时增强目录访问 | 初次访问需获取静态资源 |
| PWA / 本地静态包 | 浏览器离线使用 | 与 Web 相同 | PWA 已完整缓存；或静态包通过本机 HTTP 服务运行 |
| Tauri 桌面版 | 无公网电脑上的独立安装程序 | 原生文件夹、保存、备份和可选本地辅助程序 | 安装包及所需 WebView 运行时须可离线获取 |

三者必须共用解析、编辑、校验和导出逻辑。网页不能依赖 Rust 命令、本机 Node 服务、C++ 可执行程序或控制器接口才能完成 P0 配置。桌面首版以 Linux、Windows 为验收平台，macOS 后续按需求验证。

GitHub Pages 提供静态托管，因此本方案的工程处理全部在客户端完成，不设置业务服务端。项目站点通常位于 `https://<owner>.github.io/<repository>/`。[GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

### 3.2 GitHub Pages 构建与路由

- 采用 Vite 静态构建，发布 `dist/`，通过 GitHub Actions 完成依赖安装、检查、构建和 Pages 部署。
- 项目站点构建 `base` 使用 `/<repository>/`；当前仓库对应 `/rocos-configurator/`。自定义域名或站点根目录使用对应构建配置，不硬编码到组件。
- PWA manifest 的 `start_url`、`scope` 和 Service Worker 注册范围与站点 base 一致，避免影响同一域名的其他仓库站点；本地静态包使用独立的根路径构建配置。
- 使用 HashRouter，例如 `/rocos-configurator/#/master`，避免刷新子页面依赖服务器重写。
- 字体、图标、编辑器 Worker、3D 资源、模板、Schema 全部随包分发，所有资源地址遵循构建 base；运行时不依赖 CDN。
- Pages 发布目录只包含应用代码和公开示例，不包含用户导入的工程、ENI、许可证或最近文件记录。
- CI 在仓库子路径下验证页面刷新、懒加载、Worker、模型资源和离线缓存。

构建 base 和 Pages Actions 方案参照 [Vite 静态部署文档](https://vite.dev/guide/static-deploy.html)。工作流中的工具版本在实现时选定并锁定，不在设计阶段承诺未经验证的依赖组合。

### 3.3 离线运行与缓存

PWA 使用 Service Worker 缓存应用壳、所有 P0 页面模块、Worker、字体、内置模板和 Schema；完成缓存校验后才显示“已可离线使用”。缓存按应用版本隔离，更新时提示用户保存草稿后切换，不能强制刷新丢失编辑。Service Worker 运行需要安全上下文，开发可使用 localhost。[MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

PWA 不保证从未访问过的离线电脑能首次启动，也不保证浏览器缓存永久保留。冷启动离线场景交付静态离线包或桌面安装包：静态包内附使用说明，通过预装或随包提供的本机静态服务访问 `http://localhost:<port>/`，不承诺双击 `file://index.html` 可用；桌面安装不应现场下载核心资源。

自动恢复草稿存于 IndexedDB，正式工程文件使用 `.rcproj`；项目大资源按文件标识存储，不能把 Mesh 塞入 localStorage。界面区分“已缓存草稿”“已写入磁盘”和“已生成下载”；缓存失败或配额不足时提示导出工程。离线缓存与工程备份是两个独立概念。

### 3.4 文件访问抽象

提供统一 `FileAccess` 接口：打开 `.rcproj`、导入文件集合、读取字节、写入工程快照/运行输出、检测覆盖冲突。业务层使用工程相对路径和虚拟文件系统，不直接访问宿主绝对路径。

浏览器的兼容基线为文件选择 / 拖放、ZIP 导入与 Blob 下载。目录选择和原位保存属于能力增强，需检测 API 支持并获取用户授予的目录权限；不可用或拒绝权限时回退到 ZIP 流程。[MDN showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)

桌面版使用原生文件适配器。覆盖写入前检查源文件哈希，发生外部修改时显示差异；单文件采用临时文件校验后替换。多文件保存不宣称天然原子化，使用暂存目录、写入清单及备份恢复；优先导出到新目录。浏览器下载不显示为“原文件已覆盖”。

## 4. 总体架构与数据模型

### 4.1 技术方案

| 技术 | 用途与约束 |
| --- | --- |
| React + TypeScript + Vite | 静态 Web 主体、类型与构建 |
| Ant Design + CSS 变量 | 复用 DESIGN.md 的组件语义与主题，替代初稿中的 shadcn/ui 主方案 |
| Zustand | 工作区状态；持久化与领域事务独立封装 |
| Three.js + URDF 加载组件 | 3D 预览；渲染对象不是 URDF 唯一数据源 |
| CodeMirror | YAML/XML 查看、编辑、错误定位及差异视图，接入共享字体与主题 |
| YAML Document / AST、XML 源文档模型 | 保留字段、注释、未识别节点和来源位置 |
| JSON Schema + 领域校验器 | 按目标版本校验字段、业务规则及跨文件引用 |
| ZIP、IndexedDB、Web Worker | 工程传输、本地草稿和大型文件处理 |
| Tauri 2 | 桌面文件访问与可选本机能力，不承载唯一业务实现 |
| 独立 C++ 配置校验程序 | 开发/CI 兼容性验证，可选桌面增强，不是 Web 必需依赖 |

### 4.2 分层与依赖方向

```text
UI：工程向导 / 主站工作区 / APP 工作区 / 校验与导出
                      ↓
应用层：编辑事务 / 撤销重做 / 依赖更新 / 导出计划
                      ↓
领域核心：Project / BusCatalog / RobotModel / Hardware / Binding
                      ↓
格式适配器：IgH / ECM YAML / ENI只读 / URDF / APP YAML / 扩展模块
                      ↓
平台接口：BrowserFileAccess / IndexedDB / DesktopFileAccess
```

依赖通过接口注入；领域核心不能导入 Tauri API、React 组件或网络服务。ENI 与 URDF 解析在 Worker 中处理较大输入，任务带工程 revision，过期结果不得覆盖较新的编辑状态。

### 4.3 工程模型

以下是接口概要，类型名称表示待实现的领域契约，不是可直接写入控制程序的配置字段。

```typescript
type MasterConfig =
  | { kind: 'igh'; target: TargetProfile; fileId: string;
      config: IghNativeConfig }
  | { kind: 'ecm'; target: TargetProfile; fileId: string;
      config: EcmNativeConfig; eniFileId: string; eniDigest: string };

interface RobotProject {
  schemaVersion: number;
  id: string;
  name: string;
  revision: number;
  targets: { app: TargetProfile };
  master: MasterConfig;
  robot: RobotModelDocument;
  hardware: HardwareDocument;
  bindings: JointDriveBinding[];
  app: AppStartupDocument;
  files: Record<string, ProjectFile>;
  modules: Record<string, ModuleInstance[]>;
  packageMap: Record<string, string>;
}

interface BusSignal {
  uid: string;                    // 工具内部稳定标识
  slaveUid: string;
  runtimeSlaveId: number;
  direction: 'input' | 'output';  // 统一采用主站视角
  sourceName: string;             // 原始变量名，ECM 保留完整路径
  runtimeName: string;            // 实际写入 Hardware 的名称
  index?: number;
  subIndex?: number;
  bitLength: number;
  bitOffset?: number;
  dataType?: string;
  storageBytes?: number;
  source: SourceLocation;
  resolution: 'resolved' | 'ambiguous' | 'unresolved';
}
```

`TargetProfile` 记录软件版本 / commit、配置格式版本、共享内存 ABI 标识、能力和约束。ECM 与 IgH 各保留原生配置，不把 ENI 压缩成可编辑的 IgH `slaves` 再导出。

总线目录是由主站配置派生的视图，不能作为第二份独立可编辑事实。文件记录保留原字节、编码、哈希、解析树、未知节点、修改状态与来源路径；ENI 原始字节单独保存，展示用格式化文本不得替代导出数据。

### 4.4 一致性与编辑事务

- 表单、结构树和源码编辑通过同一个事务入口更新工程，单次重命名和全部引用变更可一起撤销。
- 高级源码存在语法错误时保留编辑缓冲区和诊断，不更新已解析的领域模型；阻止用旧模型冒充最新源码导出。
- 主站变更 → 重建信号目录 → 重新验证 Hardware → 绑定和 APP 配置失效状态更新。
- URDF 变更 → 重建结构树和控制链 → 检查 Hardware/Binding/Base/Tip 引用 → 更新预览。
- 用户确认过的限位、换算和映射不因上游变更而被自动覆盖；自动建议与已确认值分开保存。
- 切换主站类型先保存工程快照并展示影响，再导入新主站配置；保留 APP 草稿但使总线绑定待复核。首版不提供 IgH ↔ ENI 自动转换。

## 5. 界面与交互规范

### 5.1 导航和工作区

| 顺序 | 一级页面 | 主要内容 |
| --- | --- | --- |
| 1 | 工程总览 | 新建/导入、目标版本、依赖状态、最近导出 |
| 2 | 主站配置 | 类型选择；IgH 编辑或 ECM 启动设置与 ENI 查看 |
| 3 | 机器人模型 | Link / Joint 树、3D、属性、控制关节链 |
| 4 | 硬件与绑定 | Hardware、PDO 映射、关节绑定 |
| 5 | APP 配置 | APP 启动参数、payload、资源和扩展配置入口 |
| 6 | 校验与导出 | 错误定位、文件差异、目标路径和导出清单 |

新建向导强调上述顺序，熟练用户可直接切换页面。每页显示“未配置 / 草稿 / 待复核 / 静态校验通过”等状态，不能将配置已加载显示为设备在线。

布局采用 `100dvh`：左侧全高一级导航，右侧为顶部工程状态、主工作区和底部配置操作条。结构树属于工作区内的第二级导航，不与一级侧栏混为一体。

- 一级侧栏展开 `208px`、折叠 `64px`；顶部和底部最小高度 `72px`，内容可换行。
- 顶部展示工程名、活动主站、目标版本、保存状态和离线可用状态。
- 主工作区可使用结构树 `240–300px`、弹性主视图、属性面板 `320–420px`，允许拖动分隔条。
- 底部提供“上一步 / 下一步”“校验”“导出”，显示错误数；文件预览和诊断使用可折叠面板。
- 工具不复制 HMI 的运动运行条，不展示无意义的使能、运行、停止和控制权按钮。

### 5.2 视觉基线

以本项目的 [DESIGN.md](../DESIGN.md) 为统一规范，工作台使用 `--config-*` 语义令牌。规范中的代码落点为待实现约定；实现时在本仓库建立对应主题令牌、字体和双语资源。

| 项目 | Configurator 采用的基线 |
| --- | --- |
| 主色 / 导航 | `#2563eb` / `#192b45` |
| 工作区 / 卡片 | 浅色 `#f5f7fb` / `#ffffff`；深色 `#111b2a` / `#1b293c` |
| 顶栏 | 浅色 `#e8eef6`，与深蓝侧栏区分 |
| 边框 | 浅色 `#e2e8f0`；深色 `#344459` |
| 字体 | 本地 AlibabaPuHuiTi，包含编辑器；不依赖公网字体 |
| 字号 | 页面 20px、卡片 16px、正文 14px、辅助 12px |
| 卡片 / 控件圆角 | 16px / 8px |
| 外边距 / 卡片间距 | 16px / 12–16px；窄屏按规范压缩 |
| 控件 | 常规高度 44px，主要触控目标至少 44 × 44px |
| 语言 / 主题 | 默认中文浅色，同时支持英文与深色 |

数值右对齐、单位明确，偏移和位宽同时标记 bit / byte；未知值用“未提供”或 `—`，不用 0。只读 ENI 带锁图标和“来自 ENI，只读”文本，提供复制和来源定位，不能仅用灰色表达禁用。

错误使用危险色，警告用琥珀色，绿色只表示已完成的检查或保存。保持键盘焦点、树方向键操作、属性标签、图标按钮 aria-label、撤销重做和减少动效设置。

### 5.3 响应式与简单配置体验

以 1920 × 1200 为参考画布，适配 1366 × 768 桌面和 Pad；按实际工作区宽度折叠属性区或切换抽屉，面板内部滚动，不整页缩放。手机以查看为主。

常用设置先显示，线程/诊断等放入“高级参数”；给出字段说明、单位、目标程序默认值和缺省值差异。首次打开提供“新建工程”“导入已有配置”“打开示例”，示例始终带标识。错误可跳转到具体对象和字段，普通保存成功使用非阻塞反馈。

## 6. 主站配置设计

### 6.1 统一入口与能力差异

| 能力 | IgH | Acontis EC-Master |
| --- | --- | --- |
| 主站启动参数 | 编辑 `master` 节点 | 编辑 ECM YAML 顶层字段 |
| 网络配置来源 | YAML 的 `slaves` | 外部 ENI XML |
| 从站增删、排序 | 支持，联动检查 Hardware ID | 只读，需外部修改 ENI |
| PDO/SDO 编辑 | 支持当前 IgH 格式 | 只读展示 ENI 中可解析的信息 |
| 总线信号目录 | 由显式 PDO entries 派生 | 由 ENI 过程映像及可确认关联派生 |
| 主站标准输出 | `igh.yaml` | `ecm.yaml` + 原始 `eni.xml` |

公共视图显示主站 ID、周期、从站列表、主站输入/输出信号及来源。具体字段和规则由后端适配器负责，不能把 IgH 的 `dc: "on"` 简单等同于 ECM 的 `dcmmode`。

### 6.2 IgH 主站

#### 6.2.1 配置结构

导出保留当前 `version: 1`、`master` 和 `slaves` 结构。

| 字段 | 已核对的当前约束 |
| --- | --- |
| `master.master_id` | 非负，需与 APP `robot.ecat_id` 一致 |
| `master.period_us` | 当前最小 1000 μs，不按 ECM 的范围校验 |
| `master.cpu` | 非负整数或 null；null 保持原有亲和性 |
| `master.dc` | 字符串 `"on"` / `"off"`，不是布尔值 |
| `master.preop_timeout_ms` / `op_timeout_ms` | 正整数 |
| `master.pdo_config_attempts` | 正整数，包含首次尝试 |
| `slaves[].id` | 从 0 连续编号，与列表下标和物理位置对应 |
| `slaves[].dc_ref` | DC 开启时恰有一个参考从站 |
| `slaves[].rx_pdos` / `tx_pdos` | 非空 PDO 列表，含 index 和 entries |
| `slaves[].init_commands` | 可选 PREOP SDO 顺序列表 |

从站可新增、复制、删除和排序；修改物理顺序时展示 Hardware ID 及关节绑定影响，再按事务更新。离线配置不能确认真实接线、厂商身份或主机 CPU 是否存在，界面将这些检查标记为“未实机验证”。

#### 6.2.2 PDO 与 SDO

PDO 表格包含 `name`、`index`、`sub_index`、`bit_length`，索引支持十六进制显示。RxPDO 为主站输出（Master → Slave），TxPDO 为主站输入（Slave → Master）。字段大小写和名称按原文保存，不能将同义词自动替换成新变量名。

保留空 `entries` 的原生语义：IgH 在启动阶段通过 SDO 发现并回写映射。离线工具将其显示为“运行时待发现”，不能据此生成已验证的 Hardware 引用。用户可导出主站单文件；完整 APP 配置包要求所需信号已可解析，必要时重新导入主站发现后的文件。

当前 IgH 支持非整字节 PDO：线上位宽仍保留实际值，共享内存存储宽度按其适配规则计算；不能把 1 bit 修改为 8 bit 来通过校验。APP 可访问性还需检查读取类型、符号和有效位语义。

SDO 编辑支持当前加载器定义的 8/16/32/64 位有符号和无符号整数，按顺序导出 `init_commands`。64 位数使用精确整数表示，避免 JavaScript Number 精度丢失。当前支持 `Type`/`Value` 及其小写别名，导出采用目标版本约定，保留用户原有合法形式。

设备模板可保存 PDO、SDO 和说明；后续导入 ESI 作为候选配置。ESI 是设备描述，ENI 是网络配置，两者不能互相替代。

### 6.3 ECM 启动参数

ECM 的配置由启动 YAML 和 ENI 共同决定。加载已有 `config.yaml` 后解析 `eni` 引用；浏览器只在已导入的文件集合内查找，缺失时提示补充文件，不尝试读取用户机器的任意路径。

| 分类 | 原生字段 | 编辑与校验要求 |
| --- | --- | --- |
| 基础 | `id`, `eni`, `cycle`, `duration` | ID 非负；ENI 必需；周期单位 μs；duration 单位 ms，0 为持续运行 |
| 线程 | `cpuidx`, `auxclk` | cpuidx 为 0–31；缺省随 id；当前 Linux auxclk 只能为 0 |
| 链路 | `link`, `instance`, `mode` | link 为 0/1/2；instance 从 1 开始；mode 为 0/1 |
| 同步 | `dcmmode`, `ctloff` | dcmmode 为 0–5，结合 SDK 能力和 ENI DC 信息展示 |
| 状态 | `state` | init / preop / safeop / op |
| 日志 | `verbose`, `perf`, `log` | verbose 非负，perf 为 0–2；log 保留空值与相对路径语义 |
| 可选服务 | `sp`, `mbxsrv` | 缺省/null 为禁用；启用后端口 1–65535 |
| 输出闪烁 | `flash` | 缺省/null 为禁用；0 表示全部，其他值为从站地址 |
| 容量 | `maxbusslaves` | 正整数，属于 SDK 预分配容量，不等于 IPC 上限 |
| 许可 | `license` | 本地编辑和保留，界面默认遮挡，不写入公开模板和诊断日志 |

`sp`、`flash`、`mbxsrv` 必须保留“缺省 / null / 显式启用”的语义；不能用结构体中的数值默认值误启用功能。新建模板默认不启用输出闪烁和可选服务，导入已有配置时保留原值。

当前加载器拒绝未知键和重复键，导出的 `ecm.yaml` 不添加 `type: ecm`、`schemaVersion` 等工具字段。周期上限、路径字节长度及其他整数范围均从目标版本规则生成。`eni`、非空 `log` 相对于 ECM YAML 所在目录解析；部署目录改变可能影响解析后路径长度，应在导出计划中展示未完成的目标路径检查。

### 6.4 ENI 只读解析与展示

#### 6.4.1 解析层次

解析器先识别 XML 编码、根节点、版本及命名空间，再根据 ENI profile 提取已支持内容。原文件保留完整字节，解析失败也可存为工程附件；但不能将失败结果标记为主站配置就绪。

```text
ENI 文件（文件名 / 版本 / 哈希 / 解析状态）
├─ Master：名称、地址与可识别设置
├─ Slaves
│  └─ 从站：位置、PhysAddr、AutoIncAddr、厂商/产品/版本
│     ├─ ProcessData：SM、Rx/Tx PDO 描述
│     ├─ Mailbox / InitCmds：初始化配置摘要与原始节点
│     └─ DC：参考时钟、周期与偏移
├─ Cyclic：周期与帧配置
└─ ProcessImage
   ├─ Inputs：ByteSize、Variable
   └─ Outputs：ByteSize、Variable
```

主视图提供“总览 / 从站 / 过程映像 / 初始化与 DC / XML”标签页。变量表显示完整名称、运行时名称、方向、数据类型、位长、位偏移、可确定的对象索引和从站关联；未能确定的值显示“未解析”，允许定位 XML 源节点。

#### 6.4.2 有效映射与候选描述

ENI 中可能同时包含多个 PDO 描述和实际过程映像，不能将所有 `TxPdo` / `RxPdo` 节点当作正在使用的信号。以 `ProcessImage/Inputs|Outputs/Variable` 及网络实际分配信息建立信号目录；其他 PDO 描述显示为描述/候选项。

从站归属和对象索引优先使用显式关联、已验证的过程数据区域和分配信息；变量全名模式只能在已验证 profile 下参与解析。不能仅按变量短名匹配，也不能从位偏移猜测对象字典索引。遇到缺失、重叠、多解或不支持的 ENI 版本时保留原文并标记歧义，阻止相关自动绑定。

过程映像方向统一按主站视角解释。周期字段保留来源和单位，各种 CycleTime 不按标签同名就视为同一单位；profile 明确单位及同步模式后再比较 YAML 周期与 ENI 周期，不一致时报告差异，不修改 ENI。

#### 6.4.3 当前 ROCOS-ECM 的额外限制

以下来自本地 `rocos-ecm` 代码核对，属于当前适配 profile 的约束，不是对所有 Acontis ENI 的限制：

1. 当前 `myAppSetup()` 按 `1001 + i` 查询固定站地址，并向共享内存发布 `id = i`。ENI 固定地址必须满足当前访问假设；不满足时可查看，但该目标版本的运行导出应报错，不能直接重编号 ENI。
2. SDK 变量全名按点号拆分后取最后一段作为共享内存名称。例如完整名 `Slave_1001 [Elmo Drive ].Inputs.Position actual value` 对应 Hardware 名称 `Position actual value`。同一从站同方向的末段重名必须报错，大小写、空格不归一化改写。
3. 当前代码以 `nBitOffs / 8`、`nBitSize / 8` 写入共享内存。非字节对齐的起点或位宽须标记为当前 ECM 适配不兼容，不能套用 IgH 的按位展开规则。
4. 当前共享结构默认最多 50 个从站，每从站每方向 25 个变量；变量名缓冲区 72 字节、从站名 80 字节，须留终止符。按实际编码字节数检查，而非字符数；目标编译覆盖宏时以对应 ABI profile 为准。
5. `maxbusslaves: 256` 不会自动扩大上述共享结构。还需检查过程映像边界、变量名称长度、APP 读取类型和主站/APP ABI 是否匹配。

静态 ENI 解析不能完全代替 EC-Master SDK 的运行时解释。解析器只为证据充分的信号生成可用映射；SDK 才能确定的关系标记为待验证，不把启发式结果当作确定事实。

#### 6.4.4 ENI 替换与导出

重新导入 ENI 时比较文件哈希、从站身份、地址、变量名称、类型、位宽和偏移，列出新增/删除/变化项。仅对可唯一确认的对象提出迁移建议；原 Hardware 引用变成待复核，不按列表序号静默重绑。

锁定约束覆盖树、属性、表格和源码入口。允许替换整个 ENI 文件、另存副本以及调整 `ecm.yaml` 的 `eni` 路径；不允许写入 XML 内部。导出后 ENI 的 SHA-256 应与导入原文件一致，包括注释、编码及空白。

## 7. ROCOS APP 配置设计

### 7.1 URDF 树状模型工作区

左侧以 Link → Joint → Child Link 的层级显示完整机器人结构，中间是 3D，右侧是当前节点属性。固定关节、可动关节和 mimic 关节以图标加文字区分；控制链高亮但不隐藏链外节点。

```text
robot
└─ base_link
   └─ joint_1 [revolute]
      └─ link_1
         ├─ joint_2 [revolute]
         │  └─ link_2
         └─ sensor_mount [fixed]
            └─ sensor_link
```

树支持展开/折叠、搜索、按错误定位、键盘导航，树与 3D 双向选中。结构非法时展示“未连接节点 / 冲突节点”分组，保留内容供修复，不假装只有一棵合法树。

### 7.2 动态配置与导出范围

| 对象 | P0 编辑能力 | 后续增强 |
| --- | --- | --- |
| Link | 新增、重命名、删除、挂接关系检查 | 批量模板与复制子树 |
| Joint | 新增、删除、修改父/子 Link、type、origin xyz/rpy、axis、limit | 批量参数和复杂关节建模辅助 |
| Visual / Collision | 查看并保留全部结构、修改现有 origin、几何尺寸、mesh 路径和 scale | 完整几何创建、碰撞简化工具 |
| Inertial | 展示和校验现有 mass、origin、inertia，原样保留 | 高级质量/惯性编辑与计算辅助 |
| 资源 | 导入 Mesh/纹理、路径映射、替换缺失资源 | 模型资源整理与压缩 |

“动态配置”指编辑后实时更新树、属性、模型和关联诊断；3D 关节运动滑块仅改变预览姿态，不自动修改 URDF 的 origin、编码器零点或运行配置。

基础长度使用 m，旋转和 RPY 使用 rad，质量使用 kg；UI 可提供单位显示切换，文件保持标准单位。根据关节类型展示适用字段：fixed 不产生控制自由度；continuous 不强制上下位置限位；其他类型和 mimic 的控制链支持按目标 APP/KDL 能力检查，不能将全部非 fixed 关节直接绑定成伺服轴。

删除 Link/Joint 前展示受影响子树、Base/Tip、Hardware 名称及绑定；提供明确的级联删除或重新挂接操作。重挂接检查环路和单父节点约束，整次操作支持撤销。URDF 未支持的扩展标签、材质、transmission 和自定义节点仍需保留，不能只靠渲染器对象重建 XML。

导出前检查唯一名称、唯一根 Link、连通性、无环、父子引用、限位、非零轴向、Mesh 资源及现有质量/惯性基本合法性。重命名后同步已识别引用，不能安全更新的扩展引用应提示用户。

### 7.3 Base / Tip、关节链与资源解析

从树中选择 Base Link 和 Tip Link，计算有向父子链，按 APP 使用的 KDL 链顺序提取控制关节。切换 Base/Tip 后显示增删关节和顺序变化，要求复核原绑定，不按新顺序静默重排驱动器。

模型资源由虚拟文件系统解析：

- 相对路径以 URDF 所在目录为基准。
- `package://` 通过工程 `packageMap` 映射，不假定电脑安装 ROS。
- 绝对路径和 `file://` 导入后要求映射或复制到工程；浏览器不能根据路径读取任意文件。
- 生成的 Blob URL 仅供预览，不写进 URDF；导出写入可部署的相对路径，或保留已有且经确认的 package 映射。
- DAE 纹理等间接依赖也纳入清单；缺 Mesh 时保留结构编辑并显示占位，不阻断所有工作，但完整自包含包须补齐必需资源。

P0 接受已经展开的 URDF。Xacro 源可作为附件保留；后续桌面版可调用已配置的外部处理器生成 URDF。网页不调用系统 Python/ROS，展开结果不反向覆盖 Xacro 宏。

### 7.4 Hardware 配置

支持当前 APP 的 `hardware` 列表及 `driver`、`ft_sensor`、`io` 三种类型，表单字段与目标版本逐项对应。

| 类型 / 分组 | 主要字段 |
| --- | --- |
| Driver 基础 | `id`, `type`, `joint_name`, `torque_source` |
| Driver 限位 | `limit.lower`, `upper`, `vel`, `acc`, `jerk`, `effort` |
| Driver 换算 | `transform.ratio`, `offset_pos_cnt`, `cnt_per_unit`, `torque_per_unit`, `user_unit_name` |
| Driver 输入 | status_word、position/velocity/torque_actual_value、load_torque_value 等实际代码支持的信号 |
| Driver 输出 | control_word、mode_of_operation、target_position/velocity/torque 等 |
| FT Sensor | 从站 ID、Fx/Fy/Fz/Tx/Ty/Tz 映射和 offset |
| IO | 数字/模拟输入输出通道数量及变量映射 |

从已配置主站的驱动器候选与控制关节生成 Hardware 草稿：带入可确定的关节名、ID、标准 URDF `<limit>` 明确提供的限位和信号候选。编码器比例、零点、换算系数、机械方向和力矩来源需要模板或人工确认；未确认字段显式标记，不填入看似有效的默认值。URDF 未提供的 acc、jerk 等不能凭空推导。

**旧 URDF 硬件扩展处理：** 硬件参数及 EtherCAT 主站数据关联统一由 `hardware_config.yaml` 配置，关节与驱动器的对应关系由 `joint_binding.yaml` 配置。URDF 中残留的 `<hardware>` 按不透明扩展保留，不解析其内部字段，不参与绑定、校验、资源依赖扫描、限位覆盖或 Hardware 草稿生成；重命名和删除节点时也不扫描其内部属性或产生引用提示，不自动迁移或覆盖现有 YAML。读取、保存和导出保留该扩展内容，编辑标准 URDF 字段不删除它。标准 `<limit>` 缺省时保持未配置，不从旧 `<hardware>` 或消费端默认值补齐。

映射选择器按“从站 → 主站输入/输出 → 变量”过滤，显示类型、位宽、原始名称和来源。可按对象索引及语义推荐候选，但最终写入的是目标主站发布的准确运行时名称。输出通常不能被多个独立写入者共享；输入复用按信号和目标版本规则检查。

**当前 APP 的 ID 约束：** 概念上区分模型关节序号、驱动器 ID 和总线从站身份；但已核对的 `Hardware::buildPDOCache()` 使用 `drive.id` 作为从站 ID。因此当前导出要求 Hardware `id` 对应目标总线的运行时从站序号，`joint_binding.drive_id` 引用同一 ID。不能新增一个未受 APP 支持的 `slave_id` 字段来假设任意映射。

例如模型 `joint_1` 可以绑定 Hardware `id: 4`，其总线对象就是运行时 Slave 4；ECM 当前对应固定地址 1005。模型关节顺序不需要等于总线顺序。

### 7.5 关节绑定

绑定表展示模型链序号、URDF Joint、Hardware Drive ID、主站从站及映射状态。自动顺序绑定只是建议，用户可选择非连续的有效 Driver ID。

```yaml
binding_policy: explicit
joint_bindings:
  - joint_name: joint_1
    drive_id: 4
  - joint_name: joint_2
    drive_id: 1
```

每个当前控制关节必须有且仅有一个有效绑定，同一驱动器不能重复绑定；绑定目标必须是 driver，而不是 FT/IO。导入旧工程缺少绑定文件时，按目标 APP 的默认规则展示推导结果并标明来源；推荐导出显式绑定。其他绑定策略仅在版本适配器明确支持时提供。

### 7.6 APP 启动及附加资源

支持 `http_host`、`http_port`、`http_control_ttl_seconds`，以及：

- `robot.hardware_config`、`robot.ecat_id`、`robot.urdf`。
- `robot.base_link`、`robot.tip_link`、`robot.joint_binding`、`robot.payload`。
- `scripts`、`web_root`。

`robot.ecat_id` 与活动主站 ID 关联展示；APP 原生文件没有经确认的后端类型字段，`igh/ecm` 选择只记在工程描述中，不擅自写入 APP YAML。是否能运行还取决于目标 APP 与主站的共享内存 ABI，ID 一致不代表兼容性已验证。

APP 资源相对路径均相对于 APP `config.yaml` 所在目录。配置文件路径、资源部署路径和浏览器选取文件句柄是三种不同概念，不能把浏览器伪路径写入文件。payload 等暂未实现编辑器的文件允许原样导入导出，界面显示“仅保留，未做语义校验”。

## 8. 工程、扩展模块与格式兼容

### 8.1 `.rcproj` 单文件工程格式

#### 8.1.1 定位与基本约定

工程的默认留存与流转格式为 **ROCOS Project（`.rcproj`）**，例如 `proj1.rcproj`。它采用 ZIP 容器，包含工程描述、各类配置、模型资源和必要编辑状态。用户在另一台电脑或浏览器打开该文件，应能恢复工程并继续编辑，无需原电脑的目录、浏览器缓存或控制器连接。

`.rcproj` 用于保存“工程是什么、配置了什么、还有什么未完成”；运行配置包用于交给目标程序使用。两者使用独立流水线：**配置存在错误可以保存工程，不能因此导出被标记为有效的运行包。**

| 输出类型 | 扩展名 | 内容与用途 |
| --- | --- | --- |
| 工程文件 | `.rcproj` | 配置、资源、版本、关联和编辑草稿，可重新打开继续工作 |
| 运行配置包 | `.zip` 或目录 | 当前活动主站及 APP 所需文件；按交付范围校验，无编辑缓冲区 |
| 单配置文件 | `.yaml`、`.urdf`、`.xml` 等 | 单文件交付，显示尚需携带的依赖 |

首版容器使用 ZIP 的 Store/Deflate 压缩方式和 UTF-8 条目名称，不采用加密 ZIP、分卷或嵌套工程依赖；不要求专有解包程序。普通解压工具可以查看配置，但 ROCOS 程序不直接读取 `.rcproj`。文件扩展名仅帮助选择，打开时同时检查 ZIP 结构、根 manifest 和格式标识。

#### 8.1.2 包内结构

包内不增加与 `proj1` 同名的外层目录，根目录必须唯一存在 `rocos-project.json`。工程文件重命名不会改变内部引用。

```text
proj1.rcproj                     # ZIP 容器
├── rocos-project.json           # 格式、版本、工程信息、文件索引与依赖
├── master/
│   ├── igh.yaml                 # IgH 工程使用
│   ├── ecm.yaml                 # ECM 工程使用
│   └── eni.xml                  # ECM 原字节；也可保留 eni7.xml 名称
├── app/
│   ├── config.yaml
│   ├── hardware_config.yaml
│   ├── joint_binding.yaml
│   ├── payload.yaml
│   └── scripts/                # 按依赖收集
├── models/
│   ├── robot.urdf
│   ├── meshes/
│   └── textures/
├── extensions/                 # 新配置模块和未识别附件
└── project-data/               # 仅配置工具使用，不进入运行包
    ├── editor-state.json       # 稳定对象 ID、确认状态、未提交表单等
    ├── buffers/                # 未应用的 YAML/XML 文本缓冲区
    ├── profiles/               # 本次使用的声明式目标规则快照
    └── templates/              # 本次实际使用的结构化模板快照
```

树中展示两种后端的可能文件，正常工程只需包含活动后端。用户选择保留的旧后端快照可作为附件归档，并记录其非活动状态；不能被运行导出器误选。新建或不完整工程允许某些文件缺失，manifest 必须明确记录未配置和缺失项。

所有内容以文件条目保存，大资源和 ENI 不重复编码进 JSON。文件角色由 manifest 声明，不能仅靠扩展名或目录猜测。`project-data/` 为保留命名空间，扩展模块的工具元数据按模块 ID 分组，不能互相覆盖。

#### 8.1.3 Manifest 契约

`rocos-project.json` 使用 UTF-8 JSON；容器契约版本、工程模型版本、模块版本和目标运行程序版本分开管理。首版容器契约为 `formatVersion: 1`。

| 字段 | 约定 |
| --- | --- |
| `format` | 固定为 `rocos-configurator-project`，用于识别文件用途 |
| `formatVersion` | 正整数，描述容器及 manifest 契约 |
| `projectSchemaVersion` | 工具内部工程模型版本，对应领域模型的 schemaVersion |
| `createdWith` | 创建应用名称和版本；另记录最后保存应用版本 |
| `project` | UUID、名称、说明、创建/修改时间、revision；时间采用带时区的 ISO 8601 |
| `snapshotId` | 每次持久化生成的快照 UUID，同一工程可有多个快照 |
| `targets` | APP 和活动主站的版本/commit、配置版本、ABI profile 标识 |
| `entrypoints` | 主站 kind、主站配置/ENI、APP、URDF、Hardware、Binding 的文件 ID；未配置时显式为 null |
| `modules` | 模块 ID、模块版本、实例 ID、是否为恢复/运行必需模块、所拥有文件和工具状态的文件 ID |
| `files` | 每个文件的稳定 ID、包内 path、role、owner、size、sha256；文本可附 encoding |
| `references` | 来源文件 ID、字段/节点位置、原引用、目标文件 ID，或明确的 external/missing 状态 |
| `packageMap` | `package://` 包名到工程目录的映射，不依赖本机 ROS 环境 |
| `portability` | `complete` / `incomplete` 及缺失或外部资源清单；与配置是否有效分开 |
| `editorStateFileId` | 可选编辑状态文件引用；缓冲区记录关联的 sourceFileId 与基础内容哈希 |

`files` 列出所有普通文件条目（包括工具状态、模板和 profile 快照），不包含 manifest 自身，避免自引用哈希。文件 path 和 ID 必须各自唯一；主站/APP 入口引用这些 ID，不依赖固定文件名。文件大小指未压缩字节数，SHA-256 基于实际保存的字节计算。

保留自定义文件名及相对目录关系；规范化后的路径只能指向工程内部。源文件路径重映射记录在 `references` 中，使原始绝对路径或 `package://` 引用可在虚拟文件系统中解析。运行导出时再按目标布局生成路径，不能为了工程打包修改 ENI 原文。

manifest 和状态文件只存声明式数据，不序列化 React 状态对象、函数、文件句柄、机器凭据或绝对临时路径。模板/profile 快照仅用于追溯和受支持的规则解释，不作为从工程加载执行代码的入口。

#### 8.1.4 保存范围与唯一数据来源

工程保存默认收集当前工程的全部已导入配置、ENI、URDF、Mesh/纹理、附件，以及实际使用的模板与目标规则快照。scripts、payload 等显式依赖也纳入收集；web_root 等已声明目标机器提供的资源列为外部依赖，不自动递归打包用户电脑上的任意目录。

配置文件与工具编辑状态职责如下：

- 已应用的表单/结构修改写入对应 YAML/URDF 文档。已有源文档按 AST 更新，未修改文件尽量原字节保留，ENI 始终原字节保存。
- 各配置文件是已应用配置的唯一权威来源，重新打开时重新解析；不再存储一份可能与其矛盾的完整 RobotProject 配置副本。
- `editor-state.json` 只保存不能从文件重建的工具信息，例如稳定对象 ID 映射、建议值确认状态、未提交表单值及缓冲区索引。
- 尚未应用或语法错误的源码存入 `buffers/`，同时保留最近已应用的配置文件。打开后明确显示“有未应用草稿”，不能自动覆盖有效模型；基础哈希不匹配时进入冲突处理。
- 导入时本身已损坏的配置也可作为原文件保存，显示解析失败并允许后续修复，不伪造一份有效替代配置。
- 不打包运行日志、撤销完整历史、派生 3D 缓存、浏览器访问授权、主题语言偏好和最近文件列表。重新打开后从该快照开始新的撤销历史；普通草稿编辑仍完整恢复。

缺资源或存在配置错误时仍可保存 `.rcproj`。缺资源的清单明确标为“不完整工程”，保留待补齐引用；仅有配置错误时保留错误状态，不因此将资源完整性判为失败。只有全部已声明依赖可在包内解析时才标记 `portability: complete`；这一标记只说明资源齐全，不说明配置或实机校验通过。用户可补充资源后再次保存完整工程。

#### 8.1.5 保存、另存为与导出副本

| 操作 | 行为 |
| --- | --- |
| 保存工程 | 保存完整快照到当前 `.rcproj`；首次保存选择文件名，默认由工程名生成 |
| 另存为 | 选择新路径/文件名并将其作为后续保存目标，保留工程 UUID |
| 导出工程副本 | 生成独立 `.rcproj` 供发送或留档，不切换当前保存目标，保留工程 UUID |
| 复制为新工程 | 生成新的工程 UUID，可记录来源工程 UUID/snapshotId，之后独立维护 |
| 自动恢复草稿 | 写入本机缓存，不擅自覆盖 `.rcproj`，不能显示为文件已经保存 |

文件名与工程显示名称独立，重命名外部文件不影响内部工程 UUID 和资源引用。多份副本具有同一工程 UUID 时，结合 snapshotId/revision 提示差异；首版不自动合并分支，也不能仅按 UUID 覆盖缓存中的另一份工程。

保存流水线：

1. 捕获一致的 revision 快照，包含有效配置、未应用缓冲区和所需资源；保存期间可继续编辑。
2. 将已应用修改序列化到暂存文件集合，收集声明的依赖，记录缺失项；不以运行配置校验失败阻断归档。
3. 计算所有文件哈希和大小，最后生成 manifest，再打包为新的完整 ZIP，不原位修改 ZIP 条目。
4. 校验归档可读、路径/索引/哈希一致；失败则保留当前工程和原工程文件，不显示成功。
5. 平台适配器完成下载或磁盘写入；只对所捕获 revision 标记结果。保存期间新产生的修改继续保持“未保存”。

桌面端使用同目录临时文件，写入并验证成功后替换目标，保留上一份备份；写入失败、取消或磁盘不足时不得破坏原文件。覆盖前比较打开/上次保存时的归档哈希，外部变化时提供另存为或差异处理，不静默覆盖。

网页/PWA 的基线为生成下载 `proj1.rcproj`；不能假定下载完成或原文件已被覆盖，显示“已生成工程下载”。具备文件写入能力且用户授权时可保存到指定文件，写入成功后再显示“已保存工程文件”。保存/导出较大工程时在 Worker 中提供进度与取消，桌面适配器可流式打包；取消不丢失工作区。

#### 8.1.6 打开与恢复流程

1. 通过“打开工程”、拖放或桌面文件打开入口选取 `.rcproj`。接入系统文件关联是桌面增强能力，首版必须至少支持应用内打开。
2. 在隔离的暂存文件系统中检查容器结构、条目路径、manifest 大小、格式版本与资源限额，不立即覆盖当前工程。
3. 检查文件索引、大小和 SHA-256、入口与依赖引用；有效包的普通文件集合必须与 manifest 一致，未登记的文件不自动进入运行导出。
4. 执行受支持的版本迁移，再按主站 → URDF → Hardware/Binding → APP 解析；恢复工具状态和未应用缓冲区，重新构建派生目录及校验结果。
5. 展示工程名、主站、目标版本、文件数量/大小、资源完整性、未知模块及草稿状态；确认可打开后再切换工作区，必要时先处理当前未保存工程。
6. 无需手动解压即可浏览各配置文件、资源与来源；运行导出依然走独立流程，打开工程不执行脚本、启动主站或建立设备连接。

包结构合法而配置内容有错误时，正常打开为待修复工程。容器损坏、路径不合法、manifest 不可解析或哈希不符时不进入正常编辑：保留原包，报告具体问题。若结构可安全读取，可显式进入恢复模式提取可验证的文件到新草稿，重新检查并另存，不覆盖原包或自动信任损坏记录。

#### 8.1.7 版本兼容与扩展

打开旧版本时，使用逐版本、可测试的纯数据迁移，先在暂存区产生迁移报告，成功后再建立新工作区。原 `.rcproj` 不随打开操作被改写，迁移后的首次保存默认另存新文件。

遇到较新的 formatVersion 或未知的必要模块，优先保留整个原包，只提供可安全识别的只读信息与原包复制，不使用旧序列化器重新打包。已支持容器中的未知可选模块，其文件和元数据原样保留；如果它参与活动配置依赖，则阻止相关运行导出。模块依赖是否必要需在契约中明确，不能仅靠 UI 是否可见判断。

带有版本/哈希标识的模板和 profile 快照用于长期留存。新环境缺少对应适配器时显示“目标规则不受支持”，允许查看原文件，但不得宣称已按该版本验证。升级内置模板不能自动改变已保存工程。

#### 8.1.8 完整性与导入边界

SHA-256 用于检查文件损坏及索引一致性，不提供作者身份认证；首版不引入数字签名或加密格式。ZIP 不是保密容器，原配置中保留的 license 等字段随文件流转；工程内容摘要标出这些条目，不自动上传或发布。

归档条目名拒绝绝对路径、盘符、反斜杠路径、`.`/`..` 路径段、NUL、符号链接和路径规范化后的重复/大小写冲突；目录条目不得承载文件内容。配置内部合法的 `../models/...` 相对引用可以保留，但解析结果必须位于工程根内，或明确标记为未访问的外部依赖。不自动递归解压附件或远程下载缺失依赖。对 manifest、文件数量、单项大小、总解压量及实际解压过程设置限额，不能只信 ZIP 头部声明。

首版建议默认保护限额：manifest 4 MiB、普通条目 10,000 个、单文件解压后 256 MiB、累计解压后 1 GiB；这些是待大模型测试确认的工程导入策略，不是 EtherCAT 或最终格式上限。超限要明确拒绝本次打开并保留当前工作区，不截断文件；允许以后在已验证的平台提供更高限额 profile。

#### 8.1.9 工程归档服务

在 `core/project/` 下建立独立的 `ProjectArchiveService`，统一执行 `inspect → load` 和 `createSnapshot → pack → verify`，Browser/Desktop 适配器仅处理文件获取和最终写入。它复用模块的文档序列化能力，但不调用“仅允许有效运行配置”的导出入口。

该服务负责归档 Schema、文件清单、路径和哈希、版本迁移、缓冲区恢复与失败回滚。领域模块负责原生配置及其不可派生状态，运行导出器只提取当前活动配置和部署依赖。浏览器、PWA、桌面版必须通过同一套 `.rcproj` 契约样例。

### 8.2 旧配置与普通 ZIP 的导入

“打开工程”使用 8.1 的 `.rcproj` 流程；“导入已有配置”用于普通目录、配置 ZIP 或单文件，不要求它们已经具备工程归档格式。

1. 有受支持的 manifest 时读取版本和文件索引；包含 `.rcproj` 格式标识的普通 ZIP 也须执行相同的完整性检查。旧工程描述先经过明确的兼容导入，再解析活动主站及模型、Hardware、Binding 和 APP 资源。
2. 无 manifest 时根据 YAML 字段结构识别 IgH、ECM、APP 文件；同名 `config.yaml` 不自动相互覆盖，多候选时由用户选择用途。
3. 按已导入目录/ZIP 的相对路径解析引用；丢失文件形成待补充清单，不将无法访问的路径假定为存在。
4. 未识别文件作为附件保留；未知模块或较新工程版本按 8.1.7 只读查看或原包复制，不静默迁移、重新打包或丢弃。
5. 导入完成展示摘要、目标版本假设、缺失资源、ENI 只读状态以及可自动关联/需复核的内容，随后可保存为 `.rcproj`。普通 ZIP 缺少 manifest 时只作为已有配置导入，不能标记为已通过工程完整性校验。

工程路径统一为相对 POSIX 路径。导入 ZIP 时检查路径穿越、重复条目、大小写冲突和解压大小上限；拒绝读取工程根之外的文件。XML 解析不加载外部实体或远程资源，源码以文本呈现，不作为页面 HTML 执行。

### 8.3 可扩展配置模块

配置模块采用编译期注册，首版不从网络加载任意插件代码。新增文件类型应只需实现模块并注册，不修改导入/导出主流程和已有主站页面。

```typescript
interface ConfigModule<T> {
  id: string;                         // 如 app.payload / app.safety
  version: number;
  detect(files: FileIndex): Detection[];
  parse(source: SourceDocument, ctx: ParseContext): ParseResult<T>;
  validate(value: T, ctx: ProjectContext): Diagnostic[];
  references(value: T): FileReference[];
  export(value: T, ctx: ExportContext): OutputFile[];
  migrate?(source: ModuleSnapshot, targetVersion: number): MigrationPlan;
}

interface MasterAdapter<T> extends ConfigModule<T> {
  kind: 'igh' | 'ecm';
  capabilities: MasterCapabilities;
  buildBusCatalog(value: T, ctx: ProjectContext): BusCatalog;
}
```

UI 注册表另行声明模块标题、分组、图标、表单 Schema 和可选专用编辑器，使解析代码可在 Worker、浏览器和测试中独立运行。模块负责其文件内容，统一导出器负责路径分配、依赖收集、重名冲突及 ZIP 打包。

内置模块包括 IgH、ECM 启动、ENI 只读、URDF、Hardware、Joint Binding 和 APP 启动。扩展模块可覆盖 payload、工具坐标、标定、IO 策略等，格式以实际消费端为准。多实例模块通过文件 ID 区分，不假定每类只有一个文件。

模块间用显式引用和派生任务依赖图协调。派生任务出现环时报告配置冲突，不靠页面更新互相触发；注册能力要能表达“只读”“可生成”“支持高级编辑”“需要桌面能力”。ENI 的只读属性必须在领域层和导出层生效。

### 8.4 版本适配与保真编辑

分别管理工具工程版本、模块版本、目标程序版本和配置格式版本；IgH `version: 1` 不能随工具版本升级而改写。

- YAML 使用 Document/AST 更新已修改节点，尽量保留注释、顺序、数字表示和未知字段。
- 目标加载器明确拒绝的未知键保留在草稿和差异视图中，但阻止对应运行包输出；用户决定删除或更换目标 profile，不静默丢弃。
- URDF 保留未编辑节点和扩展数据；复杂结构变更不能保证字节不变，但必须保证未编辑语义不丢失。
- ENI 无论是否支持其全部语义，导出均直接复制原字节。
- 无法安全编辑的锚点、标签或未知 XML 结构，降为只读保留或提示显式格式转换，不偷偷整文件重写。
- 迁移先生成变更计划和备份；只有验证通过才切换版本，失败保留旧工程。

### 8.5 结构化模板与辅助生成工具

首版的机器人/设备模板采用版本化 JSON/YAML 数据，记录模板 ID、版本、适用主站/APP profile、参数默认值和来源。选用模板后，将数据合并到工程模型，执行规则校验并生成可编辑文档；用户覆盖值与模板建议分开记录，保存 `.rcproj` 时附带实际使用的模板快照。

模板不替代现有 YAML/XML 的文档模型。导入已有文件后通过 AST 局部更新及格式适配器序列化，不能用整文件模板渲染覆盖用户注释、未知字段或 URDF 扩展。ENI 只读约束不因选用模板而改变。

Python/Jinja 可在后续开发/CI 批量样例生成、独立命令行工具或配置报告中使用，消费已校验的结构化数据；不作为网页或桌面核心配置流程的必要依赖，也不在 `.rcproj` 中存放需执行的 Jinja 模板来恢复工程。生成的配置仍须通过同一套消费端兼容检查。

## 9. 校验、保存与导出

### 9.1 校验层级

| 层级 | 内容 | 运行环境 |
| --- | --- | --- |
| L1 语法 | YAML/XML 解析、重复键、非法数值 | 浏览器和桌面 |
| L2 文件结构 | Schema、范围、唯一 ID、URDF 树、ENI 边界 | 浏览器和桌面 |
| L3 跨文件 | 主站/APP ID、信号映射、控制链、路径、ABI profile | 浏览器和桌面 |
| L4 消费端兼容 | 使用真实加载器的无硬件测试，检查生成文件语义 | CI / 开发机，可选桌面辅助 |
| L5 实机 | 真实拓扑、SDK 元数据、时序和设备运行行为 | 后续受控联调 |

静态通过不等于 L4、L5 通过。界面分别显示“通过 / 失败 / 未执行 / 待解析”，未执行的 SDK 或实机检查不计为成功。

### 9.2 关键关联规则

- APP `ecat_id` 与 IgH `master_id` 或 ECM `id` 一致。
- 目标程序、配置格式和共享内存 ABI profile 可配对；仅文件格式兼容时说明运行兼容尚未验证。
- 控制链关节、Hardware Driver ID、运行时从站 ID 和变量引用有效，绑定完整且无重复。
- 主站输入对应 Hardware inputs，主站输出对应 outputs；名称、符号、位宽、存储字节数与实际 APP 读取类型匹配。
- IgH 按位 PDO 与 ECM 字节 PDO 使用不同存储规则；禁止仅通过数值位宽相等判断兼容。
- ECM 地址和变量短名满足当前实现约束；过程映像变量不得越界；疑似重叠/别名按 ENI profile 解释，无法确认时不自动绑定。
- IgH 从站连续编号、DC 引用及容量限制按其版本检查，不全局套用到原始 ENI 固定地址。
- URDF 与 Hardware 的单位、位置/速度/力矩限制一致或明确标记差异；不能自动将所有约束覆盖成 URDF 值。
- 资源引用以各自消费文件为基准解析，导出路径重写后重新校验，不依赖编辑机器的工作目录。

每条诊断包含稳定规则编号、等级、文件/字段/对象定位、实际值、期望值和建议。Error 阻止相关运行输出；Warning 记录用户的处理决定；Info 提供说明。未解决必需引用属于 Error，不能通过点击“忽略警告”绕过。运行配置诊断不阻止 `.rcproj` 草稿保存；归档结构或写入失败则阻止将保存标记为成功。

### 9.3 运行配置导出计划

工程保存/导出副本使用 8.1 的 `.rcproj` 快照流程；以下流程仅处理运行配置，不能混入工程缓冲区、模板/profile 快照或其他工具元数据。导出器先生成可预览清单，再写文件：

1. 固定当前工程 revision，校验活动主站和依赖闭包，处理未应用的源码编辑。
2. 选择“自包含运行包 / 配置文件包 / 单文件”。配置文件包允许声明目标机器已有的 scripts、web_root 等资源，但导出报告列明外部前置条件，不称为自包含。
3. 选择标准布局或已有目标布局；列出目标相对路径、覆盖对象和外部依赖。
4. 调用各模块生成输出，重写 APP/URDF/ECM YAML 中允许修改的文件引用；ENI 内部不改写。
5. 检查重名、路径逃逸、缺文件及必要长度限制，重新解析所有生成文件并运行关联检查。
6. 展示修改差异、警告、目标版本和 ENI 哈希；确认导出动作后生成 ZIP 或写入目录。
7. 记录输出文件哈希、校验结果、未执行检查和启动文件路径，供回溯。

例如标准布局中 APP `robot.urdf` 为 `../models/robot.urdf`，Hardware/Binding 为同目录文件；ECM `eni` 为 `eni.xml`。保留 `eni7.xml` 文件名时同步修改 YAML 引用。用户主机上的绝对路径不得直接作为跨电脑默认导出路径。

### 9.4 校验辅助程序边界

当前 ECM `config_test` 可用于启动 YAML 的离线契约测试，IgH PDO 加载器可做无主站解析。APP 的 `Hardware` 构造会连接共享内存并访问运行状态，不能为验证配置而直接实例化整套 Hardware 或启动 APP。

开发阶段应从现有加载器中复用无副作用解析入口，必要时新增独立测试适配程序；没有纯解析入口时明确列为待实现。ENI 的 SDK 级验证另设测试环境，不为静态网页分发专有 SDK。不得把执行 `rocos_ecm --config ...` 或启动真实主站当作普通文件校验。

## 10. 建议代码组织

```text
rocos-configurator/
├── src/
│   ├── app/                    # 路由、启动、模块注册
│   ├── components/             # 工作台、结构树、属性表、错误列表
│   ├── pages/                  # Overview / Master / Robot / Hardware / App / Export
│   ├── core/
│   │   ├── project/            # 工程模型、编辑事务、.rcproj 归档与迁移
│   │   ├── bus/                # 统一总线目录和映射
│   │   ├── validation/         # 关联规则与诊断
│   │   └── export/             # 输出计划和依赖闭包
│   ├── modules/
│   │   ├── master-igh/
│   │   ├── master-ecm/
│   │   ├── eni/                # 只读解析及 profile
│   │   ├── urdf/
│   │   ├── hardware/
│   │   ├── joint-binding/
│   │   └── app-startup/
│   ├── adapters/               # browser / desktop / storage
│   ├── workers/                # XML、模型及批量校验
│   ├── schemas/                # 按目标版本管理
│   ├── styles/                 # DESIGN.md 对应主题与字号令牌
│   └── i18n/                   # 中文/英文
├── public/                     # 本地字体、图标、离线资源
├── templates/                  # 公开设备和机器人模板
├── src-tauri/                  # 桌面壳与文件能力
├── tests/
│   ├── fixtures/               # 已脱敏的双主站及 APP 样例
│   ├── contracts/              # 与消费端加载器对照
│   └── browser/                # Pages 子路径、离线、导入导出
├── docs/
└── .github/workflows/          # 校验、Pages 构建与发布
```

新增模块必须提供字段/版本说明、解析和导出契约样例、依赖声明及错误定位。原生平台调用仅在 adapters 和桌面壳中出现；模板随构建进入静态产物，不能仅存在源码目录而在离线运行时缺失。

## 11. 实施阶段与优先级

### 11.1 第一阶段：双主站完整离线闭环（P0）

1. 建立 Web 项目、工作台主题和公共领域核心，打通仓库子路径构建及 `.rcproj` 保存/打开/另存为/导出副本，支持资源打包、草稿恢复与完整性检查。
2. 实现 IgH 配置编辑、ECM YAML 编辑、ENI 只读解析和统一信号目录。
3. 实现 URDF 树、基础结构/参数编辑、3D 联动、Base/Tip 与文件导出。
4. 实现 Hardware、信号关联、Joint Binding 和 APP 启动配置。
5. 实现文件保留、跨文件校验、差异预览和运行包导出。
6. 实现 PWA 完整缓存、本地静态离线包与共用核心的桌面文件适配。
7. 完成两类主站样例、浏览器/桌面闭环及消费端无硬件兼容测试。

阶段成果必须同时覆盖两类主站，不把 ENI、URDF 编辑或 GitHub Pages 运行留到后续阶段。

### 11.2 第二阶段：效率与扩展（P1）

设备/机器人模板、ESI 候选导入、批量 Hardware 编辑、高级惯性/碰撞编辑、payload 等模块、版本迁移、桌面 Xacro 处理和更多 ENI profile。在线服务不是这些离线能力的前置条件。

### 11.3 第三阶段：受控在线集成（P2）

引入独立本机/控制器连接适配器，逐步支持设备扫描、SDK 实际信号核对和部署辅助。网页不能直接访问 EtherCAT 驱动或 POSIX 共享内存；在线能力需要明确连接目标、权限与接口，另行设计。多主站工程和远程部署按真实需求扩展。

| 能力 | 优先级 |
| --- | --- |
| GitHub Pages 独立配置闭环、离线运行方案 | P0 |
| IgH 与 ECM 类型选择、原生 YAML 输出 | P0 |
| ENI 只读展示、运行限制检查、字节不变导出 | P0 |
| URDF 树及基础动态编辑、3D、实际文件导出 | P0 |
| Hardware、关节绑定、APP 启动及跨文件校验 | P0 |
| 模块注册、未知内容保留和版本化接口 | P0 |
| `.rcproj` 单文件工程、跨端恢复、资源和草稿归档 | P0 |
| 高级模型编辑、模板、ESI、专用扩展编辑器 | P1 |
| 在线扫描、实机验证、远程部署、多主站 | P2 |

## 12. 测试与验收标准

### 12.1 部署与离线验收

- 在 `/rocos-configurator/` 下直接打开、刷新各 Hash 路由，字体、编辑器 Worker、3D 和模板均正常。
- Chromium、Firefox、Safari 的文件/ZIP 基线流程可完成配置；不支持目录 API 时自动使用基线入口。具体浏览器版本在发布时记录。
- PWA 缓存完成后断网重启，进入此前未打开的 P0 页面，完成导入、编辑、校验、导出；无运行时公网请求依赖。
- 新离线电脑使用静态离线包或桌面包完成首次运行，不依赖在线 npm 安装、CDN 或现场下载 WebView。
- 浏览器与桌面用同一输入和目标 profile 得到语义一致的输出；ENI 字节一致。清空缓存、存储超额、权限拒绝和外部文件冲突均有明确恢复路径。

### 12.2 双主站与 ENI 验收

- IgH 导入真实配置，编辑 master/PDO/SDO，导出 `igh.yaml` 并通过当前加载器的无硬件解析；验证空 entries 与按位 PDO，不错误标成已完成 APP 映射。
- ECM 导入真实启动 YAML 和 `eni7.xml`，修改允许的启动字段，导出 `ecm.yaml` 和原始 ENI，验证 `eni` 相对路径以及可选服务的 null/缺省行为。
- 本次核对样例 `eni7.xml` 有 7 个从站，固定地址 1001–1007；ProcessImage 含 56 个输入变量、35 个输出变量，两方向 ByteSize 均为 168。解析结果应一致，不能把所有候选 PDO 都计为有效变量。
- 只读 ENI 在树、属性、表格、源码和导出路径均不可被改写；重新导入导致的变更清单和 Hardware 失效状态正确。
- 注入非法 XML、未知版本、缺 ENI、末段重名、非字节对齐、地址不符合当前 ECM 假设、容量超限等用例，必须显示准确诊断。
- ECM 与 IgH 的同名信号、从站 ID 和周期等不混用；切换后端不会无提示覆盖旧配置或保留错误的“已通过”状态。

### 12.3 URDF 与 APP 验收

- Talon 等真实模型树状结构和 3D 一致；树与模型选中联动，长名称及复杂分支不丢节点。
- 修改 Joint origin/axis/limit、Link 名称、父子关系和 Mesh 路径后，树、预览和导出文件同步；3D 姿态滑块不修改文件参数。
- 新增、删除、重挂接和重命名支持撤销，能检测环、多个父节点、断链、重复名及无效 Base/Tip。
- 固定、continuous、mimic 和目标 APP 不支持的关节类型正确区分，控制链顺序与消费端一致。
- 验证关节顺序与总线不同的绑定，例如 `joint_1 → Drive 4 → Slave 4`；检查类型、方向、大小写及存储宽度。
- 导出后重新导入，已编辑内容一致，未修改的 YAML 字段/注释、URDF 扩展和资源不无提示丢失。
- 必要资源齐全的运行包移到新目录后能按消费端路径规则解析；外部资源配置包明确列出目标环境前置条件。

### 12.4 扩展与保真验收

- 以一个最小附加配置模块验证注册、导入识别、独立校验、依赖收集、UI 挂载和导出，无需修改主流程。
- 未知模块、未知字段和不支持的格式版本可原样保留并恢复；非法目标字段会阻止运行导出，不会被偷偷删除。
- 64 位 SDO 数值、XML 编码、中文路径、大小写冲突、巨大/损坏文件、ZIP 路径穿越等边界有明确处理。
- 源码错误缓冲区、异步解析过期结果、连续撤销和导出时快照一致性均需覆盖。

### 12.5 `.rcproj` 工程验收

- 在网页创建 ECM 工程并保存 `proj1.rcproj`，关闭页面、清除缓存后在另一台离线电脑打开，恢复主站 YAML、原始 ENI、URDF/Mesh/纹理、Hardware、Binding、APP 和附件；IgH 也完成同样流程。
- 打开 → 编辑 → 保存 → 重开后，字段和引用一致；ENI SHA-256 不变，未修改文件无信息丢失。修改归档外部文件名不影响打开。
- 包含无效 YAML 缓冲区、未提交表单、缺资源和未确认参数的工程可保存并恢复，诊断及待处理状态清晰；未应用源码不被悄悄当作运行配置。
- 区分保存、另存为、导出副本与复制为新工程的目标、UUID 和 snapshotId 行为；保存期间新增编辑仍显示未保存，同 UUID 的不同副本不互相覆盖。
- 浏览器下载、授权文件写入和桌面替换文案准确；取消、写入失败、磁盘不足、目标外部修改和应用崩溃时，旧归档及当前草稿可恢复。
- 普通解压工具能读取支持的条目，原生文件结构可检查；改名 `.zip` 不使容器获得额外信任，普通无 manifest ZIP 经“导入已有配置”转成新工程。
- 截断容器、重复路径、哈希不符、缺入口、超限、路径穿越和符号链接不进入正常工程；恢复模式只提取安全可验证内容，并另存新工程。
- 旧版迁移成功后另存，失败不改原包；新版未知契约仅原包复制；未知可选模块可完整保留，必要模块缺失时阻止运行导出。
- 工程归档携带实际使用的模板快照，升级模板不会改变重开结果；运行配置包不含编辑缓冲区与工具元数据。

### 12.6 首版完成判定

用户能在 Pages 和离线电脑上各完成一套 IgH 工程与一套 ECM 工程：从主站开始，配置 URDF、Hardware、绑定及 APP，保存为单个 `.rcproj` 并跨电脑重新打开继续编辑，再查看诊断和差异，导出对应主站文件及完整依赖。消费端兼容结果、未执行的 SDK/实机检查和外部资源依赖有记录。

视觉验收依据 DESIGN.md 覆盖浅/深色、中/英文、桌面/Pad/窄窗、键盘和触控。测试不启动真实机器人；文件校验通过不标记为实机运动安全验证通过。

## 13. 事实依据与待验证事项

### 13.1 本次核对基线

本次设计对照 2026-10-21 的本地工作区文件，以下 commit 用于定位版本；若工作区存在未提交更改，以核对时文件内容为准。配置 profile 实现和发布时须重新核对消费端。

| 来源 | HEAD | 主要核对入口 |
| --- | --- | --- |
| `/home/think/Documents/GitHub/rocos-ecm` | `e0e5e32` | `Main/Common/EcConfig.{h,cpp}`、`Main/Common/Linux/EcDemoMain.cpp`、`Main/ECM/EcDemoApp.cpp`、`include/rocos_ecm/shared_memory_config.hpp`、`config/config.yaml`、`config/eni7.xml` |
| `/home/think/Documents/GitHub/rocos-igh` | `3c92f2a` | `docs/pdo-config.md`、`src/pdo_config.cpp`、`src/pdo_config_file.cpp`、共享内存定义及示例配置 |
| `/home/think/Documents/GitHub/rocos-app` | `7093bcd` | `src/app_config.hpp`、`src/hardware.cpp`、`src/joint_binding.cpp`、`config/` 内启动/硬件/绑定样例 |
| 本仓库 | — | [DESIGN.md](../DESIGN.md)，核对日期 2026-10-21 |

上文平台设计附有 GitHub、Vite 和 MDN 官方资料链接；它们说明平台机制，不构成当前项目已经实现这些能力的证明。

### 13.2 实现前与发布前须完成的验证

1. 固化目标 APP 与两类主站的配置/ABI 兼容矩阵，并记录实际编译选项；当前源文件核对不能替代进程间 ABI 测试。
2. 对 ECM ENI profile 核对有效 PDO 分配、对象索引、周期单位和 SDK 返回元数据的对应关系；缺少依据的字段保持未知。
3. 确认 APP/KDL 对复杂关节、mimic 与扩展 URDF 的支持范围，建立真实模型契约样例。
4. 建立可在无硬件环境运行的消费端校验入口，区分文件解析、SDK 检查和硬件运行测试。
5. 核对字体、示例模型、ENI 与 SDK 资料的分发许可；公开 Pages 仅打包允许分发的资源和脱敏样例。
6. 验证桌面离线安装包的运行时依赖、浏览器存储配额和大模型性能，确定发布支持范围与文件大小限额。

这些事项以版本化适配器和测试结果逐步收敛；遇到未验证能力应如实显示，不通过自动改写 ENI 或伪造信号映射掩盖差异。
