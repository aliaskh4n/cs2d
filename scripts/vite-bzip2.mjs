// Respect the caller's explicit WASM URL instead of upstream's webpack-style require.
export function bzip2WasmUrl() {
  return {
    name: 'bzip2-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('@foxglove/wasm-bz2/wasm/module.js')) return
      return {
        code: code.replace('Module.locateFile = function', 'Module.locateFile = Module.locateFile || function')
          .replace('require("./module.wasm")', '"module.wasm"'),
        map: null,
      }
    },
  }
}
