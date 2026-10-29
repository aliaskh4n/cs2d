// Resolve public assets under the GitHub Pages project prefix.
export function assetPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  return import.meta.env.BASE_URL + path.slice(1)
}
