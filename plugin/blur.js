class BlurPlugin extends BasePlugin {
  isBlurMode = this.config.BLUR_DEFAULT
  isMac = !!window.__typoraPluginMacState
  activeBlock = null

  prepare = () => this.isMac || this.utils.supportHasSelector ? undefined : this.utils.PLUGIN_LOAD_ABORT

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  process = () => {
    if (!this.isMac) return
    document.addEventListener("selectionchange", this.updateActiveBlock)
    document.addEventListener("focusin", this.updateActiveBlock)
    this.updateActiveBlock()
  }

  updateActiveBlock = () => {
    if (!this.isBlurMode) return
    const write = document.getElementById("write")
    if (!write) return
    const active = document.activeElement
    const selection = window.getSelection()
    const anchor = active?.matches("textarea, input") && write.contains(active)
      ? active
      : selection?.focusNode
    let block = anchor?.nodeType === 1 ? anchor : anchor?.parentElement
    while (block && block !== write && block.parentElement !== write) {
      block = block.parentElement
    }
    if (!block?.hasAttribute("cid") || block.parentElement !== write) {
      if (write.contains(this.activeBlock)) return
      block = write.querySelector(":scope > [cid]")
    }
    if (this.activeBlock !== block) {
      this.activeBlock?.classList.remove("plugin-blur-active")
      block?.classList.add("plugin-blur-active")
      this.activeBlock = block
    }
  }

  style = () => {
    if (!this.isBlurMode) return

    const selector = this.isMac
      ? "#write > [cid]:not(.plugin-blur-active)"
      : "#write > [cid]:not(.md-focus):not(:has(.md-focus)):not(:has(.md-focus-container))"
    const [effect, restore] = (this.config.BLUR_TYPE === "hide")
      ? ["visibility: hidden;", "visibility: visible;"]
      : [`filter: blur(${this.config.BLUR_LEVEL}px);`, "filter: initial;"]

    let css = `${selector} { ${effect} }`
    if (this.config.RESTORE_ON_HOVER && (!this.isMac || this.config.BLUR_TYPE !== "hide")) {
      css += `${selector}:hover { ${restore} }`
    }
    return css
  }

  call = () => {
    this.isBlurMode = !this.isBlurMode

    if (this.isBlurMode) {
      if (this.isMac) this.updateActiveBlock()
      this.utils.insertStyle(this.fixedName, this.style())
    } else {
      this.utils.removeStyle(this.fixedName)
      this.activeBlock?.classList.remove("plugin-blur-active")
      this.activeBlock = null
    }

    const msg = this.i18n.t(this.isBlurMode ? "modeEnabled" : "modeDisabled")
    this.utils.notification.show(msg)
  }
}

module.exports = {
  plugin: BlurPlugin,
}
