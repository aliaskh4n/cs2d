// Minimal structural Vite plugin declaration shared by the app and companion configs.
export function bzip2WasmUrl(): {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: null } | undefined
}
