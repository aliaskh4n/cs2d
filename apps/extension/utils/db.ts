// Cloud-backed extension library. IndexedDB is deliberately not used for replay files.
import type { ArchiveMetaRow } from './protocol'
import { cloudFetch, storeCloudArchive } from './cloud'
interface CloudRow extends Partial<ArchiveMetaRow> { id:string;sourceId?:string;fileName:string;map:string;scoreCt:number;scoreT:number;fileSize:number;savedAt:number;source?:string;analysis?:ArchiveMetaRow['analysis'] }
let cached: ArchiveMetaRow[] = []
let lastRead = 0
export async function listArchives(): Promise<ArchiveMetaRow[]> {
  if (Date.now()-lastRead < 5000) return cached
  try {
    const {matches} = await cloudFetch<{matches:CloudRow[]}>('/matches')
    cached = matches.map(m=>({ ...m, matchId:m.sourceId||m.id, cloudId:m.id, sourceId:m.sourceId, fileName:m.fileName, label:m.fileName, map:m.map, scoreCt:m.scoreCt, scoreT:m.scoreT, sizeBytes:m.fileSize, createdAt:m.savedAt, source:m.source, analysis:m.analysis }))
    lastRead = Date.now()
  } catch { cached = [] }
  return cached
}
export async function putArchive(meta:ArchiveMetaRow,blob:Blob): Promise<void> {
  meta.cloudId = await storeCloudArchive({fileName:meta.fileName,map:meta.map,rounds:meta.analysis?.rounds??0,scoreCt:meta.scoreCt,scoreT:meta.scoreT,analysis:meta.analysis,source:meta.source,sourceId:meta.sourceId??meta.matchId,date:meta.date,mode:meta.mode,teamCt:meta.teamCt,teamT:meta.teamT,myScore:meta.myScore,opponentScore:meta.opponentScore,outcome:meta.outcome,competition:meta.competition,hasVoice:meta.hasVoice,voiceStatus:meta.voiceStatus,replaceId:meta.replaceId},blob)
  lastRead = 0
}
export async function totalBytes(): Promise<number> { return (await listArchives()).reduce((sum,m)=>sum+m.sizeBytes,0) }
export async function getArchiveBlob(matchId:string): Promise<Blob|undefined> {
  const meta = (await listArchives()).find(m=>m.matchId===matchId||m.cloudId===matchId)
  return meta?.cloudId ? cloudFetch<Blob>(`/matches/${meta.cloudId}/archive`) : undefined
}
export async function deleteArchive(matchId:string): Promise<void> {
  const meta = (await listArchives()).find(m=>m.matchId===matchId||m.cloudId===matchId)
  if (meta?.cloudId) await cloudFetch(`/matches/${meta.cloudId}`,{method:'DELETE'})
  lastRead = 0
}
