// electron-builder afterPack hook (Linux).
//
// mpris-service pulls in the `call-bind` / es-shim dependency cluster, where
// `dunder-proto` does `require('call-bind-apply-helpers')`. electron-builder's
// dependency collector only ships that module NESTED under call-bind
// (`node_modules/call-bind/node_modules/call-bind-apply-helpers`) and never at
// the top level, so dunder-proto's top-level require fails at runtime with
// `Cannot find module 'call-bind-apply-helpers'` and the app dies on launch.
// npm dedupe doesn't help — @electron/rebuild rebuilds the tree and re-nests it.
//
// Fix: after the app is packed (asar disabled), copy the top-level module from
// the project's node_modules straight into the bundle so the require resolves.
const { cpSync, existsSync } = require('fs')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const mod = 'call-bind-apply-helpers'
  const src = join(context.packager.projectDir, 'node_modules', mod)
  const dest = join(context.appOutDir, 'resources', 'app', 'node_modules', mod)
  if (!existsSync(src)) {
    console.warn(`[afterPack] ${mod} not found in project node_modules - skipping`)
    return
  }
  if (existsSync(dest)) return
  cpSync(src, dest, { recursive: true })
  console.log(`[afterPack] injected ${mod} -> ${dest}`)
}
