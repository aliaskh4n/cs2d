// Bounded bzip2 decompression for Steam GOTV demos; caller supplies its bundled WASM URL.
import moduleFactory from '@foxglove/wasm-bz2/wasm/module'
interface BzipModule {
  HEAPU8: Uint8Array; _malloc(size: number): number; _free(ptr: number): void
  decompress(dest: number, capacity: number, source: number, length: number, small: number): { code: number; error?: string; buffer?: Uint8Array }
}
let initialized: Promise<BzipModule> | undefined
export async function decompressBzip2(input: Uint8Array, wasmUrl: string): Promise<Uint8Array> {
  const module = await (initialized ??= moduleFactory({ locateFile: () => wasmUrl }) as Promise<BzipModule>)
  const source = module._malloc(input.byteLength)
  module.HEAPU8.set(input, source)
  try {
    for (let size = Math.max(4 * 1024 * 1024, input.byteLength * 4); size <= 1024 * 1024 * 1024; size *= 2) {
      const dest = module._malloc(size)
      try {
        const result = module.decompress(dest, size, source, input.byteLength, 0)
        if (result.code === 0 && result.buffer) return new Uint8Array(result.buffer)
        if (result.code !== -8) throw new Error(`Invalid bzip2 demo: ${result.error ?? result.code}`)
      } finally { module._free(dest) }
    }
    throw new Error('The uncompressed demo exceeds the 1 GiB memory limit')
  } finally { module._free(source) }
}
