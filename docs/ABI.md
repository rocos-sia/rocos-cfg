# 主站与 APP 共享内存契约验证

配置文件可解析不等于主站和 APP 能正确交换过程数据。本仓库用三个消费端的原始头文件分别编译探针，检查结构布局，并通过私有临时文件的 `MAP_SHARED` 映射进行两个进程间的读写。APP 探针还链接原始 `Hardware::scanForEcatBus`，检查定位行为。

这组测试不启动控制器，不调用原始 `init/getInstance/createSharedMemory`，不创建或打开控制器命名共享内存、信号量，也不构造 Hardware 或启动其线程。链接后用 `nm` 检查这些入口未被引入。测试文件在临时目录内创建并清理。

## 可复现入口

需要 Linux、Node.js 22.12+、g++、nm、yaml-cpp 和 Eigen 开发头文件，以及 APP 源码内的 spdlog 头文件。当前测试使用 `/usr/include/eigen3`。APP、IgH 源码仓库须位于指定提交。ECM 允许基线的后代提交，但原始共享结构头文件必须逐字节等于基线；参与核对的源码文件不得有本地修改：

| 消费端 | 提交 | 头文件 |
| --- | --- | --- |
| APP | `7093bcd427f197ff3b28a60ebb1a00bfef426fef` | `src/shared_memory_config.hpp` |
| IgH | `3c92f2aad85ccdd60a22ccf60fde4ed2bd3ceae9` | `src/shared_memory_config.hpp` |
| EC-Master | `e0e5e32340c55981b4a6048ff05d87c87d8e7fba` | `include/rocos_ecm/shared_memory_config.hpp` |

```sh
ROCOS_APP_SOURCE=/path/to/rocos-app \
ROCOS_IGH_SOURCE=/path/to/rocos-igh \
ROCOS_ECM_SOURCE=/path/to/rocos-ecm \
npm test -- tests/consumer/abi.test.ts
```

2026-10-22 复跑时 ECM 实际 HEAD 为 `589d2a9`，原始共享结构头文件与表中 `e0e5e32` 相同；报告的 `baselineProof` 分别记录实际 revision、基线和文件哈希。工程目标规则仍保留原基线。

未提供全部源码路径或运行平台不是 Linux 时，六项测试明确跳过。执行后 `test-results/consumer-abi/report.json` 留存编译器、目标架构、实际参数、源码提交及 SHA-256、字段布局、通过项和报告状态；该文件不进入工程归档或公开应用包。

## 已执行的检查

本机使用 GCC 11.4.0、`x86_64-linux-gnu`、LP64 小端布局。IgH/APP 以 C++17 编译，ECM 以 C++11 编译，均使用头文件默认容量宏。六项测试通过：

- IgH、ECM 各自与 APP 对比所有共享结构字段偏移、大小、对齐、基础类型、状态常量及容量；同时核对配置器的容量限制。
- 两类主站探针分别保持映射存活，APP 探针读取全部 50 个从站、每方向 25 个变量、1/2/4/8 字节过程数据、UTF-8 与最大长度名称，回写状态请求、周期统计重置标志、有符号 32 位及 64 位输出；原生产者进程确认写入可见。
- 原始 APP 定位函数识别有效结构；首从站缺输入或输出时不能识别该结构的起点。
- 将 APP 探针的 `MAX_PD_NAME_LEN` 改为 80 后，布局比对失败，测试夹具在映射前拒绝尺寸不一致的访问，文件内容保持不变。这是测试夹具的保护，不代表原始 APP 自带 ABI 握手。

| 结构 | `sizeof` | `alignof` |
| --- | ---: | ---: |
| `PdVar` | 84 | 4 |
| `Slave` | 4292 | 4 |
| `EcatBus` | 214672 | 8 |

上述尺寸只适用于本次编译参数，不能硬编码为跨平台承诺。

## 首从站限制进入配置校验

当前 APP `7093bcd` 的 `Hardware::scanForEcatBus` 要求第一个从站的 `input_var_num` 和 `output_var_num` 均大于零且不超过容量。首从站仅有单向 IO 时，APP 不能可靠定位实际总线结构。

当主站解析有效且当前 APP 规则受支持时，配置器检查首从站：明确缺少任一方向变量，产生 `app.bus-location` 错误并阻止完整运行包导出；IgH 显式空 PDO 条目表示运行时发现，使用 `app.bus-location.pending` 警告，不将未知数量当作零。已有解析错误或 ENI 变量无法关联时，保留原解析诊断，避免追加未经证实的定位结论。

用户仍可保存 `.rcproj` 留存问题配置。配置器不重排从站、不修改 ENI、不添加虚拟 PDO。相关回归见 `tests/bus-location.test.ts`。以后适配修正了定位逻辑的 APP 版本时，需重新核对这项限制。

## 尚未验证的范围

本结果证明指定原始头文件在本机编译参数下的布局与私有映射交换行为。尚未取得实际控制器可执行文件的编译参数及运行证据，未验证目标系统中的命名共享内存创建/重连、信号量时序、EC-Master SDK、设备发现和现场设备通信。不同编译器、架构、打包对齐及容量宏可能改变 ABI。

因此工程目标中的 `abi: unverified` 保持不变，运行包继续提示目标 ABI 未验证。部署前应针对实际二进制和构建参数生成对应证据，再完成受控目标环境验证；本测试的成功不能自动把任意工程标为已通过实机验证。
