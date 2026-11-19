const { RpcServer, JSONRPCErrorCode, JSONRPCErrorException } = require("./server.js")

class RemoteControlPlugin extends BasePlugin {
  NAMESPACES = {
    system: "system",
    document: "document",
    plugin: "plugin",
    config: "config",
  }

  _hasAuthToken = token => typeof token === "string" && !!token.trim() && token !== "secret-token"

  _validateToken = token => this._hasAuthToken(token) && token === this.config.AUTH_TOKEN

  prepare = async () => {
    if (this._hasAuthToken(this.config.AUTH_TOKEN)) return
    if (!window.__typoraPluginMacState) {
      throw new Error("Set remote_control.AUTH_TOKEN to a unique token before enabling remote control")
    }
    const { randomBytes } = require("crypto")
    const token = randomBytes(32).toString("hex")
    const saved = await this.utils.settings.save(this.fixedName, { AUTH_TOKEN: token })
    if (!saved) throw new Error("Could not save the local automation token")
    this.config.AUTH_TOKEN = token
  }

  process = () => {
    this._fixConfig()

    this.rpcServer = new RpcServer({ enableDiscovery: true })
    this.rpcServer
      .use(RpcServer.auth({
        validator: this._validateToken,
        bypass: [`${this.NAMESPACES.system}.authenticate`],
      }))
      .use(RpcServer.rateLimit({
        requestsPerMinute: this.config.RATE_LIMIT.requestsPerMinute,
        burstSize: this.config.RATE_LIMIT.burstSize,
      }))
      .use(RpcServer.acl({
        [`${this.NAMESPACES.system}.eval`]: () => {
          if (!this.config.ENABLE_EVAL) {
            throw new JSONRPCErrorException("Eval is disabled by configuration", JSONRPCErrorCode.InvalidRequest, { typoraCode: "EVAL_DISABLED" })
          }
          return true
        },
        [this.NAMESPACES.config]: () => {
          if (!this.config.ALLOW_CONFIG_ACCESS) {
            throw new JSONRPCErrorException("Config access denied", JSONRPCErrorCode.InvalidRequest, { typoraCode: "PERMISSION_DENIED" })
          }
          return true
        },
        [`${this.NAMESPACES.plugin}.call`]: ({ params }) => {
          const { plugin, method } = (Array.isArray(params) && params[0]) || {}
          const methods = this.config.ALLOWED_METHODS || {}
          const allowed = typeof plugin === "string" && Object.hasOwn(methods, plugin) && methods[plugin]
          if (typeof method !== "string" || !Array.isArray(allowed) || !allowed.includes(method)) {
            throw new JSONRPCErrorException("Plugin method is not allowed", JSONRPCErrorCode.InvalidRequest, { typoraCode: "METHOD_NOT_ALLOWED" })
          }
          return true
        },
        "*": true,
      }))
      .registerNamespace(this.NAMESPACES.system, {
        ping: async () => "pong",
        getVersion: async () => ({
          ...process.versions,
          typora: this.utils.typoraVersion,
          protocol: "2.0",
        }),
        getStatus: async () => ({
          filePath: this.utils.getFilePath(),
          isReadOnly: File?.isLocked ?? false,
          hasMountFolder: !!this.utils.getMountFolder(),
        }),
        authenticate: async (params = []) => {
          const [{ token } = {}] = params
          if (this._validateToken(token)) return { success: true, message: "Authenticated" }
          throw new JSONRPCErrorException("Invalid token", JSONRPCErrorCode.InvalidRequest, { typoraCode: "AUTH_FAILED" })
        },
        exitTypora: async () => this.utils.exitTypora(),
        restartTypora: async () => this.utils.restartTypora(),
        eval: async (params = []) => {
          try {
            const script = Array.isArray(params) ? params[0] : params
            return eval(script)
          } catch (e) {
            // -32000 to -32099 are reserved server error zones, where -32000 is used to indicate application logic crashes
            throw new JSONRPCErrorException("Script execution failed", -32000, { typoraCode: "EVAL_FAILED", error: e.message })
          }
        },
      })
      .registerNamespace(this.NAMESPACES.document, {
        getContent: async () => this.utils.getCurrentFileContent(),
        setContent: async (params = []) => {
          await this.utils.editCurrentFile(params[0])
          return { success: true }
        },
        getSelection: async () => window.getSelection().toString(),
        insertText: async (params = []) => {
          this.utils.insertText(null, params[0])
          return { success: true }
        },
        save: async () => {
          if (File?.option?.enableAutoSave) {
            await this.utils.editCurrentFile(content => content, true)
          }
          return { success: true }
        },
        getPath: async () => this.utils.getFilePath(),
        getCursor: async () => {
          const selection = window.getSelection()
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0)
            return { startOffset: range.startOffset, endOffset: range.endOffset }
          }
          return null
        },
      })
      .registerNamespace(this.NAMESPACES.plugin, {
        list: async () => {
          const plugins = this.utils.getAllPlugins()
          return Object.entries(plugins).map(([name, plugin]) => ({
            fixedName: name,
            pluginName: plugin?.pluginName,
            enabled: !!plugin,
          }))
        },
        call: async (params = []) => {
          const [{ plugin, method, args = [] } = {}] = params
          return this.utils.callPluginFn(plugin, method, ...args)
        },
        getMethods: async (params = []) => {
          const [{ plugin } = {}] = params
          const pluginInstance = this.utils.getPlugin(plugin)
          if (!pluginInstance) {
            throw new JSONRPCErrorException(`Plugin '${plugin}' not found`, JSONRPCErrorCode.MethodNotFound, { typoraCode: "PLUGIN_NOT_FOUND" })
          }
          return Object.getOwnPropertyNames(Object.getPrototypeOf(pluginInstance))
            .filter(name => typeof pluginInstance[name] === "function" && name !== "constructor")
        },
      })
      .registerNamespace(this.NAMESPACES.config, {
        get: async (params = []) => {
          const [{ key } = {}] = params
          return this.config[key]
        },
        set: async (params = []) => {
          const [{ key, value } = {}] = params
          if (typeof key !== "string" || !Object.hasOwn(this.config, key) || (key === "AUTH_TOKEN" && !this._hasAuthToken(value))) {
            throw new JSONRPCErrorException("Invalid configuration setting", JSONRPCErrorCode.InvalidParams)
          }
          this.config[key] = value
          return { success: true }
        },
      })
      .start(this.config.SERVER_PORT)
      .catch(error => console.error("[RemoteControlPlugin] Could not start RPC server:", error))
  }

  _fixConfig = () => {
    const rateLimit = this.config.RATE_LIMIT || (this.config.RATE_LIMIT = {})
    const normalizeLimit = (value, fallback) => {
      const limit = Number(value ?? fallback)
      return Number.isFinite(limit) ? Math.max(0, limit) : fallback
    }
    rateLimit.requestsPerMinute = normalizeLimit(rateLimit.requestsPerMinute, 60)
    rateLimit.burstSize = normalizeLimit(rateLimit.burstSize, 10)
    if (rateLimit.burstSize > rateLimit.requestsPerMinute) {
      console.warn("[RemoteControlPlugin] burstSize should not exceed requestsPerMinute")
      rateLimit.burstSize = rateLimit.requestsPerMinute
    }
  }
}

module.exports = {
  plugin: RemoteControlPlugin,
}
