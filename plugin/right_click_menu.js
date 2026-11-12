const LEVEL = { SECOND: 0, THIRD: 1 }

const createMenuManager = () => {
  // The opened submenu chain, shallow to deep:
  //   chain[LEVEL.SECOND] = { menu: .plugin-menu-2nd ul, trigger: #context-menu li }
  //   chain[LEVEL.THIRD]  = { menu: .plugin-menu-3rd ul,  trigger: .plugin-menu-2nd li }
  const chain = []

  const deactivate = entry => {
    entry?.menu?.classList.remove("show")
    entry?.trigger?.classList.remove("active")
  }

  /** Close the submenu at `depth` and everything deeper. Default closes all. */
  const close = (depth = LEVEL.SECOND) => chain.splice(depth).forEach(deactivate)

  /**
   * Open `menu` activated by `trigger` at `depth`.
   * Everything at `depth` and deeper is closed first; reopening the same entry is a no-op.
   * `menu` may be null: only `trigger` gets `active`.
   */
  const open = (depth, menu, trigger) => {
    const cur = chain[depth]
    if (cur && cur.menu === menu && cur.trigger === trigger) return
    close(depth)
    if (!trigger) return
    chain[depth] = { menu, trigger }
    trigger.classList.add("active")
    menu?.classList.add("show")
  }

  return { open, close }
}

const SUBMENU_CLASS = "dropdown-menu context-menu ext-context-menu"

const hasOverridePluginFn = (plugin, fn) => plugin[fn] !== BasePlugin.prototype[fn]

class RightClickMenuPlugin extends BasePlugin {
  groupName = "typora-plugin"
  noExtraMenuGroupName = "typora-plugin-no-extra"
  dividerValue = "---"
  unavailableActValue = "__not_available__"
  unavailableActName = this.i18n.t("act.disabled")
  defaultDisableHint = this.i18n.t("actHint.disabled")
  macMenu = null
  supportShortcut = !!window.__typoraPluginMacState || !!document.querySelector(".ty-menu-shortcut")
  menuManager = createMenuManager()
  ACTIONS = {
    hide_other_options: () => {
      this.config.HIDE_OTHER_OPTIONS = !this.config.HIDE_OTHER_OPTIONS
      this.utils.replaceStyle(this.fixedName, this.style())
    },
    toggle_hotkey: () => {
      this.config.SHOW_PLUGIN_HOTKEY = !this.config.SHOW_PLUGIN_HOTKEY
      document.querySelectorAll(".plugin-menu-2nd .ty-menu-shortcut, .plugin-menu-3rd .ty-menu-shortcut")
        .forEach(el => el.classList.toggle("plugin-common-hidden", !this.config.SHOW_PLUGIN_HOTKEY))
    },
  }

  style = () => `
.plugin-menu-2nd.ext-context-menu, .plugin-menu-3rd.ext-context-menu { min-width: ${this.config.MENU_MIN_WIDTH}; }
#context-menu > li:not([data-key="typora-plugin"]) { display: ${this.config.HIDE_OTHER_OPTIONS ? "none" : ""}; }
.context-menu .state-run:before { content: '\\2318'; margin-left: -10px; margin-right: 10px; }
.ty-menu-shortcut { padding-left: 1em; }`

  process = () => {
    this.utils.settings.autoSave(this)
    this.utils.eventHub.on(this.utils.eventHub.eventType.allPluginsHadInjected, () => {
      setTimeout(() => {
        if (window.__typoraPluginMacState) {
          this._installMacMenu()
          return
        }
        this._insertLevel1()  // The 1st level menus group all plugins
        this._insertLevel2()  // The 2nd level menus display grouped plugins
        this._insertLevel3()  // The 3rd level menus display the actions of the plugin
        this._listen()
      }, 500)
    })
  }

