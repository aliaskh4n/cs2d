// Private cloud client. SessionStorage contains an access token only, never replay bytes.
import { computed, ref } from 'vue'

export const CLOUD_API = (import.meta.env.VITE_CLOUD_API || '').replace(/\/$/, '')
const TOKEN_KEY = 'cs2d-cloud-session'
const token = ref(sessionStorage.getItem(TOKEN_KEY) || '')
export const signedIn = computed(() => !!token.value)
export const cloudBusy = ref(false)
export const cloudProgress = ref(0)
export const cloudError = ref('')
export const keepCloudVoice = ref(localStorage.getItem('cs2d-keep-voice') !== 'off')
export function setCloudSession(value: string) {
  token.value = value
  if (value) sessionStorage.setItem(TOKEN_KEY, value)
  else sessionStorage.removeItem(TOKEN_KEY)
}
export function cloudSession() { return token.value }
export function steamLoginUrl() { return `${CLOUD_API}/auth/steam` }
export async function cloudRequest<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  if (!CLOUD_API) throw new Error('Cloud API is not configured')
  const response = await fetch(`${CLOUD_API}${path}`, { ...init, cache: 'no-store', headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token.value}` } })
  if (!response.ok) {
    if (response.status === 401) setCloudSession('')
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Cloud HTTP ${response.status}`)
  }
  if (path.endsWith('/archive')) return await response.blob() as T
  return await response.json() as T
}
export async function uploadCloudArchive(blob: Blob, metadata: Record<string, unknown>): Promise<string> {
  cloudBusy.value = true; cloudError.value = ''; cloudProgress.value = 0
  let uploadId = ''
  try {
    const upload = await cloudRequest<{ uploadId: string; partSize: number; existingId?: string }>('/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...metadata, fileSize: blob.size }) })
    if (upload.existingId) return upload.existingId
    uploadId = upload.uploadId
    for (let offset = 0, part = 0; offset < blob.size; offset += upload.partSize, part++) {
      await cloudRequest(`/uploads/${uploadId}/parts/${part}`, { method: 'PUT', body: blob.slice(offset, offset + upload.partSize) })
      cloudProgress.value = Math.min(99, Math.round((offset + upload.partSize) / blob.size * 100))
    }
    const result = await cloudRequest<{ id: string }>(`/uploads/${uploadId}/complete`, { method: 'POST' })
    cloudProgress.value = 100
    return result.id
  } catch (error) {
    cloudError.value = error instanceof Error ? error.message : String(error)
    if (uploadId) await cloudRequest(`/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {})
    throw error
  } finally { cloudBusy.value = false }
}
