import type { SourceMatch } from './connectors'

// Self-contained for scripting.executeScript; login cookies never leave the Steam origin.
export async function steamPage(action: 'scan' | 'fetch', steamId: string, mode: string): Promise<{ matches: SourceMatch[]; loginRequired?: boolean; error?: string }> {
  if (location.hostname !== 'steamcommunity.com' || !/^7656119\d{10}$/.test(steamId) || !['premier','competitive','wingman'].includes(mode)) return { matches: [], error: 'Invalid Steam history request' }
  let doc = document
  if (action === 'fetch') {
    try {
      const response = await fetch(`/profiles/${steamId}/gcpd/730/?tab=matchhistory${mode}&l=english`, { credentials: 'include', cache: 'no-store' })
      if (!response.ok) return { matches: [], error: `Steam HTTP ${response.status}. Open Steam and retry.` }
      if (new URL(response.url).pathname.includes('/login')) return { matches: [], loginRequired: true }
      doc = new DOMParser().parseFromString(await response.text(), 'text/html')
    } catch { return { matches: [], error: 'Steam history request failed. Check your connection and retry.' } }
  }
  if (doc.querySelector('#loginForm, #login_form, form[action*="dologin"]') || /(?:not currently logged in|please (?:log|sign) in to view|not authorized to view)/i.test(doc.body.textContent ?? '')) return { matches: [], loginRequired: true }
  const matches: SourceMatch[] = []
  const seen = new Set<string>()
  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let url: URL
    try { url = new URL(anchor.getAttribute('href')!, 'https://steamcommunity.com') } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol) || !(url.hostname.endsWith('.valve.net') || url.hostname.endsWith('.steamcontent.com')) || !/\.dem(?:\.(?:bz2|gz|zst))?$/i.test(url.pathname)) continue
    const file = url.pathname.split('/').pop() ?? ''
    const id = file.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,100)
    if (seen.has(id)) continue
    seen.add(id)
    const row = anchor.closest('.csgo_scoreboard_root, .matchhistory_match') ?? anchor.closest('table') ?? anchor.parentElement
    const text = row?.textContent?.replace(/\s+/g, ' ') ?? ''
    const artwork = [...(row?.querySelectorAll('img') ?? [])].map(img => `${img.src} ${img.alt}`).join(' ')
    const code = `${text} ${artwork}`.match(/\b(?:de|cs)_\w+\b/i)?.[0]?.toLowerCase()
    const mapName = text.match(/\b(Dust\s*(?:II|2)|Mirage|Inferno|Nuke|Ancient|Anubis|Overpass|Vertigo|Train|Cache|Office|Italy)\b/i)?.[0]?.toLowerCase().replace(/\s+/g, '').replace('dustii','dust2')
    const map = code ?? (mapName ? `${['office','italy'].includes(mapName) ? 'cs' : 'de'}_${mapName}` : undefined)
    const stamp = row?.querySelector('[data-timestamp], time[datetime]')
    const rawDate = stamp?.getAttribute('data-timestamp')
    const dateText = stamp?.getAttribute('datetime') ?? text.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:GMT|UTC))?)?/)?.[0] ?? text.match(/\b[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}(?:\s*[-–]?\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?(?:\s*(?:GMT|UTC))?)?/)?.[0]
    const parsed = rawDate ? Number(rawDate) * (Number(rawDate) < 1e12 ? 1000 : 1) : dateText ? Date.parse(dateText) : NaN
    matches.push({ id, source: 'steam', label: map ?? file, map, date: Number.isFinite(parsed) ? parsed : undefined, mode, url: url.href })
  }
  return { matches }
}
