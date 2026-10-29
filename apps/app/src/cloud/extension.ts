// Narrow, same-page bridge to the companion extension; no provider passwords or cookies cross it.
export interface SourceMatch {
  id: string; source: 'faceit' | 'steam'; label: string; map?: string; date?: number
  mode?: string
  kills?: number; headshots?: number; hsPercent?: number
}
export interface ConnectorState {
  libraryVersion?: number
  faceit?: { nickname: string; playerId: string }; steam?: { steamId: string; checkedAt?: number; loginRequired?: boolean; error?: string }
  matches: SourceMatch[]; active: { matchId: string; label?: string; phase: string; loaded?: number; total?: number; error?: string; meta?: {map?: string; source?: string} }[]
}
export function extensionRequest<T = Record<string, unknown>>(command: string, payload: Record<string, unknown> = {}, timeout = 30000): Promise<T> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    let retry: ReturnType<typeof setInterval> | undefined
    const cleanup = () => { clearTimeout(timer); clearInterval(retry); window.removeEventListener('message', onMessage) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Companion extension is not responding. Install it and reload this page.')) }, timeout)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'cs2dv-extension' || event.data?.requestId !== requestId) return
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    window.addEventListener('message', onMessage)
    const send = () => window.postMessage({ source: 'cs2dv-app', kind: 'connector', requestId, command, payload }, location.origin)
    // The content script may start after Vue mounts. Only retry the harmless handshake.
    if (command === 'PING') retry = setInterval(send, 250)
    send()
  })
}