  _installMacMenu = () => {
    const layer = document.createElement("div")
    layer.className = "plugin-mac-context-layer"
    document.body.append(layer)
    this.macMenu = layer
    const panels = []
    let previousFocus = null
    let anchor = null
    let nativeContext = null
    let generation = 0

    const closeFrom = depth => panels.splice(depth).forEach(({ panel, trigger }) => {
      trigger?.setAttribute("aria-expanded", "false")
      panel.remove()
    })

    const dismiss = () => {
      const restoreFocus = layer.contains(document.activeElement)
      closeFrom(0)
      if (restoreFocus) previousFocus?.focus({ preventScroll: true })
      previousFocus = null
      anchor = null
    }

    const focusRow = (panel, offset) => {
      const rows = Array.from(panel.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])'))
      if (!rows.length) return
      const index = rows.indexOf(document.activeElement)
      const next = index < 0 ? (offset < 0 ? rows.length - 1 : 0) : (index + offset + rows.length) % rows.length
      rows[next].focus({ preventScroll: true })
    }

    const execute = (action, target = anchor) => {
      dismiss()
      if (action?.run) {
        if (action.fence.isConnected) return action.run()
        return
      }
      if (!target?.[0]?.isConnected || !action) return
      const { fixedName, value, dynamic } = action
      const available = this.utils.updatePluginDynamicActions(fixedName, target) || []
      if (!dynamic || available.some(act => act.act_value === value && !act.act_hidden && !act.act_disabled)) {
        this.callPluginAction(fixedName, value)
      }
    }

    const render = (items, actions, depth, position, trigger = null) => {
      closeFrom(depth)
      const panel = document.createElement("div")
      panel.className = "plugin-mac-context-menu"
      panel.setAttribute("role", "menu")
      if (depth > 0 && /^\d+(?:\.\d+)?px$/.test(this.config.MENU_MIN_WIDTH)) {
        panel.style.minWidth = `min(${this.config.MENU_MIN_WIDTH}, calc(100vw - 16px))`
      }
      for (const item of items) {
        const row = document.createElement("div")
        if (item.separator) {
          row.setAttribute("role", "separator")
          panel.append(row)
          continue
        }
        row.setAttribute("role", "menuitem")
        row.tabIndex = -1
        row.textContent = item.checked === true ? "✓ " + item.title : item.title
        if (item.hint) row.title = item.hint
        if (item.enabled === false) row.setAttribute("aria-disabled", "true")
        if (item.children) {
          row.setAttribute("aria-haspopup", "menu")
          row.setAttribute("aria-expanded", "false")
        }
        const openChild = focus => {
          if (!item.children || item.enabled === false) return
          if (panels[depth + 1]?.trigger !== row) {
            render(item.children, actions, depth + 1, row.getBoundingClientRect(), row)
            row.setAttribute("aria-expanded", "true")
          }
          if (focus) focusRow(panels[depth + 1].panel, 1)
        }
        row.addEventListener("mouseenter", () => {
          if (item.children) openChild(false)
          else closeFrom(depth + 1)
        })
        row.addEventListener("click", () => {
          if (item.enabled === false) return
          if (item.children) openChild(true)
          else execute(actions[item.id])
        })
        if (item.shortcut) {
          const shortcut = document.createElement("span")
          shortcut.className = "plugin-mac-context-shortcut"
          shortcut.textContent = item.shortcut.replace(/Ctrl\+|Shift\+|Alt\+/g,
            key => ({ "Ctrl+": "⌘", "Shift+": "⇧", "Alt+": "⌥" })[key])
          row.append(shortcut)
        }
        panel.append(row)
      }
      layer.append(panel)
      panels.push({ panel, trigger })
      const { width, height } = panel.getBoundingClientRect()
      const x = trigger && position.right + width > innerWidth - 8 ? position.left - width : (position.right ?? position.x)
      const y = position.top ?? position.y
      panel.style.left = Math.max(8, Math.min(x, innerWidth - width - 8)) + "px"
      panel.style.top = Math.max(8, Math.min(y, innerHeight - height - 8)) + "px"
    }

