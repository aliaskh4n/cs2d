// Cloud archive transport. Only the short-lived session is stored by the extension; replay bytes stay in RAM.
export interface CloudConfig { api: string; token: string; keepVoice?: boolean }
const EXPECTED_API = (import.meta.env.VITE_CLOUD_API || '').replace(/\/$/, '')
export async function configureCloud(value: CloudConfig) {
  if (!EXPECTED_API || value.api !== EXPECTED_API || typeof value.token !== 'string' || value.token.length > 4096) throw new Error('Cloud pairing is invalid')
  await chrome.storage.session.set({ cloudConfig: value })
}
export async function cloudConfig(): Promise<CloudConfig> {
  const { cloudConfig: value } = await chrome.storage.session.get('cloudConfig')
  if (!value?.token || value.api !== EXPECTED_API) throw new Error('Open the cloud site, sign in with Steam and connect the extension first.')
  return value
}
export async function cloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = await cloudConfig()
  const response = await fetch(config.api + path, { ...init, cache: 'no-store', headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${config.token}` } })
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Cloud HTTP ${response.status}`) }
  return (path.endsWith('/archive') ? await response.blob() : await response.json()) as T
}
export async function storeCloudArchive(metadata: Record<string, unknown>, blob: Blob): Promise<string> {
  const upload = await cloudFetch<{ uploadId: string; partSize: number; existingId?: string }>('/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...metadata, fileSize: blob.size }) })
  if (upload.existingId) return upload.existingId
  try {
    for (let offset = 0, part = 0; offset < blob.size; offset += upload.partSize, part++) await cloudFetch(`/uploads/${upload.uploadId}/parts/${part}`, { method: 'PUT', body: blob.slice(offset, offset + upload.partSize) })
    return (await cloudFetch<{ id: string }>(`/uploads/${upload.uploadId}/complete`, { method: 'POST' })).id
  } catch (error) { await cloudFetch(`/uploads/${upload.uploadId}`, { method: 'DELETE' }).catch(() => {}); throw error }
}
