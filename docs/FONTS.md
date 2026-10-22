# 本地字体分发

应用使用 Alibaba PuHuiTi 3.0 的原始 WOFF2，字体内部版本为 3.01。400、500、600、700 四个字重随源码、静态构建和桌面程序分发，合计 21,768,016 字节（约 20.8 MiB）。没有转换格式、裁剪字符或修改字体元数据。

来源与声明见 [第三方资源声明](../THIRD_PARTY_NOTICES.md)。`public/licenses/font-sources.json` 记录官网下载 URL、文件长度、SHA-256 和完整中英文声明的来源/哈希；`public/licenses/AlibabaPuHuiTi-3.0.txt` 保留声明全部段落。字体按原声明使用，不适用本仓库的 MIT 许可。构建及运行不需要从字体官网取文件。

`.gitattributes` 固定这些第三方资源的字节，不对声明和清单做自动换行转换；声明文本保留来源中的段落空白，避免 Windows 检出改变声明哈希。

`src/styles/fonts.css` 声明四个 `@font-face`，采用 `font-display: swap`。Vite 将字体复制为带内容哈希的资源，并重写 CSS 相对 URL；Pages 子路径、相对路径离线包和 Tauri 使用同一套资源。工作台、Ant Design 和 CodeMirror 通过 `--config-font-family` 共用字体栈，编辑器滚动区继承它。未包含 RegularL3、其它字重和其它语种字体；未覆盖的字符及字体加载失败时使用系统后备字体。

Service Worker 的构建清单包含全部四份字体、来源清单和声明，即使当前页面未使用某个字重也先缓存。字体缓存缺项会取消“已可离线使用”状态，可联网修复。首次缓存体积包含这些字体；应用缓存与 `.rcproj` 工程备份仍相互独立。

验证入口：

- `tests/browser/typography.spec.ts`：四个字重实际解码；Chrome 另检查实际用于绘制的字体；中英文源码按屏幕字符边界点击、选择、替换及缩进；语言/主题切换；下载失败后的配置流程回退。
- `tests/offline/offline.spec.ts`：子路径字体预缓存及缺项修复；清除 HTTP 缓存后断网新标签页重启，字体响应来自 Service Worker，声明可读取。
- `scripts/verify-offline-package.mjs`：实际 ZIP 中逐份核对字体与声明哈希，在禁止外网的解压冷启动中验证字体解码及工程闭环。
- `scripts/verify-desktop.mjs`：最终 Linux 程序解码全部字重，读取内嵌的来源清单和完整声明并核对哈希，再执行原生配置流程。

各版本实际执行结果见 [构建验证记录](BUILD-VERIFICATION.md)。Playwright WebKit、同机解压包和 Linux 测试不替代真实 Safari、Windows 或独立离线电脑验收。