    const show = (target, position, keyboard = false) => {
      dismiss()
      anchor = $(target)
      previousFocus = document.activeElement
      const { items, actions } = this._macMenuItems(anchor, !keyboard)
      if (!items.length) return false
      render(items, actions, 0, position)
      if (keyboard) focusRow(panels[0].panel, 1)
      return true
    }

    window.addEventListener("contextmenu", ev => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || !ev.target.closest?.("#write")) return
      const target = $(ev.target)
      const { items, actions } = this._macMenuItems(target, true)
      if (!items.length) return
      try {
        const id = ++generation
        if (window.bridge?.callSync?.("typoraPluginContext.setMenu", { generation: id, items }) === true) {
          dismiss()
          nativeContext = { id, target, actions }
          return
        }
      } catch (error) {
        console.warn("Unable to extend the native context menu", error)
      }
      if (!show(ev.target, { x: ev.clientX, y: ev.clientY })) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      window.bridge?.callSync?.("contextMenu.setItems", [])
    }, true)
    window.__typoraPluginNativeMenuAction = (id, index) => {
      if (nativeContext?.id !== id || !Number.isInteger(index)) return
      const { target, actions } = nativeContext
      nativeContext = null
      execute(actions[index], target)
    }
    layer.addEventListener("mousedown", ev => ev.preventDefault())
    document.addEventListener("mousedown", ev => {
      if (!layer.contains(ev.target)) dismiss()
    }, true)
    window.addEventListener("blur", dismiss)
    window.addEventListener("resize", dismiss)

    document.addEventListener("keydown", ev => {
      if (ev.metaKey && ev.shiftKey && !ev.altKey && !ev.ctrlKey && ev.code === "KeyM") {
        const node = window.getSelection()?.anchorNode
        const target = node instanceof Element ? node : node?.parentElement
        const write = document.querySelector("#write")
        if (!write) return
        const selected = write.contains(target) ? target : write
        const rect = selected.getBoundingClientRect()
        if (!show(selected, { x: rect.left, y: rect.top }, true)) return
      } else {
        if (!panels.length) return
        const row = layer.contains(document.activeElement) ? document.activeElement.closest('[role="menuitem"]') : null
        const depth = Math.max(0, panels.findIndex(({ panel }) => panel.contains(row)))
        if (ev.key === "Escape" || ev.key === "Tab") {
          dismiss()
          if (ev.key === "Tab") return
        } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          focusRow(panels[depth].panel, ev.key === "ArrowDown" ? 1 : -1)
        } else if (ev.key === "ArrowLeft" && depth > 0) {
          const trigger = panels[depth].trigger
          closeFrom(depth)
          trigger.focus({ preventScroll: true })
        } else if (row && (ev.key === "Enter" || ev.key === " " ||
          (ev.key === "ArrowRight" && row.hasAttribute("aria-haspopup")))) {
          row.click()
        } else {
          return
        }
      }
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }, true)
  }

  _macMenuItems = (anchor, includeCodeItems) => {
    const actions = []
    const clean = items => {
      const visible = items.filter(Boolean).filter((item, i, list) =>
        !item.separator || (i > 0 && !list[i - 1].separator))
      if (visible.length && visible[visible.length - 1].separator) visible.pop()
      return visible
    }
    const leaf = (plugin, value, title, act, dynamic = false) => {
      if (act?.act_hidden) return null
      const id = actions.length
      const shortcut = this.config.SHOW_PLUGIN_HOTKEY && this._cleanShortcut(act?.act_hotkey || (!value && plugin.config.HOTKEY))
      actions.push({ fixedName: plugin.fixedName, value, dynamic })
      return {
        id,
        title,
        shortcut: typeof shortcut === "string" ? shortcut : undefined,
        enabled: !act?.act_disabled && (Boolean(value) || hasOverridePluginFn(plugin, "call")),
        checked: act?.act_state === undefined ? undefined : Boolean(act.act_state),
        hint: act?.act_hint || (act?.act_disabled ? this.defaultDisableHint : undefined),
        command: !!act && this.config.SHOW_ACTION_OPTIONS_ICON && act.act_state === undefined,
      }
    }
    const item = (key, title, direct = false) => {
      if (key === this.dividerValue) return { separator: true }
      const [name, value] = key.split(".")
      const plugin = this.utils.getPlugin(name)
      if (!plugin) return null
      const statics = plugin.staticActions || []
      if (value || direct || (!plugin.staticActions && !plugin.getDynamicActions)) {
        const act = statics.find(act => act.act_value === value)
        return leaf(plugin, value, title || act?.act_name || plugin.pluginName, act)
      }
      let dynamic = []
      try {
        dynamic = this.utils.updatePluginDynamicActions(name, anchor) || []
      } catch (error) {
        console.warn("Unable to list plugin actions", name, error)
      }
      const children = clean([
        ...statics.map(act => leaf(plugin, act.act_value, act.act_name, act)),
        ...dynamic.map(act => leaf(plugin, act.act_value, act.act_name, act, true)),
      ])
      if (!children.length) children.push({ title: this.unavailableActName, enabled: false })
      return { title: plugin.pluginName, children }
    }
    const items = clean(this.config.MENUS.map(({ NAME, LIST = [] }) => {
      const title = this.i18n._t("settings", NAME)
      if (LIST.length === 1) return item(LIST[0], title, true)
      const children = clean(LIST.map(key => item(key)))
      return children.length ? { title, children } : null
    }))
    const codeBlock = includeCodeItems && anchor[0]?.closest("#write .md-fences[cid]")
    const fence = codeBlock && this.utils.getPlugin("fence_enhance")
    if (fence) {
      const toMenuItem = ({ label, action, children, checked }) => {
        if (children) return { title: label, children: children.map(toMenuItem) }
        const id = actions.push({ run: action, fence: codeBlock }) - 1
        return { id, title: label, checked }
      }
      const codeItems = fence.getCodeContextItems(codeBlock).map(toMenuItem)
      items.unshift(...codeItems, ...(items.length ? [{ separator: true }] : []))
    }
    return { items, actions }
  }

  _insertLevel1 = () => {
    const items = this.config.MENUS.map(({ NAME, LIST = [] }, idx) => {
      if (LIST.length === 0) {
        return ""
      }
      const name = this.i18n._t("settings", NAME)
      const noExtraMenu = LIST.length === 1
      const caret = noExtraMenu ? "" : `<i class="fa fa-caret-right"></i>`
      const a = `<a role="menuitem"><span data-lg="Menu" data-localize="${name}">${name}</span>${caret}</a>`
      return noExtraMenu
        ? `<li data-key="${this.noExtraMenuGroupName}" data-value="${LIST[0]}" data-idx="${idx}">${a}</li>`
        : `<li class="has-extra-menu" data-key="${this.groupName}" data-idx="${idx}">${a}</li>`
    })
    const html = `<li class="divider"></li>` + items.join("")
    const menu = document.querySelector("#context-menu")
    menu.insertAdjacentHTML("beforeend", html)
  }

  _insertLevel2 = () => {
    const LiWithAction = (plugin, action) => {
      const name = plugin.staticActions.find(act => act.act_value === action)?.act_name || plugin.pluginName
      return `
        <li class="plugin-menu-item" data-key="${plugin.fixedName}" data-value="${action}">
          <a role="menuitem" data-lg="Menu" data-localize="${name}">${name}</a>
        </li>`
    }
    const Li = plugin => {
      const hasAction = plugin.staticActions || plugin.getDynamicActions
      const extraClass = hasAction ? "has-extra-menu" : ""
      const callable = hasAction || hasOverridePluginFn(plugin, "call")
      const style = callable ? "" : `style="opacity: 0.5; pointer-events: none;"`
      const liAttrs = `class="plugin-menu-item ${extraClass}" ${style}`
      return this._liTemplate(plugin.fixedName, plugin.pluginName, plugin.config.HOTKEY, hasAction, "", liAttrs)
    }

    const className = `plugin-menu-2nd ${SUBMENU_CLASS}`
    const html = this.config.MENUS.map(({ LIST = [] }, idx) => {
      const children = LIST.map(item => {
        if (item === this.dividerValue) return `<li class="divider"></li>`
        const [fixedName, action] = item.split(".")
        const plugin = this.utils.getPlugin(fixedName)
        if (!plugin) return ""
        return action ? LiWithAction(plugin, action) : Li(plugin)
      })
      return `<ul role="menu" data-idx="${idx}" class="${className}">${children.join("")}</ul>`
    })
    this.utils.entities.eContent.insertAdjacentHTML("beforeend", html.join(""))
  }

  _insertLevel3 = () => {
    const className = `plugin-menu-3rd ${SUBMENU_CLASS}`
    const html = this.config.MENUS.flatMap(({ LIST = [] }, idx) => {
      return LIST
        .filter(item => item !== this.dividerValue)
        .map(item => this.utils.getPlugin(item.split(".")[0]))
        .filter(plugin => plugin && (plugin.staticActions || plugin.getDynamicActions))
        .map(plugin => {
          const children = (plugin.staticActions || []).map(act => this._thirdLiTemplate(act)).join("")
          return `<ul role="menu" data-idx="${idx}" data-plugin="${plugin.fixedName}" class="${className}">${children}</ul>`
        })
    })
    this.utils.entities.eContent.insertAdjacentHTML("beforeend", html.join(""))
  }

  _thirdLiTemplate = (act, dynamic) => {
    const classList = ["plugin-menu-item"]
    if (dynamic) classList.push("plugin-dynamic-act")
    if (act.act_hidden) classList.push("plugin-common-hidden")
    if (act.act_disabled) classList.push("disabled")

    const hint = act.act_hint || (act.act_disabled ? this.defaultDisableHint : "")
    const liExtraAttrs = (hint ? `ty-hint="${hint}" ` : "") + `class="${classList.join(" ")}"`

    const state = (this.config.SHOW_ACTION_OPTIONS_ICON && act.act_state === undefined)
      ? "state-run"
      : Boolean(act.act_state) ? "state-on" : "state-off"

    return this._liTemplate(act.act_value, act.act_name, act.act_hotkey, false, state, liExtraAttrs)
  }

  _liTemplate = (key, showName, shortcut, hasExtraMenu, aClassName = "", liExtraAttrs = "") => {
    shortcut = this._cleanShortcut(shortcut)
    const hasShortcut = this.supportShortcut && this.config.SHOW_PLUGIN_HOTKEY && shortcut
    let inner = ""
    let aAttrs = `data-lg="Menu"`
    if (hasExtraMenu) {
      inner = `<span data-lg="Menu" data-localize="${showName}">${showName}</span><i class="fa fa-caret-right"></i>`
    } else if (hasShortcut) {
      inner = `<span data-localize="${showName}">${showName}</span><span class="ty-menu-shortcut">${shortcut}</span>`
    } else {
      inner = showName
      aAttrs += ` data-localize="${showName}"`
    }
    return `<li data-key="${key}" ${liExtraAttrs.trim()}><a role="menuitem" class="${aClassName}" ${aAttrs}>${inner}</a></li>`.trim()
  }

  _cleanShortcut = shortcut => {
    if (Array.isArray(shortcut)) {
      shortcut = shortcut[0]
    }
    if (shortcut && typeof shortcut === "string") {
      shortcut = this.utils.hotkeyHub.capitalize(shortcut)
    }
    return shortcut
  }

  _showMenuItem = (after, before) => {
    const margin = 6
    const { left, top, width, height } = before.getBoundingClientRect()
    let afterTop = top - height
    let afterLeft = left + width + margin

    const footer = document.querySelector("footer")
    const footerHeight = footer ? footer.getBoundingClientRect().height : 0

    const { height: afterHeight, width: afterWidth } = after.getBoundingClientRect()
    afterTop = Math.min(afterTop, window.innerHeight - afterHeight - footerHeight)
    afterLeft = afterLeft + afterWidth < window.innerWidth ? afterLeft : Math.max(0, left - afterWidth - margin)
    after.style.top = afterTop + "px"
    after.style.left = afterLeft + "px"
  }

  _listen = () => {
    const self = this
    const { menuManager } = this

    // Click on the 1st level menu
    $("#context-menu").on("click", `[data-key="${this.noExtraMenuGroupName}"]`, function () {
      const [fixedName, action] = (this.dataset.value || "").split(".")
      if (!fixedName) return false
      self.utils.updatePluginDynamicActions(fixedName)
      self.callPluginAction(fixedName, action)
      self._hideMenuIfNeed()
      // Display the 2nd level menu
    }).on("mouseenter", "[data-key]", function () {
      if (self.groupName !== this.dataset.key) {
        menuManager.close()
        return
      }
      const secondMenu = document.querySelector(`.plugin-menu-2nd[data-idx="${this.dataset.idx}"]`)
      menuManager.open(LEVEL.SECOND, secondMenu, this)
      if (secondMenu) {
        self._showMenuItem(secondMenu, this)
      }
    })

    // Display the 3rd level menu
    $(".plugin-menu-2nd").on("mouseenter", "[data-key]", function () {
      document.querySelectorAll(".plugin-dynamic-act").forEach(el => el.remove())
      const fixedName = this.dataset.key
      const third = document.querySelector(`.plugin-menu-3rd[data-plugin="${fixedName}"]`)
      const noStaticActions = third && third.children.length === 0
      let dynamicActions = self.utils.updatePluginDynamicActions(fixedName)
      const noDynamicActions = !dynamicActions || dynamicActions.length === 0
      if (noDynamicActions && noStaticActions) {
        dynamicActions = [{ act_name: self.unavailableActName, act_value: self.unavailableActValue, act_disabled: true }]
      }
      if (dynamicActions && third) {
        const html = dynamicActions.map(act => self._thirdLiTemplate(act, true)).join("")
        third.insertAdjacentHTML("beforeend", html)
      }
      if (this.classList.contains("has-extra-menu")) {
        menuManager.open(LEVEL.THIRD, third, this)
        if (third) {
          self._showMenuItem(third, this)
        }
      } else {
        menuManager.close(LEVEL.THIRD)
      }
      // Call plugins in the 2nd level menu
    }).on("click", "[data-key]", function () {
      const fixedName = this.dataset.key
      const action = this.dataset.value
      if (action) {
        self.callPluginAction(fixedName, action)
      } else {
        const plugin = self.utils.getPlugin(fixedName)
        // If there is a 3rd level menu, clicking the 2nd level menu is not allowed.
        if (!plugin || plugin.staticActions || plugin.getDynamicActions) return false
        plugin.call?.()
      }
      self._hideMenuIfNeed()
    })

    // Call plugins in the 3rd level menu
    $(".plugin-menu-3rd").on("click", "[data-key]", function () {
      if (this.classList.contains("disabled")) return false

      const action = this.dataset.key
      const fixedName = this.parentElement.dataset.plugin
      self.callPluginAction(fixedName, action)
      self._hideMenuIfNeed()
    })
  }

  _hideMenuIfNeed = () => {
    File.editor.contextMenu.hide()
    this.menuManager.close()
  }

  callPluginAction = (fixedName, action) => {
    if (action !== this.unavailableActValue) {
      this.utils.callPluginAction(fixedName, action)
    }
  }

  getDynamicActions = () => this.i18n.fillActions([
    { act_value: "toggle_hotkey", act_state: this.config.SHOW_PLUGIN_HOTKEY, act_hidden: !this.supportShortcut },
    { act_value: "hide_other_options", act_state: this.config.HIDE_OTHER_OPTIONS, act_hidden: !!window.__typoraPluginMacState },
  ])

  call = action => this.ACTIONS[action]?.()
}

module.exports = {
  plugin: RightClickMenuPlugin,
}
