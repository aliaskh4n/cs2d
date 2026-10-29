import { defineBackground } from '#imports'
import { configureCloud, cloudConfig, cloudFetch } from '../utils/cloud'
import { syncSteamHistory } from '../utils/steamSync'
import { sources, syncFaceit, discoverSteam, sourceJob } from '../utils/connectors'
import { analyzeMatch } from '@cs2/replay-core/matchAnalysis'
import {
  type ActiveJob,
  type ArchiveMetaRow,
  type BlobReply,
  type Job,
  type StateReply,
  type ToBackground,
  type ToBackgroundFromOffscreen,
} from '../utils/protocol'
import { deleteArchive, getArchiveBlob, listArchives, putArchive, totalBytes } from '../utils/db'
import { importArchive } from '@cs2/replay-core/demoArchive'
import { exportLogs, makeLog } from '../utils/log'

// Where stored replays open for playback (the public 2D viewer).
const WEB_APP = import.meta.env.VITE_WEB_APP || 'https://aliaskh4n.github.io/cs2d/'

const log = makeLog('background')
// Grab the full log from the service-worker console with `await cs2dvLogs()`.
;(globalThis as { cs2dvLogs?: () => Promise<string> }).cs2dvLogs = exportLogs

// Orchestrator. Owns the job queue and the overlay-facing state, and keeps the
// offscreen document (which does the heavy fetch+parse) alive while there's
// work. Only small JSON crosses chrome.runtime here; bytes live in the offscreen.

