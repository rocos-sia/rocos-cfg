# Hardware 与 Joint Binding 配置

当前实现依据 `rocos-app` 提交 `7093bcd` 的 `src/hardware.cpp`、`src/joint_binding.cpp`、`src/robot.cpp` 和 `src/position_controller.cpp`。配置器区分原生解析器接受的文件与可以完整交给默认位置控制器使用的配置：原生解析器允许缺省信号并提供机械参数默认值，但这些默认值不能证明实际机械结构已配置正确。

## 配置流程

1. 先配置主站和 URDF 的 Base/Tip 控制链。
2. 在硬件页新增设备，选择实际从站。Driver 可明确选择未绑定的控制关节，预览后可带入标准 URDF `<limit>` 明确提供的位置、速度、力矩限制，并建立显式绑定；缺省值留空待核对，不读取旧 `<hardware>` 中的值。PDO 只从唯一匹配的 CiA 402 对象索引/子索引或相同变量名中推荐；名称仍为总线运行时变量名。所有候选都需要核对。
3. 填写机械比例、编码器换算、零点、力矩换算以及 acc/jerk。没有依据的参数保持未配置，不从通用驱动器默认值推导。旋转关节使用 rad，直线关节使用 m；单位名称不会让 APP 自动进行换算。
4. 核对信号方向、类型、完整位宽与存储字节数，确认换算和限位。修改 Hardware、Binding、URDF、主站/ENI、目标版本或 APP 控制链引用会清除人工确认；修改工程名称、HTTP 或 payload 不影响该确认。撤销会恢复与被审核配置对应的确认状态。
5. ID 变更和设备删除先显示影响；关联绑定在同一次事务中修改，支持撤销。已存在的 PDO 名称在 ID 变更后保留并重新校验。相关文件有未应用源码草稿时，表单事务拒绝覆盖草稿。

绑定表支持非连续 Driver ID，并将模型顺序与总线顺序分开。当前 APP 使用 Hardware ID 直接查找同 ID 的运行时 Slave。修改已有绑定保留 YAML 注释和扩展字段。

工程入口缺少绑定文件时，硬件页按当前 APP 的回退规则显示建议：控制关节数量必须等于 Driver 数量，按模型控制链顺序对应 **Hardware YAML 中 Driver 的出现顺序**，不按 ID 排序或名称猜测。用户预览后可生成显式绑定文件，并同步 APP 引用；不覆盖同路径已有文件。缺少显式绑定的工程仍不能导出被标记为有效的运行包。

## 信号与机械参数

| 类型 | 原生配置与完整性要求 |
| --- | --- |
| Driver | 默认位置控制至少需要输入 `status_word:uint16`、`position_actual_value:int32`，输出 `control_word:uint16`、`mode_of_operation:int8`、`target_position:int32`；这些是配置器的运行完整性要求，不是 YAML 解析器的必填条件 |
| Driver 可选输入 | `velocity_actual_value:int32`、`torque_actual_value:int16`、`load_torque_value:int16`、`secondary_position_value:int32`、`digital_inputs:int32`、`digital_outputs:int32` |
| Driver 可选输出 | `target_velocity:int32`、`target_torque:int16`、`digital_outputs:int32` |
| FT | 只有 `inputs.fx/fy/fz/tx/ty/tz` 六路 int16；`offset` 同名六轴偏置，原生缺省为 0；无 outputs、无单独缩放系数 |
| IO | DI/DO 使用 32 bit 位掩码；DO 需要 inputs.digital_outputs 反馈和 outputs.digital_outputs 命令；模拟量使用 int16 |

IO 数字通道配置范围为 0–32。虽然当前 APP 解析器接受多个模拟通道，运行实现对各通道访问同一个 int16 指针，因此配置器将独立模拟输入/输出通道数限制为 0–1；不会把样例中的多通道数字视为已支持的独立通道。多个 FT 的配置保留，但诊断会提示当前 `GetWrench()` 只读取第一个。

