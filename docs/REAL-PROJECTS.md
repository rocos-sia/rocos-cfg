# 本机真实七轴工程回归

`tests/browser/real-project.spec.ts` 从本机三个源码仓库读取真实 Talon 配置、模型和附件，在浏览器中执行导入、编辑、归档、全新上下文重开及运行包导出。不连接控制器，不执行脚本或 HMI，不启动 EtherCAT。未设置全部路径时，两项用例明确跳过。

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app \
ROCOS_IGH_SOURCE=/path/to/rocos-igh \
ROCOS_ECM_SOURCE=/path/to/rocos-ecm \
npm run test:ui -- tests/browser/real-project.spec.ts --workers=1
```

兼容引擎使用相同环境变量和 `npm run test:compat -- tests/browser/real-project.spec.ts --workers=1`。需要本机浏览器及消费端测试所需的 Git；本用例本身不编译 C++。原始加载器和 ABI 检查另运行 `npm test -- tests/consumer`，不能以浏览器结果代替。

## 输入和来源

- APP：`7093bcd`，读取 `config/config.yaml`、Hardware、Joint Binding、payload、`config/scripts/`、`web/`，以及 Talon URDF 和八个 STL。测试将 STL 放入 `models/talon/meshes/`，通过界面添加 `self_robot_description → models/talon` 映射。
- IgH：`3c92f2a` 的 `config/talon_pdo.yaml`，共 37 个输入文件。
- ECM：`config/config.yaml` 与 `config/eni7.xml`，共 38 个输入文件。适配规则仍锁定 `e0e5e32`；本轮本机 HEAD 为其后代 `589d2a9`，加载器 `.cpp/.h` 和共享结构头文件与基线逐字节一致。

`tests/consumer/source.ts` 同时检查祖先关系、参与核对文件的工作区状态、普通文件类型及基线字节，记录实际 HEAD、基线和 SHA-256。相关源码变化或无关历史会拒绝核验；这不表示自动支持新版规则，也不修改已保存工程中的 profile。APP/IgH 原始消费端测试保留各自的严格提交检查。

两套工程的资源文件合计 53,229,609 字节。原始资产不复制进 Git、公开示例、应用或离线包。原始 ECM 配置可能包含许可证值；`test-results/` 中的工程、运行包、截图和 trace 仅供本机验证，分享前须单独检查。

## 原始错误与显式测试操作

第一份 `unreviewed.rcproj` 保留所有输入文件的 SHA-256；缺少人工确认或映射有误不妨碍保存工程。

| 输入组合 | 原始阻塞错误 | 后续测试动作 |
| --- | --- | --- |
| ECM + APP | 7 项设备人工确认缺失 | 修改周期、HTTP 端口和第七关节位置，然后逐设备操作确认控件 |
| IgH + APP | 56 项信号无法映射 + 7 项人工确认缺失 | 42 项名称按相同从站、方向、位宽的唯一大小写候选显式选择；14 项可选反馈显式清空，再操作确认控件 |

IgH 原始 PDO 不提供 APP 所引用的 `Analog Input 1` 和辅助位置反馈；其 `Load Torque Value` 为 32 bit，不能替代 APP 的 16 bit 负载反馈。本测试不修改 PDO 或伪造位宽来消除错误。清空可选反馈后，仍保留七项 `hardware.torque-input` 警告，APP 的相应负载读取将返回零。

`test-reviewed.rcproj` 和 `TEST-ONLY-runtime.zip` 只证明界面修复、确认状态和导出机制。测试点击“已人工核对”不等于机械参数已经获人工核验；删除反馈也不是对真实机器人控制策略的认可。这些副本不能作为设备部署配置。

## 检查范围

- 编辑主站周期为 1500 μs、APP HTTP 端口为 8099、第七关节位置为 `0 0.231 0`，重开后核对值。
- 原工程归档与未修改的资源、脚本、HMI、ENI 逐文件核对 SHA-256；运行包仅含运行配置和依赖，不含工程编辑元数据。
- URDF 中旧 `<hardware>` 的原文在标准参数编辑和运行包路径改写后保持不变；单元回归另覆盖命名空间、注释、CDATA、嵌套节点、自闭合及 CRLF。
- 连续编辑时，未修改资源在撤销历史中共享一份字节；IgH 达到 40 步历史。事务仍先深拷贝并比较内容，优化的是历史保留内存，尚未消除每次编辑的临时复制与扫描。

执行结果写入各用例的 `test-results/ui/` 或 `test-results/compat/` 输出目录，`report.json` 留存来源证明、输入哈希、显式修正及历史资源副本数。按版本的实际执行记录见 [BUILD-VERIFICATION.md](BUILD-VERIFICATION.md)。

这仍是同机浏览器自动化，不替代独立离线电脑往返、实际 Safari/Pad、Windows、SDK 和真实控制器验收。诊断列表到具体字段的跳转以及其他页面的布局检查仍需补齐，见 [ACCEPTANCE.md](ACCEPTANCE.md)。