const OFFSCREEN = 'offscreen.html'

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target !== 'connector') return false
    const trustedApp = sender.url?.startsWith(WEB_APP) || sender.url?.startsWith('http://localhost:')
    const trustedSteam = sender.url?.startsWith('https://steamcommunity.com/')
    if (msg.command === 'STEAM_DISCOVER' ? !trustedSteam : !trustedApp) { sendResponse({error:'Untrusted connector origin'}); return false }
    const respond = async () => {
      const payload = msg.payload ?? {}
      switch (msg.command) {
        case 'PING': return { version: chrome.runtime.getManifest().version }
        case 'CLOUD_CONFIG': await configureCloud(payload); return {ok:true}
        case 'SOURCES_STATE': return { ...await sources(), active: [...active.values()], libraryVersion }
        case 'FACEIT_SYNC': return syncFaceit(payload.nickname)
        case 'STEAM_SYNC': {
          const result = await syncSteamHistory(!!payload.force)
          const queued = payload.autoImport ? await queueSteam() : 0
          return { ...result, queued }
        }
        case 'STEAM_DISCOVER': {
          const owner = await cloudFetch<{steamId: string}>('/me')
          if (payload.steamId !== owner.steamId) throw new Error('Open the Steam history of your signed-in cloud account.')
          const result = await discoverSteam(payload.steamId,payload.matches, { loginRequired: false })
          const { steamAutoImport } = await chrome.storage.session.get('steamAutoImport')
          if (steamAutoImport) await queueSteam()
          return result
        }
        case 'STEAM_AUTO_IMPORT':
          await chrome.storage.session.set({ steamAutoImport: !!payload.enabled })
          return { queued: payload.enabled ? await queueSteam() : 0 }
        case 'RESTORE_VOICE': {
          const library = await cloudFetch<{matches: {id:string;source:string;sourceId?:string;map:string;fileName:string;hasVoice?:boolean}[]}>('/matches')
          const match = library.matches.find(m => m.id === payload.id)
          if (!match?.sourceId || !['faceit','steam'].includes(match.source)) throw new Error('Voice restoration requires an available FACEIT or Steam demo.')
          if (match.source === 'steam') {
            const result = await syncSteamHistory(true)
            if (result.loginRequired) throw new Error('Sign in to Steam in this browser before restoring voice.')
            if (result.error) throw new Error(result.error)
          }
          enqueue({matchId:match.source==='steam'?`steam-${match.sourceId}`:match.sourceId,url:'',label:match.map||match.fileName,meta:{source:match.source,sourceId:match.sourceId,map:match.map,replaceId:match.id,includeVoice:true}})
          return {ok:true}
        }
        case 'IMPORT_MATCH': {
          // Resolve signed URLs when the job actually starts; they can expire while queued.
          const item = (await sources()).matches.find(m => m.id === payload.id && m.source === payload.source)
          if (!item) throw new Error('Match not found')
          const matchId = item.source === 'steam' ? `steam-${item.id}` : item.id
          enqueue({ matchId, url: '', label: item.label, meta: {source:item.source,sourceId:item.id,map:item.map,date:item.date} })
          return {ok:true}
        }
        default: throw new Error('Unknown connector request')
      }
    }
    void respond().then(result=>sendResponse({result})).catch(error=>sendResponse({error:error instanceof Error?error.message:String(error)}))
    return true
  })
  // In-flight jobs by matchId (what the overlay shows as "active").
  const active = new Map<string, ActiveJob>()
  const queue: Job[] = []
  let running = false
  let libraryVersion = 0
  const attemptedSteam = new Set<string>()
  async function queueSteam() {
    await cloudConfig()
    const stored = await listArchives()
    let queued = 0
    for (const item of (await sources()).matches.filter(m => m.source === 'steam')) {
      if (attemptedSteam.has(item.id) || stored.some(m => m.source === 'steam' && m.sourceId === item.id)) continue
      attemptedSteam.add(item.id)
      enqueue({ matchId: `steam-${item.id}`, url: '', label: item.label, meta: { source: 'steam', sourceId: item.id, map: item.map, date: item.date, mode: item.mode } })
      queued++
    }
    return queued
  }

  browser_onMessage((msg, sender, sendResponse) => {
    // Overlay -> background.
    if (msg.target === 'background' && 'type' in msg) {
      switch (msg.type) {
        case 'GET_CLOUD_CONFIG':
          if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL(OFFSCREEN)) return false
          void cloudConfig().then(sendResponse).catch(() => sendResponse(null))
          return true
        case 'ENQUEUE':
          enqueue(msg.job)
          return false
        case 'DELETE':
          void deleteArchive(msg.matchId)
          active.delete(msg.matchId)
          return false
        case 'CANCEL': {
          // Drop it from the queue if it hasn't started; otherwise tell the
          // offscreen to abort its in-flight fetch. Removing it from `active`
          // now hides the card immediately; the running job's JOB_ERROR then
          // pumps the next one (and is ignored since the entry is already gone).
          const i = queue.findIndex((q) => q.matchId === msg.matchId)
          if (i >= 0) queue.splice(i, 1)
          active.delete(msg.matchId)
          void browser_sendMessage({ target: 'offscreen', type: 'CANCEL', matchId: msg.matchId }).catch(() => {})
          return false
        }
        case 'OPEN_VIEWER':
          // The app reads `#cs2dv=<id>` and asks us back for the bytes (GET_BLOB).
          void openCloudViewer(msg.matchId)
          return false
        case 'GET_BLOB':
          void getBlobReply(msg.matchId).then(sendResponse)
          return true // async response
        case 'IMPORT':
          void importBlob(msg.fileName, msg.base64).then(sendResponse)
          return true // async response
        case 'GET_STATE':
          void getState().then(sendResponse)
          return true // async response
        // Offscreen -> background.
        case 'JOB_PROGRESS': {
          const j = active.get(msg.matchId)
          if (j) Object.assign(j, msg.patch)
          return false
        }
        case 'JOB_DONE':
          log.info('job done', { matchId: msg.matchId })
          active.delete(msg.matchId)
          libraryVersion = Date.now()
          finishAndPump()
          return false
        case 'JOB_ERROR': {
          const j = active.get(msg.matchId)
          if (j) j.error = msg.message
          // 'cancelled' is an expected outcome (user aborted), not a failure.
          if (msg.message === 'cancelled') log.info('job cancelled', { matchId: msg.matchId })
          else log.error('job failed', { matchId: msg.matchId, message: msg.message })
          // Drop from active after a moment so the overlay can show the error.
          setTimeout(() => active.delete(msg.matchId), 8000)
          finishAndPump()
          return false
        }
      }
    }
    return false
  })

  function enqueue(job: Job) {
    if (active.get(job.matchId)?.error) active.delete(job.matchId)
    if (active.has(job.matchId) || queue.some((q) => q.matchId === job.matchId)) {
      log.info('enqueue ignored (already active/queued)', { matchId: job.matchId })
      return
    }
    log.info('enqueue', { matchId: job.matchId, label: job.label })
    active.set(job.matchId, { matchId: job.matchId, label: job.label, meta: job.meta, phase: 'queued', loaded: 0, total: 0 })
    queue.push(job)
    void pump()
  }

  function finishAndPump() {
    running = false
    void pump()
  }

  // Process one job at a time (parsing is memory-heavy; keep concurrency at 1).
  async function pump() {
    if (running) return
    const job = queue.shift()
    if (!job) {
      setTimeout(() => { if (!running && !queue.length) void chrome.offscreen.closeDocument().catch(() => {}) }, 1000)
      return
    }
    running = true
    log.info('processing', { matchId: job.matchId })
    try {
      if (!job.url && job.meta?.source && job.meta.sourceId) {
        const { replaceId, includeVoice } = job.meta
        Object.assign(job, await sourceJob(job.meta.source,job.meta.sourceId))
        job.meta = {...job.meta,replaceId,includeVoice}
      }
      await ensureOffscreen()
      await browser_sendMessage({ target: 'offscreen', type: 'PROCESS', job })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('dispatch to offscreen failed', { matchId: job.matchId, message })
      const j = active.get(job.matchId)
      if (j) j.error = message
      running = false
      void pump()
    }
  }

  async function getState(): Promise<StateReply> {
    const [stored, bytes] = await Promise.all([listArchives(), totalBytes()])
    return { active: [...active.values()], stored, totalBytes: bytes }
  }
})