已知数据类型按符号与位宽校验；数字位掩码允许同宽有符号或无符号整数。IgH 文件没有声明数据类型时给出待核对警告，不能从长度推断已验证符号。不同控制输出不得指向同一 PDO 变量。

校验要求明确填写有限限位、非零机械换算、int32 零点，并检查位置、速度和力矩限值换算后的整数范围。`torque_source` 仅提供 `load_torque` 和 `secondary_position`；对应输入缺少时提示负载力矩读取会返回 0。未知原生忽略字段保留并报告，不假称其生效。

硬件参数和 EtherCAT 数据关联以 `hardware_config.yaml` 为准，关节绑定以 `joint_binding.yaml` 为准。URDF 残留的 `<hardware>` 作为不透明扩展保留，不解析其限位、主站/从站、PDO 或换算字段，不参与绑定、校验、资源依赖扫描和草稿生成，也不自动迁移或覆盖 YAML 配置。标准 URDF `<limit>` 仍供模型编辑、预览和差异核对使用；continuous 关节没有标准 limit 时保持空值，不从旧扩展或 APP 默认值补齐。读取与工程往返保留原文件；编辑标准字段时保留旧扩展内容。

测试锁定的旧版 `rocos-app@7093bcd` Model 仍读取 `<hardware><limit>`；原生测试记录这一旧消费端差异，不将它作为配置器的解析规则，也不据此宣称新版 APP 的限位优先级已经验证。

`cntToUnit` 在 int32 中减去零点后才转 double，极值反馈可能溢出，速度反馈也调用该函数；非零零点会提示这一消费端行为。本工具的静态范围检查不代替反馈范围、驱动器参数及实机验证。

## YAML 数值保真

APP 的 yaml-cpp 整数解析与 YAML 1.2 不同：`010` 表示八进制 8，`"0x10"` 表示 16，`1.0` 不能作为 int32。配置器从源标量读取 ID、零点、通道数和绑定 ID，处理嵌套别名，并检查 int32 边界。表单事务将已识别整数字段按原生含义写为规范数值，避免编辑别的字段时把原生 8 改成 10。无效整数保留无效含义，不能经重新序列化意外变成有效值。未应用的源码仍以草稿保留。

## 无硬件消费端测试

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app npm test -- tests/consumer/app.test.ts
```

需要 `g++`、`nm`、yaml-cpp、KDL 和 Eigen 开发库/头文件，以及目标仓库中 spdlog 头文件。测试要求目标源码 HEAD 为 `7093bcd`，且 `src` 无本地修改。编译原始 `hardware.cpp` 与 `joint_binding.cpp`，仅调用公开静态 `Hardware::LoadConfigFromYAML` 和独立 `JointBinding`。测试替换日志出口，不启动日志线程或创建日志文件；链接时丢弃未使用函数，并检查二进制不包含 Hardware 构造和状态机线程入口。

覆盖原生整数语法、解析缺省、FT 偏置、IO 反馈、导出运行包的 Hardware/Binding、模型顺序与非连续 ID，以及八进制/别名经表单编辑后的保真。解析测试接受某配置并不意味着相应物理通道或机械参数可安全运行。未设置环境变量时明确跳过；默认 CI 不获取外部消费端仓库，也不会宣称该层已执行。

APP Model 的独立测试：

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app npm test -- tests/consumer/model.test.ts
```

额外需要 urdfdom、TinyXML/TinyXML2、NLopt、Boost date_time/system 开发库。测试编译原始 Model、Logger、仓库内 KDL parser 和 TRAC-IK，构造本地运动学模型，不构造 Robot/Hardware、不运行主站。日志只写入临时测试目录。覆盖实际 Talon 七关节链、XML 顺序与控制链顺序、固定段、分支、旧消费端扩展限位/默认值与配置器忽略策略的差异，以及无效模型。mimic 不会由当前 Model 作为耦合自由度处理，floating/planar 会被 KDL 当作固定段；配置器因此仍拒绝将这些类型用于控制链。

尚未覆盖所有原生异常/类型组合；ECM SDK、共享内存 ABI 和实机行为另行验证。
