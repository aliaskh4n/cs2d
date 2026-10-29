// Narrow, same-page bridge to the companion extension; no provider passwords or cookies cross it.
export interface SourceMatch {
  id: string; source: 'faceit' | 'steam'; label: string; map?: string; date?: number
  kills?: number; headshots?: number; hsPercent?: number
}
export interface ConnectorState {
  faceit?: { nickname: string; playerId: string }; steam?: { steamId: string }
  matches: SourceMatch[]; active: { matchId: string; phase: string; error?: string }[]
}
export function extensionRequest<T = Record<string, unknown>>(command: string, payload: Record<string, unknown> = {}, timeout = 30000): Promise<T> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('Companion extension is not responding. Install it and reload this page.')) }, timeout)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'cs2dv-extension' || event.data?.requestId !== requestId) return
      clearTimeout(timer); window.removeEventListener('message', onMessage)
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'cs2dv-app', kind: 'connector', requestId, command, payload }, location.origin)
  })
}
