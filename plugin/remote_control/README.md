## Features

Exposes Typora's full capabilities—including all Typora Plugin features—via `JSON RPC`, enabling you to **remotely control Typora**.

## Usage

Set a unique `remote_control.AUTH_TOKEN` in your local `settings.user.toml`, then enable the `remote_control` plugin. The macOS launcher generates a token in its private settings directory when needed. Once Typora is launched, the JSON-RPC server listens on `127.0.0.1`. Set `JSON_RPC_AUTH_TOKEN` in the client environment to the same token.

```javascript
const RpcSDK = require("your_path_to_typora_dir/plugin/remote_control/client.js")

const address = "http://127.0.0.1:5080/"
const auto_token = process.env.JSON_RPC_AUTH_TOKEN
const sdk = new RpcSDK(address, { token: auto_token })

async function main() {
  try {
    console.log(await sdk.discover())  // Get all available APIs
    console.log(await sdk.authenticate(auto_token))

    // System APIs
    console.log(await sdk.api.system.ping())
    console.log(await sdk.api.system.getVersion())
    console.log(await sdk.api.system.getStatus())
    // console.log(await client.api.system.eval("console.log(1)"))  // Only works if ENABLE_EVAL is enabled

    // Document APIs
    const content = await sdk.api.document.getContent()
    console.log("Document content:", content)

    // Plugin APIs
    const plugins = await sdk.api.plugin.list()
    console.log("Available plugins:", plugins)

    // Call a plugin method
    await sdk.api.plugin.call({
      plugin: "read_only",
      method: "call",
      args: []
    })

  } catch (error) {
    console.error("RPC Error:", error)
  }
}

main()
```

To use the development scripts, copy `develop/.env.example` to `develop/.env` and fill in the local values. `ALLOWED_METHODS` lists the plugin methods available through `plugin.call`.
