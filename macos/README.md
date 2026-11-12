# Typora 插件 macOS 安装

安装一次后，从 Finder 或 Dock 打开原来的 Typora 即可。安装器把插件接入现有的 `/Applications/Typora.app`，由 macOS 启动所需的后台服务。

首次安装需要 Python 3、Xcode Command Line Tools，以及 Node.js 22.20 或已有的 Visual Studio Code。退出 Typora，在项目目录运行：

```sh
python3 -B macos/install.py
```

用原来的 Typora 图标打开应用。正文普通右键会在同一张原生菜单中显示 Typora 的剪切、拷贝、粘贴等命令和插件分组。按住 **⌥** 右键可只看 Typora 自带命令，**⌘⇧M** 可单独打开插件分组。右下角齿轮打开插件设置，**⌘⇧J** 打开命令面板。

在代码块里右键打开「Carbon」。可选择 PNG 或 SVG，图片保存到 `~/Library/Application Support/Typora Plugin/user_space/carbon-temp`。「主题」提供 Carbon 官方的 29 套配色，「字体」读取本机已安装的字体。选项会用于后续导出。SVG 引用字体名称，PNG 则保存渲染后的外观。

Windows 版与当前 Mac 版的差异和实测范围见 [67 项功能对照](./Windows与macOS功能对照.md)。

安装会重新签名本地 Typora，并把原始签名版本备份在 `~/Library/Application Support/Typora Plugin/original.zip`。Typora 官方升级如果替换了应用，可以再运行安装脚本。命令面板的「升级插件」会暂存能合并的上游更新，退出 Typora 并重跑安装脚本即可应用。

需要卸载时，退出 Typora 并运行下面的命令。安装器会恢复备份并停止插件服务。

```sh
python3 -B macos/install.py --uninstall
```

## 验证记录

- 停止插件后台服务后，直接打开 `/Applications/Typora.app` 可恢复服务。已在编辑区确认 **⌘⇧J** 打开插件命令面板，**⌘⇧P** 打开 Typora 的页面设置。临时测试应用通过了安装、启动及卸载后的签名验证。
- 在 Apple 芯片与 Typora 1.14.15 上，47 个默认启用插件完成初始化。开启全部用户功能后，67 个插件全部完成初始化。内部调试插件 `test` 在两次验证中均关闭。
- 实机打开过设置和命令面板，看到标题编号、代码块工具栏和 Chart.js 图表。二进制文件往返、目录条目类型和 Markdownlint 结果传递通过独立测试。
- 实机 Typora 对已认证的本地 JSON-RPC 返回 `pong`，拒绝未认证请求。通过其导出插件嵌入了本地 PNG，解码后与源文件逐字节一致。
- 从 Typora 的「文件 → 导出」实际保存了样例 HTML 和 PDF，核对了 HTML 中的图表 PNG 和 PDF 正文。验证了 macOS 标签页的创建和切换。
- 命令面板的更新入口实际连通 GitHub，并显示中文结果；测试用的新版归档通过合并、冲突拦截及暂存检查。GitHub 当前没有比适配基线更新的版本，因此真实新版本的升级仍待验证。
- 已在原应用实测普通右键同时显示 Typora 自带命令和插件分组，能从原生子菜单切换模糊模式和导出 Carbon SVG。代码块右键提供 PNG、SVG、主题和本机字体，正文右键只显示插件分组和 Typora 命令。插件的文件面板与确认框、跨窗口细节及第三方平台发布仍需分别验收。

- [上游 obgnail/typora_plugin（7b3b791）](https://github.com/obgnail/typora_plugin/tree/7b3b7918aee89f7d823c3a01aa426e3b05e2bc93)
- [macOS 兼容层基于 bfyes/Typora-plugin-on-Mac（dd09238）](https://github.com/bfyes/Typora-plugin-on-Mac/tree/dd09238e624784884f536742082b380d79da1d56)
- [Apple Human Interface Guidelines — Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
