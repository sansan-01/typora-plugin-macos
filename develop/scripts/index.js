const fs = require("fs")
const sync = require("./sync")
const rpc = require("./rpc")
const serve = require("./serve")

async function run_script(script = "sync") {
  const scripts = { sync, rpc, serve }
  if (!Object.hasOwn(scripts, script)) throw new Error("Unknown development script")
  if (script !== "rpc") {
    if (!process.env.TYPORA_PATH) throw new Error("Set TYPORA_PATH to the Typora executable")
    fs.accessSync(process.env.TYPORA_PATH)
  }
  await scripts[script]()
}

run_script(process.argv[2]).catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
