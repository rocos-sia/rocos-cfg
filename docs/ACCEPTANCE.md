# 首版验收跟踪

以 [软件设计文档](ROCOS%20Configurator%20软件设计文档.md) 第 11.1 节 P0 与第 12 节为首版验收依据。下表用于定位实现、可重跑的证据和剩余工作，不代表所有平台已通过，也不将测试文件的存在视为执行成功。P1/P2 仍按设计中的后续阶段推进。

| 设计要求 | 当前实现与验证入口 | 尚需完成或单独记录 |
| --- | --- | --- |
| 12.1 Pages 子路径、缓存与离线基线 | `vite.config.ts`、`tests/offline/offline.spec.ts`；本地生产构建验证 `/rocos-configurator/`、缓存完整性、断网重载、后台解析和工程恢复 | GitHub Pages 实际发布与远端工作流未执行；本地地址的成功不能证明仓库 Pages 权限配置 |
| 12.1 浏览器兼容 | `tests/browser/` 与 `playwright.compat.config.ts`；Chrome、Playwright Firefox/WebKit 已有本地执行记录 | 实际 macOS/iOS Safari 尚无验收记录；Playwright WebKit 不替代它 |
| 12.1 首次离线运行、桌面文件一致性 | 静态包 `scripts/package-offline.mjs` / `verify-offline-package.mjs`；Linux 原生文件与打包程序测试见 [DESKTOP.md](DESKTOP.md) | Windows 构建、断网安装和运行；Linux 缺依赖电脑的完整交付介质；按版本记录的本地产物与验证记录见 [BUILD-VERIFICATION.md](BUILD-VERIFICATION.md)，后续修改仍须重新构建 |
| 12.2 IgH、ECM 与 ENI | `tests/igh.test.ts`、`ecm.test.ts`、`domain.test.ts`、`tests/consumer/`；PDO/SDO、原生标量、ENI 变量及限制；新增双主站教学示例及原始加载器验证，见 [EXAMPLES.md](EXAMPLES.md)；浏览器主站编辑用例 | SDK 元数据与 ENI profile 的实测比对未执行；原始头文件的私有映射交换测试已通过，见 [ABI.md](ABI.md)；实际二进制、命名 IPC 与真实主站运行仍未验证 |
| 12.3 URDF、Hardware、Binding 与 APP | `tests/robot-edit.test.ts`、`model-limits.test.ts`、`hardware.test.ts`、`app-config.test.ts`、`resources.test.ts`；模型和主站浏览器用例；真实 Talon 及原始消费端 Model 测试 | 原始 APP 总线定位函数与首从站限制已有回归；完整目标环境路径解析与实际二进制 ABI 仍需独立验收；实机运动测试不在配置器自动化中执行 |
| 12.4 扩展、保真与异步一致性 | `tests/modules.test.ts`、`provenance.test.ts`、`archive-tasks.test.ts`、`analysis.test.ts`、`store.test.ts`；对应浏览器用例 | 后续适配器仍需自己的契约样例；不能从最小 payload 模块推断所有扩展格式已支持 |
| 12.5 归档、恢复与迁移 | `tests/archive.test.ts`、`archive-recovery.test.ts`、`file-access.test.ts`、`migrations.test.ts`，以及浏览器与 Linux 原生保存/恢复用例 | 当前 v1 是首个格式，迁移框架使用合成版本链验证；真实历史版本转换须随首次格式升级提供固定样例，见 [MIGRATIONS.md](MIGRATIONS.md) |
| 12.5 跨电脑继续编辑 | 归档保留配置、资源、草稿及模板快照；已有浏览器/桌面往返和静态离线包冷启动验证 | 仍需将 IgH、ECM 各一套完整工程在独立离线电脑上重开、继续编辑并导出，不能只以同机新标签页替代 |
| 12.6 视觉、语言与输入方式 | 主题、窄窗布局、键盘、语言和 3D 用例在 `tests/browser/`；语言覆盖详见 [I18N.md](I18N.md) | 资源、源码、模块和导出错误已接入模板；通知与确认弹窗已有跨浏览器即时语言切换、计时及工作区保护测试；归档、恢复和导入摘要已有语言测试；双主站单轴示例已有 Tab/Shift+Tab 键盘和 Pad 触控仿真下编辑、存档、全新上下文重开与运行导出检查；复杂树/多设备的完整输入覆盖、实际 Pad/软键盘及全部尺寸/主题人工视觉验收仍需完成 |
| 13.2 外部来源与发布边界 | 目标版本锁定在源码规则与消费端测试中；真实模型/ENI 测试从本机外部仓库读取 | 发布前重新核对目标版本、构建选项、ABI、分发许可及离线包依赖；未验证 SDK/实机项保持“未执行” |

## 执行约定

- `npm test` 不设置消费端路径时，会明确跳过原始 C++ 消费端测试；报告中不能把这些跳过项算作通过。运行命令与依赖见 README 和各专题文档。
- 浏览器普通开发测试、生产 Pages 离线测试和解压静态包冷启动是不同检查。修改构建入口、缓存、Worker、语言字典或资源打包后，应运行对应产物检查。
- 原生包记录应用版本、平台、构建方式、文件哈希及实际运行结果。旧包不因源码更新自动成为新版本产物。
- Windows、Safari、实际 Pages、独立离线电脑与 SDK/实际二进制 ABI 等缺少环境的项目保留为未验证，不以配置文件、构建工作流或模拟结果替代。
- 仅当第 12.6 节的两类主站全流程及上述必需门槛具有对应证据时，才能声明首版验收完成。
