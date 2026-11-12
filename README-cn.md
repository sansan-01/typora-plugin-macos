[English](README.md) | 简体中文

<div align="center">
  <a href="https://github.com/sansan-01"><img src="assets/macos/maintainer-avatar.png" alt="sansan-01" width="80" height="80"></a>
  <h1>Typora Plugin for macOS</h1>
  <p>装进你现有的 Typora，继续从 Dock 或访达打开原来的应用。</p>
  <p>
    <a href="https://github.com/sansan-01/typora-plugin-macos/releases">Releases</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/issues">Issues</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/stargazers">Stars</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/archive/refs/heads/macos-maintained.zip">下载源码 ZIP</a>
  </p>
</div>

## 致谢

感谢 **obgnail** 和上游贡献者开发 Typora Plugin。本项目由 **sansan-01** 在原项目基础上修改和维护，面向 macOS。[原项目 obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) · [维护者 sansan-01](https://github.com/sansan-01)

也感谢 bfyes 的 macOS 兼容工作，以及 Carbon 项目提供的主题配色。[Typora-plugin-on-Mac](https://github.com/bfyes/Typora-plugin-on-Mac) · [Carbon](https://github.com/carbon-app/carbon)

## 安装

实机验证环境为 **Apple 芯片 Mac、Typora 1.14.15**。安装需要 Python 3、Xcode 命令行工具，以及 Node.js 22.20 或更高版本，也可使用已安装的 Visual Studio Code 提供的运行环境。其他 Typora 版本和 Intel Mac 仍待验证。

本仓库目前尚无正式 Release，安装请使用源码 ZIP。

1. 下载 [本仓库的源码 ZIP](https://github.com/sansan-01/typora-plugin-macos/archive/refs/heads/macos-maintained.zip) 并解压。
2. 正常退出 Typora。在终端进入解压后的项目目录，运行下面的命令。
3. 从 Dock 或访达打开原来的 Typora，在正文右键确认出现插件分组。

```sh
python3 -B macos/install.py
```

安装器会备份原应用。更新或卸载步骤见 [macOS 安装说明](macos/README.md)。

![Mac 上的 Typora 原生右键菜单，包含四组插件](assets/macos/native-context-menu.jpg)

## 常用功能

| 功能 | 怎么用 |
| --- | --- |
| 原生右键 | 在正文右键，展开「视觉」「编辑」「组件」或「交互」。按住 `⌥` 右键可只看 Typora 自带的命令。 |
| 命令面板 | 按 `⌘⇧J` 搜索并执行插件命令。 |
| 标签页和大纲 | 从同一个窗口打开多个文件，顶部显示标签。标签栏会跟随左侧文件栏的宽度，给大纲切换和搜索按钮留出位置。右下角的列表按钮可打开右侧标题大纲。 |
| 大纲思维导图 | 点击右下角六个按钮中的左下角树形按钮，用 Markmap 把当前文档的标题层级生成思维导图。 |
| Carbon 代码图片 | 在代码块里右键，打开「Carbon」，选择 PNG 或 SVG。也可在子菜单中切换主题和本机字体。 |
| 模糊模式 | 在正文右键，从「视觉」开启模糊模式。当前编辑的段落保持清晰。 |

![代码块的 Carbon 子菜单](assets/macos/carbon-menu.jpg)

<details>
<summary>查看 Mac 实拍和导出示例</summary>

**命令面板**

![命令面板搜索 Markmap](assets/macos/command-palette.jpg)

**左侧文件树和右侧标题大纲**

![Typora 同时显示文件树和标题大纲](assets/macos/right-outline.jpg)

**正文内的 Markmap 思维导图**

![在 Typora 正文中渲染的 Markmap 思维导图](assets/macos/markmap-inline.jpg)

**模糊模式**

| 关闭 | 开启 |
| --- | --- |
| ![关闭模糊模式](assets/macos/blur-off.jpg) | ![开启模糊模式](assets/macos/blur-on.jpg) |

**渲染组件**

| Chart.js 导出图 | WaveDrom 实拍 |
| --- | --- |
| ![在 Mac 版 Typora 中导出的 Chart.js 图表](assets/macos/chart-export.png) | ![在 Mac 版 Typora 中渲染的 WaveDrom 波形图](assets/macos/wavedrom.jpg) |

</details>

## 兼容性与反馈

本项目保留了上游插件模块，Mac 上的实测范围和已知缺口见 [功能验收表](macos/Typora%20Mac%20功能验收表.md) 和 [Windows 与 macOS 功能对照](macos/Windows与macOS功能对照.md)。想了解原版插件的全部用法，可查阅 [上游功能文档](https://github.com/obgnail/typora_plugin/blob/master/README-cn.md#插件列表)。

遇到 Mac 版的问题，可以在 [本仓库提交 Issue](https://github.com/sansan-01/typora-plugin-macos/issues/new)，附上 Typora 版本、macOS 版本和复现步骤。欢迎在 [本仓库首页](https://github.com/sansan-01/typora-plugin-macos) 点右上角的 **Star**。

本项目采用 [MIT 许可证](LICENSE)，并保留上游版权声明。
