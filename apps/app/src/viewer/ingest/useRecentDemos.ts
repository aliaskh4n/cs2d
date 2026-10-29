// Cloud-backed replay history. Without a login, a replay lives only in this tab's memory.
import { ref } from 'vue'
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'
import { exportArchive, importArchive } from '@/viewer/ingest/demoArchive'
import { analyzeMatch, type MatchAnalysis } from '@cs2/replay-core/matchAnalysis'
import { cloudRequest, signedIn, uploadCloudArchive, keepCloudVoice } from '@/cloud/client'

export interface RecentDemo {
  id: string; fileName: string; title?: string; fileSize: number; map: string; rounds: number
  scoreCt: number; scoreT: number; hasVoice: boolean; savedAt: number
  storage?: 'cloud' | 'session'; source?: string; sourceId?: string; analysis?: MatchAnalysis
}
export interface RecentDemoPayload { replay: Replay; voice: VoiceData | null }
const list = ref<RecentDemo[]>([])
const memory = new Map<string, RecentDemoPayload>()
const memoryComments = new Map<string, ReplayComment[]>()
const totalBytes = ref(0)
const maxBytes = ref(512 * 1024 * 1024)
const refreshing = ref(false)

export function useRecentDemos() {
  async function refresh(): Promise<void> {
    if (!signedIn.value) return
    refreshing.value = true
    try {
      const result = await cloudRequest<{ matches: RecentDemo[]; totalBytes: number; maxBytes: number }>('/matches')
      list.value = [...list.value.filter(m => m.storage === 'session'), ...result.matches]
      totalBytes.value = result.totalBytes; maxBytes.value = result.maxBytes
    } finally { refreshing.value = false }
  }
  async function save(input: { fileName: string; fileSize: number; replay: Replay; voice: VoiceData | null }): Promise<string | null> {
    const analysis = analyzeMatch(input.replay)
    const meta = { fileName: input.fileName, map: input.replay.map, rounds: analysis.rounds,
      scoreCt: input.replay.finalScoreCt ?? 0, scoreT: input.replay.finalScoreT ?? 0,
      hasVoice: keepCloudVoice.value && (input.voice?.tracks?.length ?? 0) > 0, analysis }
    if (signedIn.value) {
      const blob = await exportArchive({ ...input, voice: keepCloudVoice.value ? input.voice : null, comments: [] })
      const id = await uploadCloudArchive(blob, meta)
      await refresh()
      return id
    }
    const id = `session-${crypto.randomUUID()}`
    memory.clear(); memory.set(id, { replay: input.replay, voice: input.voice })
    list.value = [{ ...meta, id, fileSize: 0, storage: 'session', savedAt: Date.now() }, ...list.value.filter(m => m.storage === 'cloud')]
    return id
  }
  async function load(id: string): Promise<RecentDemoPayload | null> {
    const transient = memory.get(id)
    if (transient) return transient
    if (!signedIn.value) return null
    const archive = await importArchive(await cloudRequest<Blob>(`/matches/${id}/archive`))
    return { replay: archive.replay, voice: archive.voice }
  }
  function rename(id: string, title: string): void {
    const entry = list.value.find(m => m.id === id)
    if (!entry) return
    const trimmed = title.trim()
    if (entry.storage === 'cloud') void cloudRequest(`/matches/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: trimmed }) }).then(refresh).catch(console.error)
    else entry.title = trimmed || undefined
  }
  function remove(id: string): void {
    const entry = list.value.find(m => m.id === id)
    if (entry?.storage === 'cloud') void cloudRequest(`/matches/${id}`, { method: 'DELETE' }).then(refresh).catch(console.error)
    else { memory.delete(id); memoryComments.delete(id); list.value = list.value.filter(m => m.id !== id) }
  }
  async function loadComments(id: string): Promise<ReplayComment[]> {
    if (id.startsWith('session-')) return memoryComments.get(id) ?? []
    return signedIn.value ? cloudRequest<ReplayComment[]>(`/matches/${id}/comments`) : []
  }
  async function saveComments(id: string, comments: ReplayComment[]): Promise<void> {
    if (id.startsWith('session-')) { memoryComments.set(id, comments); return }
    if (signedIn.value) await cloudRequest(`/matches/${id}/comments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(comments) })
  }
  return { list, save, load, rename, remove, loadComments, saveComments, refresh, totalBytes, maxBytes, refreshing }
}
