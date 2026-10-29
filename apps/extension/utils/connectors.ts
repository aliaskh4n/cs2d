// Direct provider discovery in the user's logged-in browser, without exporting login cookies.
import type { Job } from './protocol'
import { faceitJson } from './faceitApi'
import { fetchPayload, signDemoUrl, demoUrlFromPayload, extractMeta } from './faceitDownload'
export interface SourceMatch { id: string; source: 'faceit' | 'steam'; label: string; map?: string; date?: number; kills?: number; headshots?: number; hsPercent?: number; url?: string }
interface Sources { faceit?: { nickname: string; playerId: string }; steam?: { steamId: string }; matches: SourceMatch[] }
const KEY = 'providerSources'
export async function sources(): Promise<Sources> { return (await chrome.storage.session.get(KEY))[KEY] ?? { matches: [] } }
const providerJson = (url:string) => faceitJson(new URL(url).pathname + new URL(url).search)
export async function syncFaceit(nickname: string) {
  if (!/^[\w-]{1,40}$/.test(nickname)) throw new Error('Enter a FACEIT nickname')
  const { payload: player } = await providerJson(`https://www.faceit.com/api/users/v1/nicknames/${encodeURIComponent(nickname)}`)
  if (!player?.id) throw new Error('FACEIT profile not found')
  const matches: SourceMatch[] = []
  for (let page = 0; page < 100; page++) {
    const data = await providerJson(`https://www.faceit.com/api/stats/v1/stats/time/users/${player.id}/games/cs2?size=100&page=${page}`)
    if (!Array.isArray(data)) throw new Error('FACEIT did not return match history. Open your profile on FACEIT and retry.')
    for (const m of data) if (typeof m.matchId === 'string') matches.push({ id: m.matchId, source: 'faceit', label: `${m.i1 ?? 'CS2'} · ${m.i18 ?? ''}`, map: m.i1, date: Number(m.date) || undefined, kills: Number(m.i6), headshots: Number(m.i13), hsPercent: Number(m.c4) })
    if (data.length < 100) break
    if (page === 99) throw new Error('History exceeds 10,000 matches. Please use a smaller account history.')
  }
  const state = await sources()
  state.faceit = { nickname: player.nickname, playerId: player.id }
  state.matches = [...state.matches.filter(m => m.source !== 'faceit'), ...[...new Map(matches.map(m => [m.id,m])).values()]]
  await chrome.storage.session.set({ [KEY]: state })
  return { count: matches.length }
}
export function validSteamDemo(value: string): boolean {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && (u.hostname === 'valve.net' || u.hostname.endsWith('.valve.net') || u.hostname.endsWith('.steamcontent.com')) && /\.dem(?:\.(?:bz2|gz|zst))?$/i.test(u.pathname) } catch { return false }
}
export async function discoverSteam(steamId: string, items: SourceMatch[]) {
  if (!/^7656119\d{10}$/.test(steamId)) throw new Error('Steam profile could not be identified')
  const state = await sources()
  const accepted = items.filter(m => m.source === 'steam' && m.url && validSteamDemo(m.url) && typeof m.id === 'string').map(m => ({ ...m, id: m.id.slice(0,100), label: String(m.label).slice(0,240) }))
  state.steam = { steamId }
  state.matches = [...new Map([...state.matches,...accepted].map(m => [`${m.source}:${m.id}`,m])).values()]
  await chrome.storage.session.set({ [KEY]: state })
  return { count: accepted.length }
}
export async function sourceJob(source: string, id: string): Promise<Job> {
  const state = await sources()
  const item = state.matches.find(m => m.source === source && m.id === id)
  if (!item) throw new Error('Sync the provider before importing this match')
  if (source === 'steam') {
    if (!item.url || !validSteamDemo(item.url)) throw new Error('Steam demo URL is not available')
    return { matchId: `steam-${id}`, url: item.url, label: item.label, meta: { source: 'steam', sourceId: id, map: item.map, date: item.date } }
  }
  const payload = await fetchPayload(id)
  const resource = demoUrlFromPayload(payload)
  if (!resource) throw new Error('FACEIT no longer provides a demo for this match')
  const signed = await signDemoUrl(resource)
  if (!signed) throw new Error('FACEIT did not authorize the download. Open the match room, sign in, and use the cloud import button in the companion.')
  return { matchId: id, url: signed, label: item.label, meta: { ...extractMeta(payload), source: 'faceit', sourceId: id, roomUrl: `https://www.faceit.com/ru/cs2/room/${id}` } }
}
