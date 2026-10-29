// Self-contained: Chrome serializes this function into the provider's isolated world.
export async function faceitRequest(path: string, body?: unknown): Promise<{ ok: boolean; status?: number; data?: any; error?: string }> {
  if (!['www.faceit.com', 'faceit.com'].includes(location.hostname)) return { ok: false, error: 'Open FACEIT and retry.' }
  const allowed = /^\/api\/users\/v1\/nicknames\/[\w%-]+$/.test(path) || /^\/api\/stats\/v1\/stats\/time\/users\/[\w-]+\/games\/cs2\?size=100&page=\d+$/.test(path) || /^\/api\/match\/v2\/match\/[\w-]+$/.test(path) || path === '/api/download/v2/demos/download-url'
  if (!allowed) return { ok: false, error: 'Unsupported FACEIT endpoint' }
  try {
    const post = path === '/api/download/v2/demos/download-url'
    const response = await fetch(path, { credentials: 'include', method: post ? 'POST' : 'GET', headers: post ? { 'Content-Type': 'application/json' } : undefined, body: post ? JSON.stringify({ resource_url: (body as {resource_url?: string})?.resource_url }) : undefined })
    if (!response.headers.get('content-type')?.includes('json')) return { ok: false, error: `FACEIT HTTP ${response.status}: open FACEIT, sign in and complete its browser check, then retry.` }
    return { ok: response.ok, status: response.status, data: await response.json() }
  } catch { return { ok: false, error: 'FACEIT request failed. Open FACEIT, check your connection and retry.' } }
}
