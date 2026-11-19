const SDK = require("../../plugin/remote_control/client.js")

module.exports = async () => {
  const port = Number(process.env.JSON_RPC_PORT || 5080)
  const token = process.env.JSON_RPC_AUTH_TOKEN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid JSON_RPC_PORT")
  if (!token?.trim()) throw new Error("Set JSON_RPC_AUTH_TOKEN to the local RPC server token")
  return new SDK(`http://127.0.0.1:${port}`, { token })
}
