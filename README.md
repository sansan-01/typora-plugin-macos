English | [简体中文](README-cn.md)

<div align="center">
  <a href="https://github.com/sansan-01"><img src="assets/macos/maintainer-avatar.png" alt="sansan-01" width="80" height="80"></a>
  <h1>Typora Plugin for macOS</h1>
  <p>Install the plugin into your existing copy of Typora and keep opening it from the Dock or Finder.</p>
  <p>
    <a href="https://github.com/sansan-01/typora-plugin-macos/releases">Releases</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/issues">Issues</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/stargazers">Stars</a> ·
    <a href="https://github.com/sansan-01/typora-plugin-macos/releases/latest/download/typora-plugin-macos.zip">Download macOS package</a>
  </p>
</div>

## Acknowledgements

Thank you to **obgnail** and the upstream contributors for creating Typora Plugin. **sansan-01** adapts and maintains this edition for macOS. [Original project](https://github.com/obgnail/typora_plugin) · [Maintainer](https://github.com/sansan-01)

Thanks also to bfyes for the macOS compatibility work and to Carbon for the theme palettes. [Typora-plugin-on-Mac](https://github.com/bfyes/Typora-plugin-on-Mac) · [Carbon](https://github.com/carbon-app/carbon)

## Install

Tested on **Apple silicon with Typora 1.14.15**. You need Python 3, the Xcode Command Line Tools, and Node.js 22.20 or later. An existing Visual Studio Code installation can supply the runtime instead. Other Typora versions and Intel Macs remain unverified.

1. Download and extract the [macOS package](https://github.com/sansan-01/typora-plugin-macos/releases/latest/download/typora-plugin-macos.zip).
2. Quit Typora. In Terminal, open the extracted project directory and run the command below.
3. Open Typora as usual from the Dock or Finder. Right-click in the editor and check that the plugin groups appear.

```sh
python3 -B macos/install.py
```

The installer backs up the original app. See the [macOS installation guide](macos/README.md) for update and uninstall instructions.

![Typora's native context menu showing the four plugin groups on macOS](assets/macos/native-context-menu.jpg)

## Everyday features

| Feature | Where to find it |
| --- | --- |
| Native context menu | Right-click in the editor to find the four plugin groups. Hold `⌥` while right-clicking to show Typora's own commands only. |
| Command palette | Press `⌘⇧J` to search for and run plugin commands. |
| Tabs and outline | Open multiple documents in the same window to use tabs. The tab bar follows the left sidebar and leaves its outline and search controls accessible. The list button in the lower-right opens the right-hand outline. |
| Outline mind map | Click the tree icon at the lower left of the six buttons in the lower-right corner. Markmap turns the current document's headings into a mind map. |
| Carbon code images | Right-click inside a code block and choose **Carbon** to export PNG or SVG, choose a theme, or select a font installed on your Mac. |
| Blur mode | Find Blur Mode in the visual plugin group. The block you're editing stays in focus. |

![The Carbon submenu on a code block](assets/macos/carbon-menu.jpg)

<details>
<summary>macOS screenshots and exports</summary>

**Command palette**

![Searching for Markmap in the command palette](assets/macos/command-palette.jpg)

**File tree and right-hand outline**

![The file tree and heading outline displayed at the same time](assets/macos/right-outline.jpg)

**Inline Markmap**

![Markmap rendered inside a Typora document](assets/macos/markmap-inline.jpg)

**Blur mode**

| Off | On |
| --- | --- |
| ![Blur mode off](assets/macos/blur-off.jpg) | ![Blur mode on](assets/macos/blur-on.jpg) |

**Rendering plugins**

| Chart.js export | WaveDrom screenshot |
| --- | --- |
| ![Chart.js image exported from Typora on macOS](assets/macos/chart-export.png) | ![WaveDrom rendered in Typora on macOS](assets/macos/wavedrom.jpg) |

</details>

## Compatibility and feedback

See the [Mac verification table](macos/Typora%20Mac%20功能验收表.md) and the [Windows and macOS comparison](macos/Windows与macOS功能对照.md) for what has been tested and which features still have gaps. The [upstream feature guide](https://github.com/obgnail/typora_plugin#plugin-list) describes the original plugin collection.

Please [open an issue in this repository](https://github.com/sansan-01/typora-plugin-macos/issues/new) for macOS problems and include your Typora version, macOS version, and steps to reproduce. You can star the project from its [repository homepage](https://github.com/sansan-01/typora-plugin-macos).

This project uses the [MIT license](LICENSE) and retains the upstream copyright notice.
