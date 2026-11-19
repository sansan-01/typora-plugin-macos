const { defaultModeResolver, createRenderEngine } = require("./server.js")

class PlantUMLPlugin extends BasePlugin {
  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  call = () => this.utils.insertBlockCode(null, this.config.LANGUAGE, this.config.TEMPLATE)

  process = () => {
    const parser = this.utils.thirdPartyDiagramParser
    parser.register({
      lang: this.config.LANGUAGE,
      mappingLang: null,
      destroyWhenUpdate: false,
      interactiveMode: this.config.INTERACTIVE_MODE,
      metaConfigSchema: null,
      checkSelector: ".plugin-plantuml-content",
      wrapElement: `<div class="plugin-plantuml-content"></div>`,
      lazyLoadFunc: this.lazyLoad,
      beforeRenderFunc: null,
      renderStyleGetter: parser.helpers.renderStyle.wrapDefault({
        height: this.config.DEFAULT_FENCE_HEIGHT,
        backgroundColor: this.config.DEFAULT_FENCE_BACKGROUND_COLOR,
      }),
      createFunc: this.create,
      updateFunc: null,
      destroyFunc: null,
      beforeExportToNative: null,
      beforeExportToHTML: null,
      exportStyleGetter: parser.helpers.exportStyle.svg,
      versionGetter: null,
    })
  }

  create = async ($wrap, content) => {
    $wrap[0].textContent = "Querying..."
    const result = await this._memorizedRender(content)
    if (result instanceof Error) throw result
    const output = this._buildOutput(result)
    $wrap[0].textContent = ""
    $wrap[0].appendChild(output)
  }

  _buildOutput({ contentType, buffer }) {
    const mimeType = contentType.split(";")[0].trim().toLowerCase()
    if (/^image\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType)) {
      const image = document.createElement("img")
      image.src = `data:${mimeType};base64,${buffer.toString("base64")}`
      return image
    }
    if (mimeType === "text/plain") {
      const text = document.createElement("pre")
      text.textContent = buffer.toString("utf-8")
      return text
    }
    throw new Error(`Unsupported Format: ${contentType}`)
  }

  lazyLoad = () => {
    this._memorizedRender = this.utils.memoizeLimited(
      createRenderEngine({
        fetch: this.utils.fetch,
        getBaseUrl: () => this.config.SERVER_URL.replace(/\/+$/, ""),
        getFormat: () => this.config.OUTPUT_FORMAT,
        getTimeout: () => this.config.SERVER_TIMEOUT,
        getProxy: () => this.config.PROXY,
        resolveMode: defaultModeResolver,
      }),
      { cap: this.config.CACHED_URL_COUNT, keyResolver: this.utils.identity },
    )
  }
}

module.exports = {
  plugin: PlantUMLPlugin,
}
