# 示例工程

启动页或工程总览的“打开示例”提供 IgH 与 EC-Master 两套自包含教学工程。每次打开生成新的工程 UUID、快照和文件 ID；已有工作区通过通常的“切换工程”确认处理。顶部显示“教学示例”，此标识依据归档中的模板使用记录，保存重开后仍保留。

两套工程都包含单旋转关节 `joint_1`、盒体几何、显式 Driver 映射与绑定、APP、payload、Lua 附件及本地 HMI 页面，不需要外部资源。IgH 配置含显式 PDO 条目；ECM 配置含启动 YAML 和只读 ENI 过程映像。ECM 示例 ENI 是本项目编写的解析教学数据，不是 SDK 工具生成或实机验证过的网络配置。

机械换算、零点和限位为教学数值，默认不留存人工确认。可随时下载 `.rcproj`；要查看运行包，应先核对示例参数，再在 Hardware 页显式确认。确认仅解除配置器的人工复核门槛，不代表设备验证通过。用于实际项目时，须替换为实际控制器、ENI 与设备参数。

定义位于 `templates/projects/teaching.v2.json`，通过共享领域核心生成，随应用与离线缓存一起打包。使用时将完整定义、版本、所选主站及输出文件 ID 归档到 `project-data/templates/`；重开时保留已有配置，不重新套用当前模板。示例不执行 Lua/HTML，也不在浏览器启动主站。

`examples.test.ts` 检查依赖完整、仅有人工复核门槛、模板快照留存、独立工程身份及 ENI 保真。原始 C++ 消费端测试另检查两套示例的主站启动 YAML、APP、Hardware/Binding 与 Model；ECM 启动加载器只检查 ENI 可读，不能替代 SDK 语义验证。

`examples-flow.spec.ts` 通过界面按主站、模型、APP、Hardware 顺序编辑，使用键盘 Tab/Shift+Tab、方向键、Enter/Space，或 1024px Pad 触控仿真，下载工程后在本机全新存储上下文重新打开并导出运行包。全新浏览器上下文不替代另一台电脑；触控仿真不替代实际 Pad、软键盘和 Safari。离线测试另检查完整缓存后断网重载仍能打开、编辑和导出两套示例。

## Talon 七轴完整配置示例

“打开示例”顶部提供 **打开 Talon IgH 示例** 与 **打开 Talon ECM 示例**。两者均包含用户于 2026-10-22 提供的 `talon.rcproj` 目录中的完整配置与模型，仅活动主站入口不同。打开后可查看 7 个从站、7 个驱动器、`joint_1`–`joint_7` 的显式绑定，以及 8 个连杆的 STL 三维模型；IgH 有 77 个过程信号，ECM 有 91 个过程信号。

资源位于 `public/examples/talon/`，清单及 SHA-256 位于 `templates/projects/talon.v1.json`。资源随 Web / Tauri 构建打包，并进入离线缓存。每次打开校验所有文件并创建独立工程和文件 ID；保存后的 `.rcproj` 自包含全部资源，不再依赖示例目录或用户原始路径。另一套主站配置仍保存在工程中，但不进入当前主站的运行依赖闭包。

整理范围：

- `app/hardware_talon_config.yaml`、`app/joint_binding.yaml`、`igh/talon_pdo.yaml`、`ecm/eni7.xml` 和 URDF 保持原始字节。ENI 为用户提供的文件，不是教学示例的合成 ENI。
- 8 个 STL 保持原始字节，移至 `app/talon/meshes/`，并添加 `self_robot_description → app/talon` 包映射，匹配 URDF 已有的 `package://self_robot_description/meshes/…` 引用。
- ECM 启动配置仅清空原许可证值。其他参数保留，包括 `link: IntelGbeRec`。
- 原目录没有 APP 启动配置，补充 `app/config.yaml`，引用真实硬件、绑定和模型，控制链为 `base_link → link_7`。同时补充零负载 `app/payload.yaml`、含说明文件的脚本目录及 HMI 占位页；这些是示例默认项，不是用户原始配置或完整控制界面。原 `mujoco/` 为空，没有可纳入的文件。

ECM 目标规则已按 `rocos-ecm@d85a6f3` 更新为 v2，支持字符形式的 `link`，Talon 的 `IntelGbeRec` 原样保留并可在表单中查看和选择。两种工程的原始信号映射均通过当前校验，但仍保留 7 个驱动器的人工复核门槛，不自动确认机械参数。人工确认后可生成运行包；这不代表设备或 SDK 验证通过。

`tests/talon-example.test.ts` 覆盖完整依赖、控制链、双主站留存、原始资源字节、独立副本、校验诊断和归档往返；`tests/browser/talon-example.spec.ts` 覆盖示例入口、模型加载、保存与新上下文重开。资源或整理规则变更应新增模板版本及相应清单，历史工程不自动重新生成。