/** Reads a stored .cs2dv and base64-encodes it for the app-origin content
 *  script (runtime messaging is JSON, so raw bytes can't cross here). */
async function getBlobReply(matchId: string): Promise<BlobReply | null> {
  const [blob, rows] = await Promise.all([getArchiveBlob(matchId), listArchives()])
  if (!blob) return null
  const fileName = rows.find((r) => r.matchId === matchId)?.fileName || matchId
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000 // build the binary string in chunks to avoid arg-count limits
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  return { fileName: `${fileName}.cs2dv`, base64: btoa(bin) }
}

/** Imports an exported .cs2dv (base64 from the content script) into the library.
 *  Parses the archive for its map/score; team/competition aren't in the archive
 *  (they came from Faceit), so an imported row is labelled by its file name. */
async function importBlob(fileName: string, base64: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const { replay } = await importArchive(blob)
    const base = fileName.replace(/\.cs2dv$/i, '')
    const meta: ArchiveMetaRow = {
      matchId: `import-${Date.now()}`,
      fileName: base,
      label: base,
      map: replay.map,
      scoreCt: replay.finalScoreCt ?? 0,
      scoreT: replay.finalScoreT ?? 0,
      sizeBytes: blob.size,
      createdAt: Date.now(),
      // The Faceit API meta isn't in the .cs2dv, but the parsed replay carries
      // the clan names by ending side — enough to label pro/HLTV demos.
      teamA: replay.finalCtName || undefined,
      teamB: replay.finalTName || undefined,
      source: 'imported',
      analysis: analyzeMatch(replay),
    }
    await putArchive(meta, blob)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// --- offscreen lifecycle ----------------------------------------------------
async function ensureOffscreen() {
  if (!await chrome.offscreen.hasDocument?.()) await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Process demos in memory and save compact replays to the private cloud.',
  })
  // Imports and WASM setup can finish after createDocument resolves.
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PING' }))?.ready) return } catch { /* wait for the listener */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Demo processor did not start. Reload the extension and retry the import.')
}

// --- thin chrome wrappers (typed) -------------------------------------------
type AnyMsg = ToBackground | ToBackgroundFromOffscreen
function browser_onMessage(
  fn: (msg: AnyMsg, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => boolean | void,
) {
  chrome.runtime.onMessage.addListener(fn as never)
}
function browser_sendMessage(msg: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage(msg)
}

export type { ArchiveMetaRow }

async function openCloudViewer(matchId: string) {
  const match = (await listArchives()).find(m => m.matchId === matchId || m.cloudId === matchId)
  if (!match?.cloudId) return
  const tabs = await chrome.tabs.query({url: WEB_APP + '*'})
  if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, {url: `${WEB_APP}#/app/${match.cloudId}/overview`,active:true})
  else await chrome.tabs.create({url: `${WEB_APP}#/cloud`})
}
